import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import {
  isAdminPasswordSet,
  verifyAdminPassword,
  setAdminPassword,
  registerDeviceAsAdmin,
  isTelemetryConfigured,
} from '../lib/telemetry'

type Mode = 'loading' | 'setup' | 'enter' | 'change' | 'done'

interface DevAccessModalProps {
  onClose: () => void
  onAuthed: () => void // 인증/등록 성공 → 관리자 페이지로 이동
}

// 버전명 5회 탭으로 열리는 숨겨진 개발자(소유자) 진입 모달
export default function DevAccessModal({ onClose, onAuthed }: DevAccessModalProps) {
  const [mode, setMode] = useState<Mode>('loading')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [current, setCurrent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isTelemetryConfigured()) {
      setError('서버가 설정되지 않아 사용할 수 없습니다.')
      setMode('enter')
      return
    }
    isAdminPasswordSet().then((set) => setMode(set ? 'enter' : 'setup'))
  }, [])

  function resetFields() {
    setPw(''); setPw2(''); setCurrent(''); setError('')
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return }
    if (pw !== pw2) { setError('비밀번호가 일치하지 않습니다.'); return }
    setLoading(true); setError('')
    try {
      await setAdminPassword(pw)
      await registerDeviceAsAdmin()
      onAuthed()
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      setLoading(false)
    }
  }

  async function handleEnter(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const ok = await verifyAdminPassword(pw)
      if (!ok) {
        setError('비밀번호가 올바르지 않습니다.')
        setLoading(false)
        return
      }
      await registerDeviceAsAdmin()
      onAuthed()
    } catch {
      setError('오류가 발생했습니다.')
      setLoading(false)
    }
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 6) { setError('새 비밀번호는 6자 이상이어야 합니다.'); return }
    if (pw !== pw2) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    setLoading(true); setError('')
    try {
      await setAdminPassword(pw, current)
      setMode('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.92 }}
        className="glass-card p-7 max-w-sm w-full"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Icon icon="mdi:shield-key" className="text-white text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black gradient-text">
              {mode === 'change' ? '관리자 비밀번호 변경'
                : mode === 'setup' ? '관리자 비밀번호 설정'
                : '관리자 인증'}
            </h1>
            <p className="text-xs text-[var(--color-text-secondary)] opacity-60">소유자 전용 · 관리자 페이지와 동일한 비밀번호</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-all flex-shrink-0">
            <Icon icon="mdi:close" className="text-lg" />
          </button>
        </div>

        {mode === 'loading' && (
          <div className="py-8 text-center text-[var(--color-text-secondary)] opacity-60">
            <Icon icon="mdi:loading" className="text-3xl animate-spin" />
          </div>
        )}

        {mode === 'setup' && (
          <form onSubmit={handleSetup} className="flex flex-col gap-3">
            <p className="text-xs text-yellow-400/80 bg-yellow-500/10 rounded-xl px-3 py-2">
              아직 관리자 비밀번호가 없습니다. 지금 설정하는 비밀번호가 관리자 페이지 로그인과
              공통으로 사용됩니다. 가장 먼저 본인이 설정해 두세요.
            </p>
            <PwInput value={pw} onChange={setPw} placeholder="새 비밀번호 (6자 이상)" autoFocus />
            <PwInput value={pw2} onChange={setPw2} placeholder="비밀번호 확인" />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button type="submit" disabled={loading || !pw || !pw2} className="btn btn-primary py-3 font-bold disabled:opacity-40">
              {loading ? '설정 중...' : '설정하고 관리자 등록'}
            </button>
          </form>
        )}

        {mode === 'enter' && (
          <form onSubmit={handleEnter} className="flex flex-col gap-3">
            <PwInput value={pw} onChange={(v) => { setPw(v); setError('') }} placeholder="비밀번호" autoFocus />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button type="submit" disabled={loading || !pw} className="btn btn-primary py-3 font-bold disabled:opacity-40">
              {loading ? '확인 중...' : '인증하고 관리자 등록'}
            </button>
            <button
              type="button"
              onClick={() => { resetFields(); setMode('change') }}
              className="text-xs text-[var(--color-text-secondary)] opacity-60 hover:opacity-100 transition-opacity mt-1"
            >
              비밀번호 변경
            </button>
          </form>
        )}

        {mode === 'change' && (
          <form onSubmit={handleChange} className="flex flex-col gap-3">
            <PwInput value={current} onChange={setCurrent} placeholder="현재 비밀번호" autoFocus />
            <PwInput value={pw} onChange={setPw} placeholder="새 비밀번호 (6자 이상)" />
            <PwInput value={pw2} onChange={setPw2} placeholder="새 비밀번호 확인" />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <div className="flex gap-2 mt-1">
              <button type="button" onClick={() => { resetFields(); setMode('enter') }} className="btn btn-glass flex-1 py-3 font-bold">
                취소
              </button>
              <button type="submit" disabled={loading || !current || !pw || !pw2} className="btn btn-primary flex-1 py-3 font-bold disabled:opacity-40">
                {loading ? '변경 중...' : '변경'}
              </button>
            </div>
          </form>
        )}

        {mode === 'done' && (
          <div className="text-center py-3">
            <Icon icon="mdi:check-circle" className="text-5xl text-green-400 mb-3" />
            <p className="font-bold">비밀번호가 변경되었습니다.</p>
            <button onClick={() => { resetFields(); setMode('enter') }} className="btn btn-primary w-full py-3 mt-5 font-bold">
              확인
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function PwInput({
  value, onChange, placeholder, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
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
        autoComplete="off"
        className="w-full px-4 py-3 pr-11 rounded-xl bg-white/10 border border-white/20 text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)]"
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
