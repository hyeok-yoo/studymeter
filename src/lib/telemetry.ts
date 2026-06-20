import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import { db, getTodayDate, type SessionEvaluation } from './db'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let _app: FirebaseApp | null = null
let _db: Firestore | null = null

function isConfigured(): boolean {
  return !!firebaseConfig.projectId
}

function getDb(): Firestore {
  if (!_db) {
    _app = initializeApp(firebaseConfig)
    _db = getFirestore(_app)
  }
  return _db
}

export function getDeviceId(): string {
  let id = localStorage.getItem('studymeter_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('studymeter_device_id', id)
  }
  return id
}

async function fetchIp(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    return data.ip as string
  } catch {
    return 'unknown'
  }
}

export function isRegistered(): boolean {
  return !!localStorage.getItem('studymeter_telemetry_name')
}

export function getRegisteredName(): string {
  return localStorage.getItem('studymeter_telemetry_name') ?? ''
}

export async function registerUser(name: string): Promise<void> {
  if (!isConfigured()) {
    localStorage.setItem('studymeter_telemetry_name', name)
    return
  }
  const deviceId = getDeviceId()
  const ip = await fetchIp()
  await setDoc(doc(getDb(), 'users', deviceId), {
    name,
    ip,
    registeredAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    blocked: false,
  })
  localStorage.setItem('studymeter_telemetry_name', name)
}

export async function checkBlocked(): Promise<boolean> {
  if (!isConfigured()) return false
  const deviceId = getDeviceId()
  try {
    const snap = await getDoc(doc(getDb(), 'users', deviceId))
    if (snap.exists()) return snap.data().blocked === true
  } catch {
    // offline → don't block
  }
  return false
}

export async function updateLastSeen(): Promise<void> {
  if (!isConfigured() || !isRegistered()) return
  const deviceId = getDeviceId()
  try {
    const ip = await fetchIp()
    await updateDoc(doc(getDb(), 'users', deviceId), {
      lastSeen: serverTimestamp(),
      ip,
    })
  } catch {
    // silent
  }
}

export interface TelemetryUser {
  id: string
  name: string
  ip: string
  registeredAt: Timestamp | null
  lastSeen: Timestamp | null
  blocked: boolean
  isAdmin: boolean
}

export async function getAllUsers(): Promise<TelemetryUser[]> {
  const snap = await getDocs(collection(getDb(), 'users'))
  return snap.docs.map((d) => ({
    id: d.id,
    name: d.data().name ?? '',
    ip: d.data().ip ?? '',
    registeredAt: d.data().registeredAt ?? null,
    lastSeen: d.data().lastSeen ?? null,
    blocked: d.data().blocked === true,
    isAdmin: d.data().isAdmin === true,
  }))
}

export function isTelemetryConfigured(): boolean {
  return isConfigured()
}

export async function setUserBlocked(deviceId: string, blocked: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'users', deviceId), { blocked })
}

export async function deleteUser(deviceId: string): Promise<void> {
  // 하위 일별 기록 컬렉션 먼저 삭제 (Firestore는 문서 삭제 시 하위 컬렉션을 자동 삭제하지 않음)
  try {
    const snap = await getDocs(collection(getDb(), 'users', deviceId, 'days'))
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  } catch {
    // 기록이 없거나 권한 문제여도 사용자 문서 삭제는 진행
  }
  await deleteDoc(doc(getDb(), 'users', deviceId))
}

// ── 공부 기록 동기화 (관리자 열람용) ─────────────────────────────────────────
//
// 공부 기록은 기본적으로 각 기기의 IndexedDB(로컬)에만 저장된다.
// 관리자 페이지에서 사용자별 공부 내역을 보려면 Firestore에 미러링해야 한다.
//
// Firebase 요청 절약을 위해 "하루 단위 스냅샷" 1문서로 저장한다.
//   구조: users/{deviceId}/days/{YYYY-MM-DD} = { date, updatedAt, sessions: [...] }
// 세션마다 쓰지 않고, 하루 최대 2~3회만 오늘 기록 전체를 1번의 쓰기로 갱신한다.

export interface AdminSession {
  id: string
  date: string
  subject: string
  subItem?: string
  type: string
  startTime: number
  endTime: number
  duration: number
  evaluation?: SessionEvaluation
}

