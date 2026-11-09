import { useState } from 'react'
import { motion } from 'framer-motion'
import BrandMark from './ui/BrandMark'
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="liquid-modal p-6 max-w-sm w-full mx-4"
      >
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <BrandMark className="w-5 h-5 text-[var(--color-text)]" />
            <span className="text-[17px] font-semibold">StudyMeter</span>
          </div>
          <h2 className="text-[22px] font-medium mt-5 text-[var(--color-text)]">처음 오셨군요</h2>
          <p className="text-[15px] text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">
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
            className="w-full h-12 px-4 rounded-xl text-[var(--color-text)] text-[17px]"
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
            className="btn btn-primary h-12 text-[15px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '등록 중…' : '시작하기'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
