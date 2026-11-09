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

    const chipBase = 'h-10 px-4 rounded-lg text-[15px] font-medium transition-colors'
    const subChipBase = 'h-8 px-3 rounded-md text-[13px] font-medium transition-colors'

    return createPortal(
        <>
            {/* 가운데 플로팅 팝업 — 뒤 화면은 딤, 팝업 표면은 불투명 */}
            <div className="fixed inset-0 flex items-center justify-center p-5" style={{ zIndex: 9500 }}>
                {/* Scrim */}
                <motion.div
                    className="absolute inset-0"
                    style={{
                        background: 'var(--scrim)',
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
                    className="relative w-full max-w-xl max-h-[88dvh] overflow-y-auto overscroll-contain rounded-[20px] p-6 md:p-7 liquid-modal"
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={spring.default}
                >
                <header className="mb-6">
                    <h2 className="text-[24px] font-medium leading-tight">공부 시작</h2>
                    <p className="text-[15px] text-[var(--color-text-secondary)] mt-1">{randomPhrase}</p>
                </header>

                {isFirstVisit && !hasExistingSchedule && (
                    <motion.div
                        className="flex flex-col gap-4 mb-6"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={spring.default}
                    >
                        <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">오늘의 기상·취침</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-[14px] text-[var(--color-text)] flex items-center gap-1.5">
                                    <Icon icon="mdi:weather-sunset-up" className="text-[16px] text-[var(--color-text-muted)]" /> 기상 시간
                                </label>
                                <input
                                    type="time"
                                    value={wakeUpTime}
                                    onChange={(e) => setWakeUpTime(e.target.value)}
                                    className="w-full h-11 px-3 rounded-lg text-[var(--color-text)] tabular-nums"
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[14px] text-[var(--color-text)] flex items-center gap-1.5">
                                    <Icon icon="mdi:weather-night" className="text-[16px] text-[var(--color-text-muted)]" /> 전날 취침 시간
                                </label>
                                <input
                                    type="time"
                                    value={bedTime}
                                    onChange={(e) => setBedTime(e.target.value)}
                                    className="w-full h-11 px-3 rounded-lg text-[var(--color-text)] tabular-nums"
                                />
                            </div>
                        </div>
                    </motion.div>
                )}

                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-3">
                        <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">과목</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.subjects.map((subject) => (
                                <Pressable
                                    key={subject.name}
                                    pressScale={0.97}
                                    onClick={() => {
                                        setSelectedSubject(subject.name)
                                        setSelectedSubItem(undefined)
                                    }}
                                    className={`${chipBase} ${selectedSubject === subject.name
                                        ? 'fill-ink'
                                        : 'glass-card-elevated text-[var(--color-text)] hover:border-[var(--hairline-strong)]'
                                        }`}
                                >
                                    {subject.name}
                                </Pressable>
                            ))}
                        </div>

                        {hasSubItems && (
                            <motion.div
                                className="flex flex-col gap-2 pl-3 border-l-2 border-[var(--color-border)]"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={spring.default}
                            >
                                <p className="text-[13px] text-[var(--color-text-muted)]">세부 항목 (선택)</p>
                                <div className="flex flex-wrap gap-1.5">
                                    <Pressable
                                        pressScale={0.97}
                                        onClick={() => setSelectedSubItem(undefined)}
                                        className={`${subChipBase} ${!selectedSubItem
                                            ? 'fill-ink'
                                            : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                                    >
                                        전체
                                    </Pressable>
                                    {currentSubjectData?.children?.map(child => (
                                        <Pressable
                                            key={child}
                                            pressScale={0.97}
                                            onClick={() => setSelectedSubItem(child)}
                                            className={`${subChipBase} ${selectedSubItem === child
                                                ? 'fill-ink'
                                                : 'border border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                                        >
                                            {child}
                                        </Pressable>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <p className="text-[13px] font-medium text-[var(--color-text-secondary)]">유형</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.types.map((type) => (
                                <Pressable
                                    key={type}
                                    pressScale={0.97}
                                    onClick={() => setSelectedType(type)}
                                    className={`${chipBase} ${selectedType === type
                                        ? 'fill-ink'
                                        : 'glass-card-elevated text-[var(--color-text)] hover:border-[var(--hairline-strong)]'
                                        }`}
                                >
                                    {type}
                                </Pressable>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-[1fr_2fr] gap-3 pt-7">
                    <Pressable
                        onClick={onClose}
                        pressScale={0.98}
                        className="btn btn-glass h-12 text-[15px]"
                    >
                        취소
                    </Pressable>
                    <Pressable
                        onClick={handleConfirm}
                        pressScale={0.97}
                        className="btn btn-primary h-12 text-[15px]"
                    >
                        시작하기
                    </Pressable>
                </div>
                </motion.div>
            </div>

            {showTestTimer && (
                <TestTimerModal
                    onClose={() => setShowTestTimer(false)}
                    onConfirm={handleTestTimerConfirm}
                    settings={settings}
                />
            )}
        </>,
        document.body,
    )
}