// 동기화 빈도 제한 (사용자당 하루 2~3회)
const SYNC_STATE_KEY = 'studymeter_sync_state'
const MAX_SYNCS_PER_DAY = 3
const MIN_SYNC_INTERVAL_MS = 7 * 60 * 60 * 1000 // 약 7시간 → 하루 최대 3회 수준

interface SyncState { date: string; count: number; lastTs: number }

function readSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as SyncState
      if (s && typeof s.date === 'string') return s
    }
  } catch { /* ignore */ }
  return { date: '', count: 0, lastTs: 0 }
}

function writeSyncState(s: SyncState): void {
  try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

// 오늘 기록 스냅샷을 Firestore에 1회 쓰기로 업로드 (실제 동기화)
async function uploadTodaySnapshot(): Promise<void> {
  const today = getTodayDate()
  const sessions = await db.sessions.where('date').equals(today).toArray()
  // Firestore는 undefined를 허용하지 않으므로 JSON 왕복으로 정리
  const plain = JSON.parse(JSON.stringify(
    sessions.map((s) => ({
      id: s.id,
      date: s.date,
      subject: s.subject,
      subItem: s.subItem,
      type: s.type,
      startTime: s.startTime,
      endTime: s.endTime,
      duration: s.duration,
      evaluation: s.evaluation,
    }))
  ))
  await setDoc(doc(getDb(), 'users', getDeviceId(), 'days', today), {
    date: today,
    updatedAt: serverTimestamp(),
    sessions: plain,
  })
}

// 빈도 제한이 적용된 동기화. 평소엔 이 함수만 호출한다.
// force=true면 제한을 무시하고 즉시 동기화한다.
export async function maybeSyncToday(force = false): Promise<void> {
  if (!isConfigured() || !isRegistered()) return
  const today = getTodayDate()
  const now = Date.now()
  let state = readSyncState()
  if (state.date !== today) state = { date: today, count: 0, lastTs: 0 }

  if (!force) {
    if (state.count >= MAX_SYNCS_PER_DAY) return
    if (now - state.lastTs < MIN_SYNC_INTERVAL_MS) return
  }

  try {
    await uploadTodaySnapshot()
    writeSyncState({ date: today, count: state.count + 1, lastTs: now })
  } catch {
    // 오프라인 등 → 카운트 증가시키지 않음 (다음 기회에 재시도)
  }
}

// 관리자: 사용자의 모든 일별 스냅샷을 읽어 세션 목록으로 펼친다.
export async function getUserSessions(deviceId: string): Promise<AdminSession[]> {
  const snap = await getDocs(collection(getDb(), 'users', deviceId, 'days'))
  const out: AdminSession[] = []
  snap.docs.forEach((d) => {
    const arr = d.data().sessions
    if (!Array.isArray(arr)) return
    arr.forEach((s: Record<string, unknown>) => {
      out.push({
        id: String(s.id ?? `${d.id}-${s.startTime}`),
        date: (s.date as string) ?? d.id,
        subject: (s.subject as string) ?? '',
        subItem: s.subItem as string | undefined,
        type: (s.type as string) ?? '',
        startTime: (s.startTime as number) ?? 0,
        endTime: (s.endTime as number) ?? 0,
        duration: (s.duration as number) ?? 0,
        evaluation: s.evaluation as SessionEvaluation | undefined,
      })
    })
  })
  return out
}

// ── 관리자 비밀번호 (Firestore 저장, JS 번들에 노출 없음) ──────────────────

const SALT = 'studymeter_admin_v1'

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(SALT + password)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function isAdminPasswordSet(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(getDb(), 'admin', 'config'))
    return snap.exists() && !!snap.data().passwordHash
  } catch {
    return false
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(getDb(), 'admin', 'config'))
    if (!snap.exists()) return false
    const stored = snap.data().passwordHash as string
    const input = await hashPassword(password)
    return stored === input
  } catch {
    return false
  }
}

export async function setAdminPassword(newPassword: string, currentPassword?: string): Promise<void> {
  const alreadySet = await isAdminPasswordSet()
  if (alreadySet) {
    if (!currentPassword) throw new Error('현재 비밀번호가 필요합니다.')
    const valid = await verifyAdminPassword(currentPassword)
    if (!valid) throw new Error('현재 비밀번호가 올바르지 않습니다.')
  }
  const hash = await hashPassword(newPassword)
  await setDoc(doc(getDb(), 'admin', 'config'), { passwordHash: hash })
}

