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
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type Auth,
  type User,
} from 'firebase/auth'
import { db, getTodayDate, type SessionEvaluation } from './db'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// 소유자(관리자) 계정의 uid. 이 uid 로 로그인한 사용자만 전체 데이터를 열람·관리할 수 있다.
// firestore.rules 의 isOwner() 와 반드시 동일한 값이어야 한다.
const OWNER_UID = import.meta.env.VITE_OWNER_UID as string | undefined

let _app: FirebaseApp | null = null
let _db: Firestore | null = null
let _auth: Auth | null = null

function isConfigured(): boolean {
  return !!firebaseConfig.projectId
}

function getApp(): FirebaseApp {
  if (!_app) _app = initializeApp(firebaseConfig)
  return _app
}

function getDb(): Firestore {
  if (!_db) _db = getFirestore(getApp())
  return _db
}

function getAuthInstance(): Auth {
  if (!_auth) _auth = getAuth(getApp())
  return _auth
}

// ── 인증 ─────────────────────────────────────────────────────────────────────
//
// 모든 클라이언트는 Firebase Authentication 으로 로그인한다.
//   • 일반 사용자 → 익명 인증(signInAnonymously). uid 가 곧 기기 식별자(deviceId).
//   • 소유자(관리자) → 이메일/비밀번호 계정(uid == OWNER_UID).
// 인증된 신원(request.auth.uid)이 있어야 firestore.rules 가 "본인 것만 / 소유자만"
// 같은 신원 기반 제약을 적용할 수 있다.

let _authReady: Promise<User> | null = null

// 앱 시작 시 1회 호출: 로그인 상태를 보장한다.
// 저장된 세션(익명/소유자)이 있으면 그대로 복원하고, 없으면 익명 로그인한다.
export function ensureSignedIn(): Promise<User> {
  if (!isConfigured()) return Promise.reject(new Error('Firebase 미설정'))
  if (_authReady) return _authReady
  const auth = getAuthInstance()
  _authReady = new Promise<User>((resolve, reject) => {
    let kicked = false
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub()
          resolve(user)
        } else if (!kicked) {
          // 복원할 세션이 없음 → 익명 로그인 (성공 시 위 콜백이 다시 호출됨)
          kicked = true
          signInAnonymously(auth).catch((e) => {
            unsub()
            reject(e)
          })
        }
      },
      (e) => {
        unsub()
        reject(e)
      },
    )
  })
  return _authReady
}

// 현재 로그인한 사용자의 uid = 기기 식별자. (ensureSignedIn 이후에 호출해야 함)
export function getDeviceId(): string {
  return getAuthInstance().currentUser?.uid ?? ''
}

// 현재 로그인 계정이 소유자(관리자)인가?
export function isOwner(): boolean {
  const uid = getAuthInstance().currentUser?.uid
  return !!uid && !!OWNER_UID && uid === OWNER_UID
}

// 소유자 이메일/비밀번호 로그인. 성공 시 true.
// (소유자 계정이 아니면 다시 익명으로 되돌리고 false 반환)
export async function signInAsOwner(email: string, password: string): Promise<boolean> {
  const cred = await signInWithEmailAndPassword(getAuthInstance(), email, password)
  if (OWNER_UID && cred.user.uid !== OWNER_UID) {
    await signOutToAnonymous()
    return false
  }
  return true
}

// 소유자 로그아웃 → 일반 사용자(익명)로 복귀
export async function signOutToAnonymous(): Promise<void> {
  const auth = getAuthInstance()
  await signOut(auth)
  await signInAnonymously(auth)
}

// 소유자 비밀번호 변경 (현재 로그인 세션 기준)
export async function changeOwnerPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new Error('비밀번호는 6자 이상이어야 합니다.')
  const user = getAuthInstance().currentUser
  if (!user) throw new Error('로그인이 필요합니다.')
  await updatePassword(user, newPassword)
}

const IP_CACHE_KEY = 'studymeter_ip_cache'
const IP_CACHE_TTL = 24 * 60 * 60 * 1000 // 24시간 캐시

async function fetchIp(): Promise<string> {
  try {
    const raw = localStorage.getItem(IP_CACHE_KEY)
    if (raw) {
      const { ip, ts } = JSON.parse(raw) as { ip: string; ts: number }
      if (Date.now() - ts < IP_CACHE_TTL) return ip
    }
  } catch { /* ignore */ }
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    const ip = data.ip as string
    localStorage.setItem(IP_CACHE_KEY, JSON.stringify({ ip, ts: Date.now() }))
    return ip
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
    // 소유자 본인이 일반 사용자로도 쓰는 경우, 자기 문서에 관리자 표식을 단다.
    ...(isOwner() ? { isAdmin: true } : {}),
  })
  localStorage.setItem('studymeter_telemetry_name', name)
}

