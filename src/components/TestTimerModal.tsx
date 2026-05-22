import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'

interface TestTimerModalProps {
    onClose: () => void
    onConfirm: (minutes: number) => void
}

interface Preset {
    label: string
    value: number
    type?: string
}

export default function TestTimerModal({ onClose, onConfirm }: TestTimerModalProps) {
    const [customMinutes, setCustomMinutes] = useState('')

    const presets: Preset[] = [
        { label: '국어', value: 80, type: 'subject' },
        { label: '수학', value: 100, type: 'subject' },
        { label: '영어', value: 70, type: 'subject' },
        { label: '30분', value: 30 },
        { label: '40분', value: 40 },
        { label: '50분', value: 50 },
    ]

    const handleConfirm = () => {
        const mins = parseInt(customMinutes)
        if (!isNaN(mins) && mins > 0) {
            onConfirm(mins)
        }
    }

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/50 backdrop-blur-xl"
                onClick={onClose}
            />

            {/* Modal Content */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative liquid-modal max-w-md w-full p-8 flex flex-col gap-6 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <header>
                    <h2 className="text-2xl font-black gradient-text flex items-center gap-2">
                        <Icon icon="mdi:timer-outline" /> 테스트 타이머 설정
                    </h2>
                    <p className="text-[var(--color-text-secondary)] text-sm font-medium mt-1">테스트 시간을 지정해 주세요.</p>
                </header>

                <div className="grid grid-cols-3 gap-2">
                    {presets.map((preset) => (
                        <button
                            key={preset.label}
                            onClick={() => onConfirm(preset.value)}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)] group`}
                        >
                            <span className="text-[10px] font-black opacity-50 group-hover:text-white/80 uppercase mb-0.5">{preset.type === 'subject' ? '과목' : '시간'}</span>
                            <span className="text-sm font-bold group-hover:text-white">{preset.label}</span>
                            {preset.type === 'subject' && <span className="text-[10px] font-medium group-hover:text-white/70 mt-1">{preset.value}분</span>}
                        </button>
                    ))}
                </div>

                <div className="flex flex-col gap-3">
                    <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">직접 입력 (분)</p>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            placeholder="분 단위 입력"
                            value={customMinutes}
                            onChange={(e) => setCustomMinutes(e.target.value)}
                            className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] font-bold"
                        />
                        <button
                            onClick={handleConfirm}
                            disabled={!customMinutes || parseInt(customMinutes) <= 0}
                            className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl font-bold disabled:opacity-30 transition-all shadow-lg active:scale-95"
                        >
                            설정
                        </button>
                    </div>
                </div>

                <button onClick={onClose} className="w-full py-4 bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] text-xs font-bold rounded-xl transition-all">취소</button>
            </motion.div>
        </div>,
        document.body
    )
}
