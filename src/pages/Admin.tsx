import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import {
  getAllUsers,
  setUserBlocked,
  deleteUser,
  getUserSessions,
  isOwner,
  ensureSignedIn,
  signInAsOwner,
  signOutToAnonymous,
  changeOwnerPassword,
  markOwnerAdmin,
  syncAllHistory,
  type TelemetryUser,
  type AdminSession,
} from '../lib/telemetry'
import { formatDuration, formatDurationHourMinute, formatTimeHHMM, getTodayDate } from '../lib/db'

type Screen = 'loading' | 'login' | 'dashboard'

export default function Admin() {
  const [screen, setScreen] = useState<Screen>('loading')
  const [users, setUsers] = useState<TelemetryUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<TelemetryUser[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [detailUser, setDetailUser] = useState<TelemetryUser | null>(null)

  useEffect(() => {
    // 로그인 보장 후, 소유자 계정이면 바로 대시보드 / 아니면 로그인 화면
    ensureSignedIn()
      .then(() => setScreen(isOwner() ? 'dashboard' : 'login'))
      .catch(() => setScreen('login'))
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
    if (screen === 'dashboard') {
      // 소유자 본인 문서에 관리자 표식을 보장한 뒤 목록을 불러온다.
      markOwnerAdmin().finally(loadUsers)
    }
  }, [screen, loadUsers])

  const [syncingHistory, setSyncingHistory] = useState(false)
  const [historyMsg, setHistoryMsg] = useState<string | null>(null)

  async function handleSyncHistory() {
    setSyncingHistory(true)
    setHistoryMsg(null)
    try {
      const n = await syncAllHistory()
      setHistoryMsg(n > 0 ? `${n}일치 기록을 동기화했습니다.` : '동기화할 로컬 기록이 없습니다.')
      await loadUsers()
    } catch {
      setHistoryMsg('동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncingHistory(false)
    }
  }

  // 같은 이름(또는 이름 없는 유령 문서)이 여러 개면, 가장 대표적인 1개만 남기고
  // 나머지를 선택 상태로 만들어 삭제 흐름에 태운다. (관리자 배지 > 최근 접속 우선 보존)
  function selectDuplicatesForCleanup() {
    const byName = new Map<string, TelemetryUser[]>()
    for (const u of users) {
      const key = (u.name || '').trim()
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(u)
    }
    const next = new Set<string>()
    for (const [key, group] of byName) {
      if (!key) {
        // 이름 없는 유령 문서는 전부 정리 대상
        group.forEach((u) => next.add(u.id))
        continue
      }
      if (group.length < 2) continue
      const best = [...group].sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1
        return (b.lastSeen?.toMillis?.() ?? 0) - (a.lastSeen?.toMillis?.() ?? 0)
      })[0]
      group.forEach((u) => { if (u.id !== best.id) next.add(u.id) })
    }
    setSelectedIds(next)
  }

  const duplicateCount = useMemo(() => {
    const counts = new Map<string, number>()
    let ghosts = 0
    for (const u of users) {
      const key = (u.name || '').trim()
      if (!key) { ghosts++; continue }
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let extra = 0
    for (const c of counts.values()) if (c > 1) extra += c - 1
    return extra + ghosts
  }, [users])

  async function toggleBlock(user: TelemetryUser) {
    setTogglingId(user.id)
    try {
      await setUserBlocked(user.id, !user.blocked)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, blocked: !u.blocked } : u)))
    } finally {
      setTogglingId(null)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleDeleteConfirmed() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await Promise.all(confirmDelete.map((u) => deleteUser(u.id)))
      const removed = new Set(confirmDelete.map((u) => u.id))
      setUsers((prev) => prev.filter((u) => !removed.has(u.id)))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        removed.forEach((id) => next.delete(id))
        return next
      })
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const selectedUsers = users.filter((u) => selectedIds.has(u.id))

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

  if (screen === 'login') {
    return <LoginScreen onSuccess={() => setScreen('dashboard')} />
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
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="btn btn-glass px-3 py-2 text-sm flex items-center gap-1"
              title="이 기기의 모든 로컬 공부 기록을 올려 내 항목에서 볼 수 있게 합니다"
            >
              <Icon icon="mdi:cloud-upload-outline" className={`text-base ${syncingHistory ? 'animate-pulse' : ''}`} />
              {syncingHistory ? '동기화 중…' : '내 기록 동기화'}
            </button>
            {duplicateCount > 0 && (
              <button
                onClick={selectDuplicatesForCleanup}
                className="btn btn-glass px-3 py-2 text-sm flex items-center gap-1 text-amber-400"
                title="중복·빈 항목을 골라 삭제 목록에 담습니다"
              >
                <Icon icon="mdi:broom" className="text-base" />
                중복 정리 ({duplicateCount})
              </button>
            )}
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
              onClick={async () => { await signOutToAnonymous(); setScreen('login') }}
              className="btn btn-glass px-3 py-2 text-sm text-red-400"
            >
              로그아웃
            </button>
          </div>
        </div>

        {historyMsg && (
          <div className="glass-card px-4 py-2.5 mb-4 text-sm flex items-center gap-2 border border-indigo-400/20">
            <Icon icon="mdi:information-outline" className="text-indigo-400 text-base flex-shrink-0" />
            <span className="flex-1">{historyMsg}</span>
            <button onClick={() => setHistoryMsg(null)} className="opacity-50 hover:opacity-100">
              <Icon icon="mdi:close" className="text-base" />
            </button>
          </div>
        )}

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

        {/* 선택 삭제 바 */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="glass-card p-3 mb-4 flex items-center justify-between gap-3 border border-indigo-400/30"
            >
              <span className="text-sm font-bold flex items-center gap-2">
                <Icon icon="mdi:checkbox-multiple-marked" className="text-indigo-400 text-lg" />
                {selectedIds.size}명 선택됨
              </span>
              <div className="flex gap-2">
                <button onClick={clearSelection} className="btn btn-glass px-3 py-1.5 text-sm">
                  선택 해제
                </button>
                <button
                  onClick={() => setConfirmDelete(selectedUsers)}
                  className="px-3 py-1.5 rounded-xl text-sm font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all flex items-center gap-1"
                >
                  <Icon icon="mdi:trash-can-outline" className="text-base" />
                  선택 삭제
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
            {users.map((user, i) => {
              const selected = selectedIds.has(user.id)
              return (
                <motion.div
                  key={user.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`glass-card p-4 flex items-center gap-3 ${user.blocked ? 'border border-red-500/30 bg-red-500/5' : ''} ${selected ? 'ring-2 ring-indigo-400/60' : ''}`}
                >
                  {/* 선택 체크박스 */}
                  <button
                    onClick={() => toggleSelect(user.id)}
                    className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                      selected ? 'bg-indigo-500 border-indigo-500' : 'border-white/30 hover:border-white/60'
                    }`}
                    aria-label="선택"
                  >
                    {selected && <Icon icon="mdi:check" className="text-white text-base" />}
                  </button>

                  {/* 카드 본문: 클릭 시 상세 기록 보기 */}
                  <button
                    onClick={() => setDetailUser(user)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left group"
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 ${user.blocked ? 'bg-red-500/40' : 'bg-gradient-to-br from-indigo-500 to-purple-600'}`}>
                      {user.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base group-hover:text-indigo-400 transition-colors">{user.name}</span>
                        {user.isAdmin && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                            <Icon icon="mdi:shield-crown" className="text-xs" />관리자
                          </span>
                        )}
                        {user.blocked && (
                          <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">차단됨</span>
                        )}
                        <Icon icon="mdi:chevron-right" className="text-base opacity-30 group-hover:opacity-70 transition-opacity" />
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)] opacity-60 mt-0.5 flex flex-wrap gap-x-3">
                        <span className="font-mono">IP: {user.ip}</span>
                        <span>가입: {formatDate(user.registeredAt)}</span>
                        <span>최근: {formatDate(user.lastSeen)}</span>
                      </div>
                    </div>
                  </button>

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
                  <button
                    onClick={() => setConfirmDelete([user])}
                    className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 text-red-400 hover:bg-red-500/20 transition-all"
                    aria-label="삭제"
                    title="사용자 삭제"
                  >
                    <Icon icon="mdi:trash-can-outline" className="text-lg" />
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* 비밀번호 변경 모달 */}
      <AnimatePresence>
        {showChangePassword && (
          <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
        )}
      </AnimatePresence>

      {/* 삭제 확인 모달 */}
      <AnimatePresence>
        {confirmDelete && (
          <DeleteConfirmModal
            users={confirmDelete}
            deleting={deleting}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={handleDeleteConfirmed}
          />
        )}
      </AnimatePresence>

      {/* 사용자 상세 기록 모달 */}
      <AnimatePresence>
        {detailUser && (
          <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── 삭제 확인 모달 ───────────────────────────────────────────────────────────

function DeleteConfirmModal({
  users, deleting, onCancel, onConfirm,
}: {
  users: TelemetryUser[]
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const multiple = users.length > 1
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="glass-card p-7 max-w-sm w-full"
      >
        <div className="text-center mb-5">
          <Icon icon="mdi:alert-circle-outline" className="text-5xl text-red-400 mb-3" />
          <h2 className="text-xl font-black">사용자 삭제</h2>
          <p className="text-sm text-[var(--color-text-secondary)] opacity-70 mt-2">
            {multiple
              ? `선택한 ${users.length}명의 사용자와 모든 공부 기록을 삭제합니다.`
              : `"${users[0].name}" 사용자와 모든 공부 기록을 삭제합니다.`}
            <br />이 작업은 되돌릴 수 없습니다.
          </p>
        </div>
        {multiple && (
          <div className="max-h-32 overflow-y-auto mb-4 flex flex-wrap gap-1.5">
            {users.map((u) => (
              <span key={u.id} className="text-xs bg-white/5 px-2 py-1 rounded-full">{u.name}</span>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={deleting} className="btn btn-glass flex-1 py-3 font-bold disabled:opacity-40">
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 py-3 rounded-xl font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-40"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── 사용자 상세 기록 모달 (앱의 기록 챕터처럼) ──────────────────────────────

const SUBJECT_COLORS = ['#6366f1', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

function UserDetailModal({ user, onClose }: { user: TelemetryUser; onClose: () => void }) {
  const [sessions, setSessions] = useState<AdminSession[] | null>(null)
  const [selectedDate, setSelectedDate] = useState(getTodayDate())

  useEffect(() => {
    let cancelled = false
    getUserSessions(user.id)
      .then((data) => { if (!cancelled) setSessions(data) })
      .catch(() => { if (!cancelled) setSessions([]) })
    return () => { cancelled = true }
  }, [user.id])

  // 기록이 있는 날짜 목록 (최신순)
  const availableDates = useMemo(() => {
    if (!sessions) return []
    return Array.from(new Set(sessions.map((s) => s.date))).sort((a, b) => b.localeCompare(a))
  }, [sessions])

  const daySessions = useMemo(() => {
    if (!sessions) return []
    return sessions
      .filter((s) => s.date === selectedDate)
      .sort((a, b) => b.startTime - a.startTime)
  }, [sessions, selectedDate])

  const totalTime = daySessions.reduce((sum, s) => sum + s.duration, 0)
  const selfStudyTime = daySessions
    .filter((s) => s.type === '자습' || s.type === '테스트')
    .reduce((sum, s) => sum + s.duration, 0)

  // 과목별 집계
  const bySubject = useMemo(() => {
    const map = new Map<string, number>()
    daySessions.forEach((s) => map.set(s.subject, (map.get(s.subject) ?? 0) + s.duration))
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [daySessions])
  const maxSubject = bySubject.length > 0 ? bySubject[0][1] : 0

  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T00:00:00')
    d.setDate(d.getDate() + days)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    setSelectedDate(`${y}-${m}-${day}`)
  }

  function formatDayLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    const days = ['일', '월', '화', '수', '목', '금', '토']
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
  }

  const isToday = selectedDate === getTodayDate()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="glass-card w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* 헤더 */}
        <div className="p-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600">
            {user.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black truncate">{user.name}</h2>
            <p className="text-xs text-[var(--color-text-secondary)] opacity-60 font-mono">IP: {user.ip}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all">
            <Icon icon="mdi:close" className="text-xl" />
          </button>
        </div>

        {/* 날짜 네비게이션 */}
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-center gap-2">
          <button onClick={() => shiftDate(-1)} className="p-1.5 rounded-lg hover:bg-white/10 transition-all">
            <Icon icon="mdi:chevron-left" className="text-xl" />
          </button>
          <span className="text-sm font-bold min-w-[140px] text-center flex items-center justify-center gap-1.5">
            <Icon icon="mdi:calendar" className="text-base opacity-60" />
            {formatDayLabel(selectedDate)}
          </span>
          <button onClick={() => shiftDate(1)} className="p-1.5 rounded-lg hover:bg-white/10 transition-all">
            <Icon icon="mdi:chevron-right" className="text-xl" />
          </button>
          {!isToday && (
            <button
              onClick={() => setSelectedDate(getTodayDate())}
              className="px-2.5 py-1 rounded-lg bg-[var(--color-primary)] text-white text-xs font-bold"
            >
              오늘
            </button>
          )}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5">
          {sessions === null ? (
            <div className="text-center py-16 text-[var(--color-text-secondary)] opacity-50">
              <Icon icon="mdi:loading" className="text-4xl animate-spin mb-3" />
              <p>불러오는 중...</p>
            </div>
          ) : (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-secondary)] opacity-60 mb-1">총 공부</p>
                  <p className="text-base font-black gradient-text">{formatDuration(totalTime)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-secondary)] opacity-60 mb-1">순공</p>
                  <p className="text-base font-black">{formatDuration(selfStudyTime)}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 text-center">
                  <p className="text-[11px] text-[var(--color-text-secondary)] opacity-60 mb-1">세션</p>
                  <p className="text-base font-black">{daySessions.length}회</p>
                </div>
              </div>

              {/* 과목별 집계 */}
              {bySubject.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-xs font-bold text-[var(--color-text-secondary)] opacity-70 mb-2 uppercase tracking-wider">과목별 공부 시간</h3>
                  <div className="flex flex-col gap-2">
                    {bySubject.map(([subject, ms], idx) => (
                      <div key={subject} className="flex items-center gap-2">
                        <span className="text-xs font-medium w-14 truncate flex-shrink-0">{subject}</span>
                        <div className="flex-1 h-5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${maxSubject > 0 ? (ms / maxSubject) * 100 : 0}%`,
                              background: SUBJECT_COLORS[idx % SUBJECT_COLORS.length],
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold w-16 text-right flex-shrink-0">{formatDurationHourMinute(ms)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 세션 목록 */}
              <h3 className="text-xs font-bold text-[var(--color-text-secondary)] opacity-70 mb-2 uppercase tracking-wider">공부 기록</h3>
              {daySessions.length === 0 ? (
                <div className="text-center py-10 text-[var(--color-text-secondary)] opacity-50">
                  <Icon icon="mdi:bookshelf" className="text-4xl mb-2" />
                  <p className="text-sm">이 날의 공부 기록이 없습니다.</p>
                  {availableDates.length > 0 && (
                    <p className="text-xs mt-2 opacity-70">
                      기록 있는 날: {availableDates.slice(0, 5).map(formatDayLabel).join(', ')}
                      {availableDates.length > 5 ? ' …' : ''}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {daySessions.map((s) => (
                    <div key={s.id} className="p-3 bg-white/5 rounded-xl">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-bold text-sm">{s.subject}</span>
                          {s.subItem && <span className="text-[var(--color-primary)] text-xs">› {s.subItem}</span>}
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--color-text-secondary)]">{s.type}</span>
                        </div>
                        <div className="text-right flex-shrink-0 ml-2">
                          <p className="font-bold text-sm">{formatDuration(s.duration)}</p>
                          <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60">
                            {formatTimeHHMM(s.startTime)} ~ {formatTimeHHMM(s.endTime)}
                          </p>
                        </div>
                      </div>
                      {s.evaluation && (
                        <div className="flex items-center gap-3 pt-2 mt-2 border-t border-white/5 flex-wrap">
                          <div className="flex items-center gap-1">
                            <Icon icon="mdi:fire" className="text-sm text-orange-400" />
                            <span className="text-[10px] text-[var(--color-text-secondary)]">집중</span>
                            <span className="text-xs font-bold text-indigo-400">{s.evaluation.focus}/10</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Icon icon="mdi:diamond-stone" className="text-sm text-cyan-400" />
                            <span className="text-[10px] text-[var(--color-text-secondary)]">만족</span>
                            <span className="text-xs font-bold text-emerald-400">{s.evaluation.satisfaction}/10</span>
                          </div>
                          {s.evaluation.problemSolving && (
                            <div className="flex items-center gap-1">
                              <Icon icon="mdi:check-circle-outline" className="text-sm text-green-400" />
                              <span className="text-[10px] text-[var(--color-text-secondary)]">문제</span>
                              <span className="text-xs font-bold text-amber-400">
                                {s.evaluation.problemSolving.correct}/{s.evaluation.problemSolving.total}
                              </span>
                            </div>
                          )}
                          {s.evaluation.memo && (
                            <span className="text-xs text-[var(--color-text-secondary)] italic truncate flex-1 min-w-0">"{s.evaluation.memo}"</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── 로그인 화면 (소유자 이메일/비밀번호) ───────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const ok = await signInAsOwner(email.trim(), pw)
      if (ok) {
        onSuccess()
      } else {
        setError('관리자 계정이 아닙니다.')
        setLoading(false)
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      setError(
        code === 'auth/too-many-requests'
          ? '시도가 너무 많습니다. 잠시 후 다시 시도하세요.'
          : '이메일 또는 비밀번호가 올바르지 않습니다.'
      )
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
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            placeholder="관리자 이메일"
            autoComplete="username"
            autoFocus
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)]"
          />
          <PasswordInput
            value={pw}
            onChange={(v) => { setPw(v); setError('') }}
            placeholder="비밀번호"
            error={!!error}
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" disabled={loading || !email || !pw} className="btn btn-primary py-3 font-bold disabled:opacity-40">
            {loading ? '확인 중...' : '로그인'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

// ── 비밀번호 변경 모달 ───────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
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
      await changeOwnerPassword(next)
      setDone(true)
    } catch (err) {
      const code = (err as { code?: string })?.code ?? ''
      setError(
        code === 'auth/requires-recent-login'
          ? '보안을 위해 로그아웃 후 다시 로그인한 뒤 변경해주세요.'
          : err instanceof Error ? err.message : '오류가 발생했습니다.'
      )
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
              <PasswordInput value={next} onChange={setNext} placeholder="새 비밀번호 (6자 이상)" />
              <PasswordInput value={next2} onChange={setNext2} placeholder="새 비밀번호 확인" />
              {error && <p className="text-red-400 text-sm text-center">{error}</p>}
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={onClose} className="btn btn-glass flex-1 py-3 font-bold">취소</button>
                <button type="submit" disabled={loading || !next || !next2} className="btn btn-primary flex-1 py-3 font-bold disabled:opacity-40">
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
