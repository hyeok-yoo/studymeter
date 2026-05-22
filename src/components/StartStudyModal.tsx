import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { updateDailyRecord, findActiveSessionAtTime, adjustOverlappingSession, getTodayDate, db } from '../lib/db'
import { MODAL_PHRASES, getRandomPhrase } from '../lib/phrases'
import TestTimerModal from './TestTimerModal'

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

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-xl"
                onClick={onClose}
            />

            {/* Modal Content */}
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="relative liquid-modal max-w-lg w-full p-10 flex flex-col gap-8 shadow-2xl overflow-y-auto no-scrollbar max-h-[90vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <header>
                    <h2 className="text-3xl font-black gradient-text flex items-center gap-2">
                        <Icon icon="mdi:hand-wave-outline" /> 공부를 시작해볼까요?
                    </h2>
                    <p className="text-[var(--color-text-secondary)] font-medium mt-1">{randomPhrase}</p>
                </header>

                {isFirstVisit && !hasExistingSchedule && (
                    <div className="flex flex-col gap-4">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60 font-black">오늘의 기상/취침 입력</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-bold text-[var(--color-text)] flex items-center gap-1">
                                    <Icon icon="mdi:weather-sunset-up" className="text-lg text-orange-400" /> 기상 시간
                                </label>
                                <input
                                    type="time"
                                    value={wakeUpTime}
                                    onChange={(e) => setWakeUpTime(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
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
                                    className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all"
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">어떤 과목을 공부할까요?</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.subjects.map((subject) => (
                                <button
                                    key={subject.name}
                                    onClick={() => {
                                        setSelectedSubject(subject.name)
                                        setSelectedSubItem(undefined)
                                    }}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedSubject === subject.name
                                        ? 'bg-[var(--color-primary)] text-white shadow-lg'
                                        : 'bg-white/5 text-[var(--color-text)] hover:bg-white/10 border border-[var(--color-border)]'
                                        }`}
                                >
                                    {subject.name}
                                </button>
                            ))}
                        </div>

                        {hasSubItems && (
                            <div className="flex flex-col gap-2 p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 animate-fade-in">
                                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400 opacity-80">세부 항목 선택 (선택 사항)</p>
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => setSelectedSubItem(undefined)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!selectedSubItem
                                            ? 'bg-indigo-500 text-white shadow-lg'
                                            : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-[var(--color-text)]'}`}
                                    >
                                        전체
                                    </button>
                                    {currentSubjectData?.children?.map(child => (
                                        <button
                                            key={child}
                                            onClick={() => setSelectedSubItem(child)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedSubItem === child
                                                ? 'bg-indigo-500 text-white shadow-lg'
                                                : 'bg-white/5 text-[var(--color-text-secondary)] hover:bg-white/10 hover:text-[var(--color-text)]'}`}
                                        >
                                            {child}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] opacity-60">공부 유형은?</p>
                        <div className="flex flex-wrap gap-2">
                            {settings.types.map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setSelectedType(type)}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedType === type
                                        ? 'bg-[var(--color-secondary)] text-white shadow-lg'
                                        : 'bg-white/5 text-[var(--color-text)] hover:bg-white/10 border border-[var(--color-border)]'
                                        }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-4 rounded-2xl text-[var(--color-text)] font-bold transition-all hover:bg-white/5"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-6 py-4 rounded-2xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-black shadow-xl active:scale-95 transition-all"
                    >
                        시작하기!
                    </button>
                </div>
            </motion.div>

            <AnimatePresence>
                {showTestTimer && (
                    <TestTimerModal
                        onClose={() => setShowTestTimer(false)}
                        onConfirm={handleTestTimerConfirm}
                    />
                )}
            </AnimatePresence>
        </div>,
        document.body
    )
}
