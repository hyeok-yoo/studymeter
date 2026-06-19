import { useState } from 'react'
import { motion } from 'framer-motion'
import { registerUser } from '../lib/telemetry'

interface Props {
  onDone: (name: string) => void
}

export default function NameRegistrationModal({ onDone }: Props) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('이름을 입력해주세요.'); return }
    if (trimmed.length < 2) { setError('이름은 2자 이상이어야 합니다.'); return }
    setLoading(true)
    setError('')
    try {
      await registerUser(trimmed)
      onDone(trimmed)
    } catch {
      setError('등록 중 오류가 발생했습니다. 다시 시도해주세요.')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 20 }}
        className="glass-card p-8 max-w-sm w-full mx-4 border border-white/20"
      >
        <div className="text-center mb-8">
          <span className="gradient-text text-4xl font-black">StudyMeter</span>
          <h2 className="text-xl font-bold mt-4 text-[var(--color-text)]">처음 오셨군요!</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2 leading-relaxed opacity-70">
            앱에서 사용할 한글 이름을 입력해주세요.<br />
            한 번만 입력하면 됩니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)] text-lg text-center font-bold"
            autoFocus
            maxLength={20}
            disabled={loading}
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn btn-primary py-3.5 font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '등록 중...' : '시작하기'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
