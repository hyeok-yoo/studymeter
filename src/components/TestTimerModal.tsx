/**
 * TestTimerModal — 테스트(카운트다운) 시간 설정.
 *
 * 바텀시트에서 화면 중앙 플로팅으로 바꾼 이유:
 *  시트는 반투명 크롬(material-chrome) 위에 콘텐츠가 비쳐 숫자가 읽기 어려웠다.
 *  Apple 규칙대로 "집중시킬 때는 스크림으로 배경을 눌러 두고" 표면 자체는
 *  불투명하게 둔다 — 반투명 위에 반투명을 얹지 않는다.
 */
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import Pressable from './ui/Pressable'
import { spring, staggerContainer, staggerItem, prefersReducedMotion } from '../lib/motion'
import { db, DEFAULT_TIMER_PRESETS, type Settings, type TimerPreset } from '../lib/db'

interface TestTimerModalProps {
    onClose: () => void
    onConfirm: (minutes: number) => void
    settings: Settings
    onSettingsChange?: (s: Settings) => void
}

export default function TestTimerModal({ onClose, onConfirm, settings, onSettingsChange }: TestTimerModalProps) {
    const [customMinutes, setCustomMinutes] = useState('')
    const [editing, setEditing] = useState(false)
    const [newLabel, setNewLabel] = useState('')
    const [newMinutes, setNewMinutes] = useState('')
    const reduced = prefersReducedMotion()

    // 로컬 상태로 들고 있어야 추가·삭제가 모달을 닫지 않고 바로 보인다
    const initialPresets = useMemo<TimerPreset[]>(
        () => settings.timerPresets ?? DEFAULT_TIMER_PRESETS,
        [settings.timerPresets],
    )
    const [presets, setPresets] = useState<TimerPreset[]>(initialPresets)

    const savePresets = async (next: TimerPreset[]) => {
        setPresets(next)
        if (settings.id == null) return
        await db.settings.update(settings.id, { timerPresets: next })
        onSettingsChange?.({ ...settings, timerPresets: next })
    }

    const handleConfirm = () => {
        const mins = parseInt(customMinutes)
        if (!isNaN(mins) && mins > 0) onConfirm(mins)
    }

    const handleAddPreset = async () => {
        const mins = parseInt(newMinutes)
        const label = newLabel.trim()
        if (!label || isNaN(mins) || mins <= 0) return
        await savePresets([
            ...presets,
            { id: `u${Date.now()}`, label, minutes: mins, kind: 'subject' },
        ])
        setNewLabel('')
        setNewMinutes('')
    }

    const handleRemovePreset = async (id: string) => {
        await savePresets(presets.filter(p => p.id !== id))
    }

    const modal = (
        <AnimatePresence>
            <div className="fixed inset-0 z-[9600] flex items-center justify-center p-5">
                {/* 스크림 — 배경을 눌러 시선을 모달로 모은다 */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={onClose}
                    className="absolute inset-0"
                    style={{ background: 'var(--scrim)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
                />

                {/* 표면 — 불투명. 반투명 위 반투명 금지 */}
                <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label="테스트 타이머 설정"
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
                    transition={spring.default}
                    onClick={e => e.stopPropagation()}
                    className="relative w-full max-w-md glass-card-solid overflow-hidden flex flex-col"
                    style={{ maxHeight: '85dvh' }}
                >
                    <div className="overflow-y-auto overscroll-contain p-6">
                        <header className="mb-5">
                            <h2 className="text-xl font-black flex items-center gap-2 text-display text-[var(--color-text)]">
                                <Icon icon="mdi:timer-outline" className="text-[var(--color-primary)]" />
                                테스트 타이머
                            </h2>
                            <p className="text-[var(--color-text-secondary)] text-sm font-medium mt-1">
                                테스트 시간을 지정해 주세요.
                            </p>
                        </header>

                        <motion.div
                            className="grid grid-cols-3 gap-2"
                            variants={staggerContainer}
                            initial="initial"
                            animate="animate"
                        >
                            {presets.map(preset => (
                                <motion.div key={preset.id} variants={staggerItem} className="relative">
                                    <Pressable
                                        onClick={() => !editing && onConfirm(preset.minutes)}
                                        pressScale={0.95}
                                        className="w-full flex flex-col items-center justify-center p-3 rounded-2xl glass-card-elevated"
                                    >
                                        <span className="text-[10px] font-black opacity-50 uppercase mb-0.5 text-[var(--color-text-secondary)]">
                                            {preset.kind === 'subject' ? '과목' : '시간'}
                                        </span>
                                        <span className="text-sm font-bold text-[var(--color-text)]">{preset.label}</span>
                                        <span className="text-[10px] font-medium text-[var(--color-text-secondary)] mt-1">
                                            {preset.minutes}분
                                        </span>
                                    </Pressable>
                                    {editing && (
                                        <Pressable
                                            onClick={() => void handleRemovePreset(preset.id)}
                                            pressScale={0.9}
                                            aria-label={`${preset.label} 프리셋 삭제`}
                                            className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white"
                                            style={{ background: '#ef4444' }}
                                        >
                                            <Icon icon="mdi:close" className="text-[13px]" />
                                        </Pressable>
                                    )}
                                </motion.div>
                            ))}
                        </motion.div>

                        <button
                            onClick={() => setEditing(v => !v)}
                            className="mt-3 text-xs font-bold text-[var(--color-text-secondary)] opacity-70 flex items-center gap-1"
                        >
                            <Icon icon={editing ? 'mdi:check' : 'mdi:pencil-outline'} className="text-sm" />
                            {editing ? '편집 완료' : '프리셋 편집'}
                        </button>

                        {editing && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                transition={spring.snappy}
                                className="overflow-hidden"
                            >
                                <div className="flex gap-2 mt-3">
                                    <input
                                        type="text"
                                        placeholder="이름"
                                        value={newLabel}
                                        onChange={e => setNewLabel(e.target.value)}
                                        className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-[var(--color-text)] font-bold text-sm"
                                    />
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        placeholder="분"
                                        value={newMinutes}
                                        onChange={e => setNewMinutes(e.target.value)}
                                        className="w-20 px-3 py-2.5 rounded-xl text-[var(--color-text)] font-bold text-sm"
                                    />
                                    <Pressable
                                        onClick={() => void handleAddPreset()}
                                        disabled={!newLabel.trim() || !newMinutes || parseInt(newMinutes) <= 0}
                                        pressScale={0.95}
                                        aria-label="프리셋 추가"
                                        className="px-4 rounded-xl font-black text-white disabled:opacity-30"
                                        style={{ background: 'var(--color-primary)' }}
                                    >
                                        <Icon icon="mdi:plus" />
                                    </Pressable>
                                </div>
                            </motion.div>
                        )}

                        <div className="flex flex-col gap-2.5 mt-5">
                            <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">
                                직접 입력 (분)
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    placeholder="분 단위 입력"
                                    value={customMinutes}
                                    onChange={e => setCustomMinutes(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                                    className="flex-1 min-w-0 px-4 py-3 rounded-xl text-[var(--color-text)] font-bold"
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

                        <Pressable
                            onClick={onClose}
                            pressScale={0.98}
                            className="w-full py-3.5 mt-5 glass-card-elevated text-[var(--color-text-secondary)] text-xs font-bold rounded-xl"
                        >
                            취소
                        </Pressable>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    )

    return createPortal(modal, document.body)
}