const BLOCKED_CACHE_KEY = 'studymeter_blocked_cache'
const BLOCKED_CACHE_TTL = 30 * 60 * 1000 // 30분 캐시

export async function checkBlocked(): Promise<boolean> {
  if (!isConfigured()) return false
  // 캐시가 유효하면 Firestore 읽기 없이 반환
  try {
    const raw = localStorage.getItem(BLOCKED_CACHE_KEY)
    if (raw) {
      const { blocked, ts } = JSON.parse(raw) as { blocked: boolean; ts: number }
      if (Date.now() - ts < BLOCKED_CACHE_TTL) return blocked
    }
  } catch { /* ignore */ }
  const deviceId = getDeviceId()
  let result = false
  try {
    const snap = await getDoc(doc(getDb(), 'users', deviceId))
    if (snap.exists()) result = snap.data().blocked === true
  } catch {
    // offline → don't block
  }
  localStorage.setItem(BLOCKED_CACHE_KEY, JSON.stringify({ blocked: result, ts: Date.now() }))
  return result
}

const LAST_SEEN_THROTTLE_KEY = 'studymeter_last_seen_ts'
const LAST_SEEN_MIN_INTERVAL = 4 * 60 * 60 * 1000 // 4시간에 1회만 Firestore 쓰기

export async function updateLastSeen(): Promise<void> {
  if (!isConfigured() || !isRegistered()) return
  // 최근 업데이트했으면 스킵 (Firestore 쓰기 절약)
  const lastTs = parseInt(localStorage.getItem(LAST_SEEN_THROTTLE_KEY) ?? '0', 10)
  if (Date.now() - lastTs < LAST_SEEN_MIN_INTERVAL) return
  const deviceId = getDeviceId()
  if (!deviceId) return
  const owner = isOwner()
  try {
    const ip = await fetchIp()
    const base = { name: getRegisteredName(), lastSeen: serverTimestamp(), ip }
    if (owner) {
      // 소유자: 본인 문서를 보장 생성하고 관리자 표식을 유지한다.
      await setDoc(doc(getDb(), 'users', deviceId), { ...base, isAdmin: true }, { merge: true })
    } else {
      // 일반 사용자: 이미 등록된 문서만 갱신한다.
      // (문서가 없으면 updateDoc이 실패하고 아래 catch에서 조용히 무시된다.)
      await updateDoc(doc(getDb(), 'users', deviceId), base)
    }
    localStorage.setItem(LAST_SEEN_THROTTLE_KEY, String(Date.now()))
  } catch {
    // 문서 없음 / 오프라인 등 → 무시
  }
}

// 소유자(관리자) 본인의 텔레메트리 문서를 보장 생성하고 isAdmin 표식을 단다.
// 관리자 페이지 진입 시 호출해, 일반 앱을 익명으로만 쓰던 소유자도 자기 항목에
// 관리자 배지가 뜨도록 한다.
export async function markOwnerAdmin(name?: string): Promise<void> {
  if (!isConfigured() || !isOwner()) return
  const deviceId = getDeviceId()
  if (!deviceId) return
  try {
    await setDoc(
      doc(getDb(), 'users', deviceId),
      {
        name: name || getRegisteredName() || '관리자',
        isAdmin: true,
        lastSeen: serverTimestamp(),
      },
      { merge: true },
    )
  } catch {
    // 무시
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

// 이 기기의 모든 로컬 공부 기록을 날짜별로 묶어 Firestore 에 일괄 업로드한다.
// (소유자가 관리자 페이지에서 자기 과거 기록을 한 번에 올려 볼 때 사용)
// 반환값: 업로드한 날짜(문서) 수.
export async function syncAllHistory(): Promise<number> {
  if (!isConfigured() || !isRegistered()) return 0
  const deviceId = getDeviceId()
  if (!deviceId) return 0

  const all = await db.sessions.toArray()
  const byDate = new Map<string, typeof all>()
  for (const s of all) {
    if (!s.date) continue
    const list = byDate.get(s.date) ?? []
    list.push(s)
    byDate.set(s.date, list)
  }

  let uploaded = 0
  for (const [date, sessions] of byDate) {
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
    try {
      await setDoc(doc(getDb(), 'users', deviceId, 'days', date), {
        date,
        updatedAt: serverTimestamp(),
        sessions: plain,
      })
      uploaded++
    } catch {
      // 개별 날짜 실패는 건너뛴다
    }
  }
  return uploaded
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
