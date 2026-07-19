import { useState } from 'react'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import Sheet from './ui/Sheet'
import Pressable from './ui/Pressable'
import { staggerContainer, staggerItem } from '../lib/motion'

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

    return (
        <Sheet open onClose={onClose} zIndex={9600} ariaLabel="테스트 타이머 설정" maxHeight="80dvh">
            <header className="mb-6">
                <h2 className="text-2xl font-black gradient-text flex items-center gap-2 text-display">
                    <Icon icon="mdi:timer-outline" /> 테스트 타이머 설정
                </h2>
                <p className="text-[var(--color-text-secondary)] text-sm font-medium mt-1">테스트 시간을 지정해 주세요.</p>
            </header>

            <motion.div
                className="grid grid-cols-3 gap-2"
                variants={staggerContainer}
                initial="initial"
                animate="animate"
            >
                {presets.map((preset) => (
                    <motion.div key={preset.label} variants={staggerItem}>
                        <Pressable
                            onClick={() => onConfirm(preset.value)}
                            pressScale={0.95}
                            className="w-full flex flex-col items-center justify-center p-3 rounded-2xl glass-card-elevated"
                        >
                            <span className="text-[10px] font-black opacity-50 uppercase mb-0.5 text-[var(--color-text-secondary)]">{preset.type === 'subject' ? '과목' : '시간'}</span>
                            <span className="text-sm font-bold text-[var(--color-text)]">{preset.label}</span>
                            {preset.type === 'subject' && <span className="text-[10px] font-medium text-[var(--color-text-secondary)] mt-1">{preset.value}분</span>}
                        </Pressable>
                    </motion.div>
                ))}
            </motion.div>

            <div className="flex flex-col gap-3 mt-6">
                <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">직접 입력 (분)</p>
                <div className="flex gap-2">
                    <input
                        type="number"
                        placeholder="분 단위 입력"
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        className="flex-1 px-4 py-3 rounded-xl text-[var(--color-text)] font-bold"
                    />
                    <Pressable
                        onClick={handleConfirm}
                        disabled={!customMinutes || parseInt(customMinutes) <= 0}
                        pressScale={0.95}
                        className="btn btn-primary px-6 py-3 disabled:opacity-30"
                    >
                        설정
                    </Pressable>
                </div>
            </div>

            <Pressable onClick={onClose} pressScale={0.98} className="w-full py-4 mt-6 glass-card-elevated text-[var(--color-text-secondary)] text-xs font-bold rounded-xl">취소</Pressable>
        </Sheet>
    )
}
