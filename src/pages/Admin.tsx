import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import {
  getAllUsers,
  setUserBlocked,
  isAdminPasswordSet,
  verifyAdminPassword,
  setAdminPassword,
  type TelemetryUser,
} from '../lib/telemetry'

type Screen = 'loading' | 'setup' | 'login' | 'dashboard'

export default function Admin() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [users, setUsers] = useState<TelemetryUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)

  useEffect(() => {
    isAdminPasswordSet().then((set) => {
      if (sessionStorage.getItem('studymeter_admin') === '1') {
        setScreen('dashboard')
      } else {
        setScreen(set ? 'login' : 'setup')
      }
    })
  }, [])

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const data = await getAllUsers()
      setUsers(
        data.sort((a, b) => (b.lastSeen?.toMillis?.() ?? 0) - (a.lastSeen?.toMillis?.() ?? 0))
      )
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  useEffect(() => {
    if (screen === 'dashboard') loadUsers()
  }, [screen, loadUsers])

  async function toggleBlock(user: TelemetryUser) {
    setTogglingId(user.id)
    try {
      await setUserBlocked(user.id, !user.blocked)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, blocked: !u.blocked } : u)))
    } finally {
      setTogglingId(null)
    }
  }

  function formatDate(ts: TelemetryUser['lastSeen']): string {
    if (!ts) return '-'
    try {
      return ts.toDate().toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return '-' }
  }

  if (screen === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <Icon icon="mdi:loading" className="text-4xl text-[var(--color-primary)] animate-spin" />
      </div>
    )
  }

  if (screen === 'setup') {
    return <SetupScreen onDone={() => setScreen('dashboard')} />
  }

  if (screen === 'login') {
    return (
      <LoginScreen
        onSuccess={() => {
          sessionStorage.setItem('studymeter_admin', '1')
          setScreen('dashboard')
        }}
      />
    )
  }

  const active = users.filter((u) => !u.blocked).length
  const blocked = users.filter((u) => u.blocked).length

  return (
    <div className="min-h-screen p-6 bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-black gradient-text">사용자 관리</h1>
            <p className="text-sm text-[var(--color-text-secondary)] opacity-60 mt-1">
              전체 {users.length}명 · 활성 {active}명 · 차단 {blocked}명
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowChangePassword(true)}
              className="btn btn-glass px-3 py-2 text-sm flex items-center gap-1"
            >
              <Icon icon="mdi:lock-reset" className="text-base" />
              비밀번호 변경
            </button>
            <button
              onClick={loadUsers}
              disabled={loadingUsers}
              className="btn btn-glass px-3 py-2 text-sm flex items-center gap-1"
            >
              <Icon icon="mdi:refresh" className={`text-base ${loadingUsers ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => { sessionStorage.removeItem('studymeter_admin'); setScreen('login') }}
              className="btn btn-glass px-3 py-2 text-sm text-red-400"
            >
              로그아웃
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '전체 사용자', value: users.length, icon: 'mdi:account-group', color: 'text-indigo-400' },
            { label: '활성', value: active, icon: 'mdi:account-check', color: 'text-green-400' },
            { label: '차단됨', value: blocked, icon: 'mdi:account-cancel', color: 'text-red-400' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="glass-card p-4 text-center">
              <Icon icon={icon} className={`text-2xl ${color} mb-1`} />
              <div className="text-2xl font-black">{value}</div>
              <div className="text-xs text-[var(--color-text-secondary)] opacity-60">{label}</div>
            </div>
          ))}
        </div>

        {/* User list */}
        {loadingUsers ? (
          <div className="text-center py-20 text-[var(--color-text-secondary)] opacity-50">
            <Icon icon="mdi:loading" className="text-4xl animate-spin mb-3" />
            <p>불러오는 중...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-20 text-[var(--color-text-secondary)] opacity-50">
            <Icon icon="mdi:account-off-outline" className="text-5xl mb-3" />
            <p>아직 등록된 사용자가 없습니다.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {users.map((user, i) => (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`glass-card p-4 flex items-center gap-4 ${user.blocked ? 'border border-red-500/30 bg-red-500/5' : ''}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 ${user.blocked ? 'bg-red-500/40' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-base">{user.name}</span>
                    {user.blocked && (
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">차단됨</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)] opacity-60 mt-0.5 flex flex-wrap gap-x-3">
                    <span className="font-mono">IP: {user.ip}</span>
                    <span>가입: {formatDate(user.registeredAt)}</span>
                    <span>최근: {formatDate(user.lastSeen)}</span>
                  </div>
                </div>
                <button
                  onClick={() => toggleBlock(user)}
                  disabled={togglingId === user.id}
                  className={`flex-shrink-0 px-4 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                    user.blocked
                      ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  }`}
                >
                  {togglingId === user.id ? '...' : user.blocked ? '차단 해제' : '차단'}
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 비밀번호 변경 모달 */}
      <AnimatePresence>
        {showChangePassword && (
          <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── 초기 비밀번호 설정 화면 ─────────────────────────────────────────────────

function SetupScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return }
    if (pw !== pw2) { setError('비밀번호가 일치하지 않습니다.'); return }
    setLoading(true)
    try {
      await setAdminPassword(pw)
      sessionStorage.setItem('studymeter_admin', '1')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-8 max-w-sm w-full mx-4"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Icon icon="mdi:shield-lock" className="text-white text-xl" />
          </div>
          <div>
            <h1 className="text-xl font-black gradient-text">관리자 설정</h1>
            <p className="text-xs text-[var(--color-text-secondary)] opacity-60">최초 1회 비밀번호 설정</p>
          </div>
        </div>
        <p className="text-xs text-yellow-400/80 bg-yellow-500/10 rounded-xl px-3 py-2 mb-6">
          비밀번호는 암호화되어 서버에 저장됩니다. 분실 시 재설정 방법이 없으니 안전한 곳에 보관하세요.
        </p>
        <form onSubmit={handleSetup} className="flex flex-col gap-3">
          <PasswordInput value={pw} onChange={setPw} placeholder="새 비밀번호 (6자 이상)" />
          <PasswordInput value={pw2} onChange={setPw2} placeholder="비밀번호 확인" />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" disabled={loading || !pw || !pw2} className="btn btn-primary py-3 font-bold disabled:opacity-40">
            {loading ? '설정 중...' : '비밀번호 설정 및 시작'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

// ── 로그인 화면 ─────────────────────────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(false)
    const ok = await verifyAdminPassword(pw)
    if (ok) {
      onSuccess()
    } else {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-8 max-w-sm w-full mx-4"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Icon icon="mdi:shield-lock" className="text-white text-xl" />
          </div>
          <div>
            <h1 className="text-xl font-black gradient-text">관리자 페이지</h1>
            <p className="text-xs text-[var(--color-text-secondary)] opacity-60">StudyMeter Admin</p>
          </div>
        </div>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <PasswordInput
            value={pw}
            onChange={(v) => { setPw(v); setError(false) }}
            placeholder="비밀번호"
            error={error}
            autoFocus
          />
          {error && <p className="text-red-400 text-sm text-center">비밀번호가 올바르지 않습니다.</p>}
          <button type="submit" disabled={loading || !pw} className="btn btn-primary py-3 font-bold disabled:opacity-40">
            {loading ? '확인 중...' : '로그인'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

// ── 비밀번호 변경 모달 ───────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleChange(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 6) { setError('새 비밀번호는 6자 이상이어야 합니다.'); return }
    if (next !== next2) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    setLoading(true)
    setError('')
    try {
      await setAdminPassword(next, current)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="glass-card p-7 max-w-sm w-full mx-4"
      >
        {done ? (
          <div className="text-center py-4">
            <Icon icon="mdi:check-circle" className="text-5xl text-green-400 mb-3" />
            <p className="font-bold text-lg">비밀번호가 변경되었습니다.</p>
            <button onClick={onClose} className="btn btn-primary w-full py-3 mt-6 font-bold">확인</button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-black mb-6 gradient-text">비밀번호 변경</h2>
            <form onSubmit={handleChange} className="flex flex-col gap-3">
              <PasswordInput value={current} onChange={setCurrent} placeholder="현재 비밀번호" />
              <PasswordInput value={next} onChange={setNext} placeholder="새 비밀번호 (6자 이상)" />
              <PasswordInput value={next2} onChange={setNext2} placeholder="새 비밀번호 확인" />
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={onClose} className="btn btn-glass flex-1 py-3 font-bold">취소</button>
                <button type="submit" disabled={loading || !current || !next || !next2} className="btn btn-primary flex-1 py-3 font-bold disabled:opacity-40">
                  {loading ? '변경 중...' : '변경'}
                </button>
              </div>
            </form>
          </>
        )}
      </motion.div>
    </div>
  )
}

// ── 비밀번호 입력 공통 컴포넌트 ─────────────────────────────────────────────

function PasswordInput({
  value, onChange, placeholder, error, autoFocus
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  error?: boolean
  autoFocus?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full px-4 py-3 pr-11 rounded-xl bg-white/10 border ${error ? 'border-red-500/50' : 'border-white/20'} text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)]`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] opacity-50 hover:opacity-80"
      >
        <Icon icon={show ? 'mdi:eye-off' : 'mdi:eye'} className="text-lg" />
      </button>
    </div>
  )
}
