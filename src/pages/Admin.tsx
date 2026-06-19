import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { getAllUsers, setUserBlocked, type TelemetryUser } from '../lib/telemetry'

const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY as string | undefined

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [authError, setAuthError] = useState(false)
  const [users, setUsers] = useState<TelemetryUser[]>([])
  const [loading, setLoading] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    if (sessionStorage.getItem('studymeter_admin') === '1') {
      setAuthenticated(true)
    }
  }, [])

  function authenticate() {
    if (!ADMIN_KEY) { setAuthError(true); return }
    if (keyInput === ADMIN_KEY) {
      sessionStorage.setItem('studymeter_admin', '1')
      setAuthenticated(true)
      setAuthError(false)
    } else {
      setAuthError(true)
    }
  }

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getAllUsers()
      setUsers(data.sort((a, b) => {
        const at = a.lastSeen?.toMillis?.() ?? 0
        const bt = b.lastSeen?.toMillis?.() ?? 0
        return bt - at
      }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authenticated) loadUsers()
  }, [authenticated, loadUsers])

  async function toggleBlock(user: TelemetryUser) {
    setTogglingId(user.id)
    try {
      await setUserBlocked(user.id, !user.blocked)
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, blocked: !u.blocked } : u))
      )
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
    } catch {
      return '-'
    }
  }

  if (!authenticated) {
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

          <div className="flex flex-col gap-4">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setAuthError(false) }}
              onKeyDown={(e) => e.key === 'Enter' && authenticate()}
              placeholder="관리자 키 입력"
              className={`w-full px-4 py-3 rounded-xl bg-white/10 border ${authError ? 'border-red-500/50' : 'border-white/20'} text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]`}
              autoFocus
            />
            {authError && (
              <p className="text-red-400 text-sm text-center">
                {!ADMIN_KEY ? 'VITE_ADMIN_KEY 환경변수가 설정되지 않았습니다.' : '키가 올바르지 않습니다.'}
              </p>
            )}
            <button onClick={authenticate} className="btn btn-primary py-3 font-bold">
              로그인
            </button>
          </div>
        </motion.div>
      </div>
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
              onClick={loadUsers}
              disabled={loading}
              className="btn btn-glass px-4 py-2 text-sm flex items-center gap-1"
            >
              <Icon icon="mdi:refresh" className={`text-base ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => { sessionStorage.removeItem('studymeter_admin'); setAuthenticated(false) }}
              className="btn btn-glass px-4 py-2 text-sm text-red-400"
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
        {loading ? (
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
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 ${user.blocked ? 'bg-red-500/40' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
                  {user.name.charAt(0)}
                </div>

                {/* Info */}
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
                    <span>최근 접속: {formatDate(user.lastSeen)}</span>
                  </div>
                </div>

                {/* Block button */}
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
    </div>
  )
}