// ── 개발자(소유자) 마스터 비밀번호 ───────────────────────────────────────────
//
// 앱 제작자 전용. 숨겨진 진입점(버전명 5회 탭)에서 이 비밀번호를 입력하면
// 해당 기기가 관리자로 등록되고, 앱 내에서 관리자 페이지에 접근할 수 있다.
//
// 보안: 평문/해시를 로컬에 절대 저장하지 않는다. (기기엔 "관리자임" 플래그만)
// 비밀번호를 여러 사이트에서 재사용하는 경우를 대비해 단순 SHA-256 대신
// PBKDF2(SHA-256, 임의 솔트, 고반복)로 해싱하여 오프라인 무차별 대입을 어렵게 한다.

const DEV_ADMIN_FLAG = 'studymeter_dev_admin'
const DEV_PBKDF2_ITERATIONS = 210000

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  const matches = hex.match(/.{2}/g) ?? []
  return Uint8Array.from(matches.map((h) => parseInt(h, 16)))
}

async function pbkdf2Hash(password: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex) as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return bytesToHex(bits)
}

export async function isDevPasswordSet(): Promise<boolean> {
  try {
    const snap = await getDoc(doc(getDb(), 'admin', 'dev'))
    return snap.exists() && !!snap.data().hash
  } catch {
    return false
  }
}

export async function verifyDevPassword(password: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(getDb(), 'admin', 'dev'))
    if (!snap.exists()) return false
    const data = snap.data() as { hash?: string; salt?: string; iterations?: number }
    if (!data.hash || !data.salt) return false
    const input = await pbkdf2Hash(password, data.salt, data.iterations || DEV_PBKDF2_ITERATIONS)
    // 길이 비교 후 상수시간 비교
    if (input.length !== data.hash.length) return false
    let diff = 0
    for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ data.hash.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}

export async function setDevPassword(newPassword: string, currentPassword?: string): Promise<void> {
  if (newPassword.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.')
  const alreadySet = await isDevPasswordSet()
  if (alreadySet) {
    if (!currentPassword) throw new Error('현재 비밀번호가 필요합니다.')
    const ok = await verifyDevPassword(currentPassword)
    if (!ok) throw new Error('현재 비밀번호가 올바르지 않습니다.')
  }
  const saltHex = bytesToHex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const hash = await pbkdf2Hash(newPassword, saltHex, DEV_PBKDF2_ITERATIONS)
  await setDoc(doc(getDb(), 'admin', 'dev'), {
    hash,
    salt: saltHex,
    iterations: DEV_PBKDF2_ITERATIONS,
  })
}

// 이 기기가 개발자(관리자) 기기로 등록되었는지 (로컬 플래그)
export function isDevAdminDevice(): boolean {
  return localStorage.getItem(DEV_ADMIN_FLAG) === '1'
}

// 현재 기기를 관리자로 등록 (dev 비밀번호 검증 후 호출)
export async function registerDeviceAsAdmin(): Promise<void> {
  // 로컬 플래그는 항상 설정 (앱 내 관리자 진입 + /admin 자동 인증용)
  localStorage.setItem(DEV_ADMIN_FLAG, '1')

  if (!isConfigured()) return
  const deviceId = getDeviceId()
  const ip = await fetchIp()
  const ref = doc(getDb(), 'users', deviceId)
  const payload: Record<string, unknown> = {
    isAdmin: true,
    ip,
    lastSeen: serverTimestamp(),
    blocked: false,
  }
  try {
    const snap = await getDoc(ref)
    const existingName = getRegisteredName()
    if (!snap.exists()) {
      payload.name = existingName || '관리자'
      payload.registeredAt = serverTimestamp()
    } else if (!snap.data().name) {
      payload.name = existingName || '관리자'
    }
    await setDoc(ref, payload, { merge: true })
    // 이름 미등록 상태면 로컬에도 채워 이름 등록 모달이 뜨지 않도록
    if (payload.name && !isRegistered()) {
      localStorage.setItem('studymeter_telemetry_name', String(payload.name))
    }
  } catch {
    // 오프라인이어도 로컬 플래그는 유지
  }
}
