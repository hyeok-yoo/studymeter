import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { updateDailyRecord, findActiveSessionAtTime, adjustOverlappingSession, getTodayDate, db } from '../lib/db'
import { MODAL_PHRASES, getRandomPhrase } from '../lib/phrases'
import TestTimerModal from './TestTimerModal'
import Pressable from './ui/Pressable'
import { spring } from '../lib/motion'

interface StartStudyModalProps {
    settings: Settings
    isFirstVisit: boolean
    onClose: () => void
    onConfirm: (subject: string, type: string, countdownDuration?: number, subItem?: string) => void
}

export default function StartStudyModal({
    settings,
    isFirstVisit,
    onClose,
    onConfirm
}: StartStudyModalProps) {
    const [selectedSubject, setSelectedSubject] = useState(settings.subjects[0]?.name || '')
    const [selectedSubItem, setSelectedSubItem] = useState<string | undefined>(undefined)
    const [selectedType, setSelectedType] = useState(settings.types[0] || '')
    const [showTestTimer, setShowTestTimer] = useState(false)
    const randomPhrase = useMemo(() => getRandomPhrase(MODAL_PHRASES), [])

    const [wakeUpTime, setWakeUpTime] = useState('07:20')
    const [bedTime, setBedTime] = useState('01:30')
    const [hasExistingSchedule, setHasExistingSchedule] = useState(false)

    // Check if daily record already has wakeup/bed time
    useState(() => {
        db.dailyRecords.get(getTodayDate()).then(record => {
            if (record && (record.wakeUpTime || record.bedTime)) {
                setHasExistingSchedule(true)
            }
        })
    })

    // Get current subject's data for sub-items
    const currentSubjectData = settings.subjects.find(s => s.name === selectedSubject)
    const hasSubItems = currentSubjectData?.children && currentSubjectData.children.length > 0

    const handleConfirm = async () => {
        if (isFirstVisit) {
            await updateDailyRecord({
                wakeUpTime: wakeUpTime || undefined,
                bedTime: bedTime || undefined,
                firstVisitCompleted: true
            })
        }

        const now = Date.now()
        const activeSession = await findActiveSessionAtTime(now)
        if (activeSession && activeSession.id) {
            await adjustOverlappingSession(activeSession.id, now)
        }

        if (selectedType === '테스트') {
            setShowTestTimer(true)
        } else {
            onConfirm(selectedSubject, selectedType, undefined, selectedSubItem)
        }
    }

    const handleTestTimerConfirm = (minutes: number) => {
        onConfirm(selectedSubject, selectedType, minutes * 60 * 1000, selectedSubItem)
    }

    const chipBase = 'px-4 py-2 rounded-xl text-sm font-bold'
    const subChipBase = 'px-3 py-1.5 rounded-lg text-xs font-bold'

    return createPortal(
        <>
            {/* 가운데 플로팅 팝업 — 뒤 화면은 블러+딤, 팝업 표면은 불투명 */}
            <div className="fixed inset-0 flex items-center justify-center p-5" style={{ zIndex: 9500 }}>
                {/* Scrim: 나머지 화면 전체 블러 처리 */}
                <motion.div
                    className="absolute inset-0"
                    style={{
                        background: 'var(--scrim)',
                        backdropFilter: 'blur(14px) saturate(140%)',
                        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.22 }}
                    onClick={onClose}
                />

                <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label="공부 시작"
                    className="relative w-full max-w-2xl max-h-[88dvh] overflow-y-auto overscroll-contain rounded-[32px] p-6 md:p-8 bg-white dark:bg-[#0d1526] border border-black/[0.06] dark:border-white/12 shadow-[0_32px_80px_-16px_rgba(0,0,0,0.45)]"
                    initial={{ opacity: 0, scale: 0.94, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={spring.default}
                >
                <header className="mb-6">
                    <h2 className="text-3xl font-black gradient-text flex items-center gap-2 text-display">
                        <Icon icon="mdi:hand-wave-outline" /> 공부를 시작해볼까요?
                    </h2>
                    <p className="text-[var(--color-text-secondary)] font-medium mt-1">{randomPhrase}</p>
                </header>

                {isFirstVisit && !hasExistingSchedule && (
                    <motion.div
                        className="flex flex-col gap-4 mb-6"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring.default}
                    >
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">오늘의 기상/취침 입력</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1">
                                    <Icon icon="mdi:weather-sunset-up" className="text-lg text-orange-400" /> 기상 시간
                                </label>
                                <input
                                    type="time"
                                    value={wakeUpTime}
                                    onChange={(e) => setWakeUpTime(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl text-[var(--color-text)]"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1">
                                    <Icon icon="mdi:weather-night" className="text-lg text-indigo-400" /> 전날 취침 시간
                                </label>
                                <input
                                    type="time"
                                    value={bedTime}
                                    onChange={(e) => setBedTime(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl text-[var(--color-text)]"
                                />
                            </div>
                        </div>
                    </motion.div>
                )}

                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">어떤 과목을 공부할까요?</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.subjects.map((subject) => (
                                <Pressable
                                    key={subject.name}
                                    pressScale={0.95}
                                    onClick={() => {
                                        setSelectedSubject(subject.name)
                                        setSelectedSubItem(undefined)
                                    }}
                                    className={`${chipBase} ${selectedSubject === subject.name
                                        ? 'bg-[var(--color-primary)] text-white shadow-lg'
                                        : 'glass-card-elevated text-[var(--color-text)]'
                                        }`}
                                >
                                    {subject.name}
                                </Pressable>
                            ))}
                        </div>

                        {hasSubItems && (
                            <motion.div
                                className="flex flex-col gap-2 p-4 glass-card-elevated"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={spring.default}
                            >
                                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400 opacity-80">세부 항목 선택 (선택 사항)</p>
                                <div className="flex flex-wrap gap-1.5">
                                    <Pressable
                                        pressScale={0.94}
                                        onClick={() => setSelectedSubItem(undefined)}
                                        className={`${subChipBase} ${!selectedSubItem
                                            ? 'bg-indigo-500 text-white shadow-lg'
                                            : 'glass-card-elevated text-[var(--color-text-secondary)]'}`}
                                    >
                                        전체
                                    </Pressable>
                                    {currentSubjectData?.children?.map(child => (
                                        <Pressable
                                            key={child}
                                            pressScale={0.94}
                                            onClick={() => setSelectedSubItem(child)}
                                            className={`${subChipBase} ${selectedSubItem === child
                                                ? 'bg-indigo-500 text-white shadow-lg'
                                                : 'glass-card-elevated text-[var(--color-text-secondary)]'}`}
                                        >
                                            {child}
                                        </Pressable>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">공부 유형은?</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.types.map((type) => (
                                <Pressable
                                    key={type}
                                    pressScale={0.95}
                                    onClick={() => setSelectedType(type)}
                                    className={`${chipBase} ${selectedType === type
                                        ? 'bg-[var(--color-secondary)] text-white shadow-lg'
                                        : 'glass-card-elevated text-[var(--color-text)]'
                                        }`}
                                >
                                    {type}
                                </Pressable>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-6">
                    <Pressable
                        onClick={onClose}
                        pressScale={0.98}
                        className="px-6 py-4 rounded-2xl text-[var(--color-text)] font-bold glass-card-elevated"
                    >
                        취소
                    </Pressable>
                    <Pressable
                        onClick={handleConfirm}
                        pressScale={0.97}
                        className="btn btn-primary px-6 py-4 text-base"
                    >
                        시작하기!
                    </Pressable>
                </div>
                </motion.div>
            </div>

            {showTestTimer && (
                <TestTimerModal
                    onClose={() => setShowTestTimer(false)}
                    onConfirm={handleTestTimerConfirm}
                />
            )}
        </>,
        document.body,
    )
}
