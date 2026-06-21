import { useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { signInAsOwner, isTelemetryConfigured } from '../lib/telemetry'

interface DevAccessModalProps {
  onClose: () => void
  onAuthed: () => void // 소유자 인증 성공 → 관리자 페이지로 이동
}

// 버전명 5회 탭으로 열리는 숨겨진 소유자(관리자) 진입 모달.
// 관리자 계정(이메일/비밀번호)으로 로그인하면 관리자 페이지로 이동한다.
export default function DevAccessModal({ onClose, onAuthed }: DevAccessModalProps) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const configured = isTelemetryConfigured()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const ok = await signInAsOwner(email.trim(), pw)
      if (!ok) {
        setError('관리자 계정이 아닙니다.')
        setLoading(false)
        return
      }
      onAuthed()
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
            <h1 className="text-lg font-black gradient-text">관리자 인증</h1>
            <p className="text-xs text-[var(--color-text-secondary)] opacity-60">소유자 전용 · 이메일/비밀번호 로그인</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-all flex-shrink-0">
            <Icon icon="mdi:close" className="text-lg" />
          </button>
        </div>

        {!configured ? (
          <p className="text-sm text-red-400 text-center py-6">서버가 설정되지 않아 사용할 수 없습니다.</p>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError('') }}
              placeholder="관리자 이메일"
              autoComplete="username"
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)]"
            />
            <PwInput value={pw} onChange={(v) => { setPw(v); setError('') }} placeholder="비밀번호" />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button type="submit" disabled={loading || !email || !pw} className="btn btn-primary py-3 font-bold disabled:opacity-40">
              {loading ? '확인 중...' : '로그인'}
            </button>
          </form>
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
        autoComplete="current-password"
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
