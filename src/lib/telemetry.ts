import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  serverTimestamp,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'

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
  }))
}

export async function setUserBlocked(deviceId: string, blocked: boolean): Promise<void> {
  await updateDoc(doc(getDb(), 'users', deviceId), { blocked })
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
