import { useState, useEffect, useRef, useMemo } from 'react'
import { useFocusSync } from '../lib/focusSync'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, StudySession, SessionEvaluation } from '../lib/db'
import {
    db,
    getTodayDate,
    getDateFromTimestamp,
    getTodayTotalStudyTime,
    getTodayStudyTimeBySubject,
    formatDurationWithDecimal,
    formatDuration,
    getMonday,
    getSunday,
    formatDateYYYYMMDD
} from '../lib/db'
import TestTimerModal from '../components/TestTimerModal'
import SessionEvalModal from '../components/SessionEvalModal'
import { TabletCamera } from '../components/TabletCamera'
import { NativeBridge } from '../lib/NativeBridge'

interface StudyProps {
    settings: Settings
}

interface WeeklyStats {
    subject: string
    total: number
    selfStudy: number
}

export default function Study({ settings }: StudyProps) {
    const navigate = useNavigate()
    const location = useLocation()
    const { subject: initialSubject, subItem: initialSubItem, type: initialType, countdownDuration: initialCountdown } = location.state || {}

    const [isRunning, setIsRunning] = useState(true)
    const [currentSubject, setCurrentSubject] = useState(initialSubject || settings.subjects[0]?.name || '')
    const [currentSubItem, setCurrentSubItem] = useState<string | undefined>(initialSubItem)
    const [currentType, setCurrentType] = useState(initialType || settings.types[0])
    const [showTestTimer, setShowTestTimer] = useState(false)
    const [countdownDuration, setCountdownDuration] = useState<number | undefined>(initialCountdown)
    const [showNotification, setShowNotification] = useState(false)
    const [showEvalModal, setShowEvalModal] = useState(false)
    const [isEnding, setIsEnding] = useState(false)
    const [lastSessionId, setLastSessionId] = useState<number | null>(null)
    const [lastSessionDuration, setLastSessionDuration] = useState(0)

    // Get current subject's children
    const currentSubjectData = settings.subjects.find(s => s.name === currentSubject)
    const hasSubItems = currentSubjectData?.children && currentSubjectData.children.length > 0

    const [sessionTime, setSessionTime] = useState(0)
    const [todayTotal, setTodayTotal] = useState(0)
    const [todaySubjectTotal, setTodaySubjectTotal] = useState(0)
    const [todaySubjectTypeTotal, setTodaySubjectTypeTotal] = useState(0)
    const [todaySelfStudyTotal, setTodaySelfStudyTotal] = useState(0)

    const [weeklyStats, setWeeklyStats] = useState<WeeklyStats[]>([])
    const [weeklyTotal, setWeeklyTotal] = useState({ total: 0, selfStudy: 0 })
    const [weeklyChange, setWeeklyChange] = useState(0)

    // 절대 시각 기반 타이머: 앱 종료/재시작에도 정확
    const originalStartTimeRef = useRef(Date.now())  // 세션 최초 시작 시각
    const totalPausedMsRef = useRef(0)               // 누적 일시정지 시간
    const pausedAtTimeRef = useRef<number | null>(null) // 일시정지 시작 시각 (null = 실행 중)

    const intervalRef = useRef<number | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const isSavingRef = useRef(false)
    const STORAGE_KEY = 'studymeter_active_session'

    // 현재 경과 시간 계산 (절대 시각 기반)
    const calculateElapsed = () => {
        if (pausedAtTimeRef.current !== null) {
            // 일시정지 상태: 정지 시점까지의 시간
            return pausedAtTimeRef.current - originalStartTimeRef.current - totalPausedMsRef.current;
        }
        // 실행 중: 현재 시각까지의 시간
        return Date.now() - originalStartTimeRef.current - totalPausedMsRef.current;
    }

    useEffect(() => {
        async function loadData() {
            // Load persistent session if exists
            const saved = localStorage.getItem(STORAGE_KEY)
            let startSubject = initialSubject || settings.subjects[0]?.name || ''
            let startSubItem = initialSubItem
            let startType = initialType || settings.types[0]
            let startIsRunning = true
            let startCountdown = initialCountdown

            if (saved) {
                const data = JSON.parse(saved)
                startSubject = data.subject
                startSubItem = data.subItem
                startType = data.type
                startIsRunning = data.isRunning
                startCountdown = data.countdownDuration

                // 절대 시각 기반 복원
                originalStartTimeRef.current = data.originalStartTime
                totalPausedMsRef.current = data.totalPausedMs || 0

                if (startIsRunning) {
                    // 실행 중이었음: pausedAt은 null
                    pausedAtTimeRef.current = null
                } else {
                    // 일시정지 상태였음: pausedAt 복원
                    pausedAtTimeRef.current = data.pausedAtTime || Date.now()
                }

                setSessionTime(calculateElapsed())
                setCurrentSubject(startSubject)
                setCurrentSubItem(startSubItem)
                setCurrentType(startType)
                setIsRunning(startIsRunning)
                setCountdownDuration(startCountdown)
            } else {
                // 새 세션: 지금 시작
                originalStartTimeRef.current = Date.now()
                totalPausedMsRef.current = 0
                pausedAtTimeRef.current = null
            }

            const total = await getTodayTotalStudyTime()
            setTodayTotal(total)
            const bySubject = await getTodayStudyTimeBySubject()
            const subjectData = bySubject.get(startSubject) || { total: 0, selfStudy: 0 }
            setTodaySubjectTotal(subjectData.total)

            const todaySessions = await db.sessions.where('date').equals(getTodayDate()).toArray()
            const subjectTypeTotal = todaySessions
                .filter(s => s.subject === startSubject && s.type === startType)
                .reduce((sum, s) => sum + s.duration, 0)
            setTodaySubjectTypeTotal(subjectTypeTotal)

            let selfStudy = 0
            bySubject.forEach((times) => { selfStudy += times.selfStudy })
            setTodaySelfStudyTotal(selfStudy)
            await loadWeeklyStats()
            setIsLoaded(true)
        }
        loadData()
    }, [initialSubject, initialSubItem, initialType, initialCountdown])

    // LocalStorage Sync (절대 시각 기반)
    useEffect(() => {
        if (!isLoaded || isEnding) return

        const data = {
            subject: currentSubject,
            subItem: currentSubItem,
            type: currentType,
            isRunning,
            originalStartTime: originalStartTimeRef.current,
            totalPausedMs: totalPausedMsRef.current,
            pausedAtTime: pausedAtTimeRef.current,
            countdownDuration
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }, [currentSubject, currentType, isRunning, sessionTime, isLoaded, countdownDuration, isEnding])

    useEffect(() => {
        if (isRunning) {
            NativeBridge.keepAwake(); // 화면 꺼짐 방지 활성화
            intervalRef.current = window.setInterval(() => {
                const elapsed = calculateElapsed()
                setSessionTime(elapsed)

                // Countdown check
                if (countdownDuration && elapsed >= countdownDuration && !showNotification) {
                    setShowNotification(true)
                }
            }, 100)
        } else if (intervalRef.current) {
            NativeBridge.allowSleep(); // 화면 꺼짐 방지 해제
            clearInterval(intervalRef.current)
        }
        return () => {
            NativeBridge.allowSleep();
            NativeBridge.showStatusBar(); // 화면 복구 시 상단바 다시 표시
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [isRunning, countdownDuration, showNotification])

    // Now Bar Effect — 최초 시작 & 상태 변경 시 업데이트
    const notificationStartedRef = useRef(false)
    const totalStudyMsRef = useRef(0) // 오늘 총 공부시간 (이전 세션들)
    const subjectStudyMsRef = useRef(0) // 현재 과목 누적 공부시간 (이전 세션들)
    useEffect(() => {
        if (!isLoaded || !NativeBridge.isNative()) return;

        if (isEnding) {
            NativeBridge.stopNowBar();
            notificationStartedRef.current = false;
            return;
        }

        const chronometerBase = Date.now() - calculateElapsed();

        const syncNotification = async () => {
            const { getTodayTotalStudyTime, getTodayStudyTimeBySubject } = await import('../lib/db');
            
            // 완료된 이전 세션들의 누적 시간 조회
            const pastTotal = await getTodayTotalStudyTime();
            const subjectMap = await getTodayStudyTimeBySubject();
            const pastSubject = subjectMap.get(currentSubject)?.total ?? 0;

            // 현재 세션 포함 합산값을 Java에 전달 (Java에서 더할 필요 없음)
            const currentElapsed = calculateElapsed();
            totalStudyMsRef.current = pastTotal + currentElapsed;
            subjectStudyMsRef.current = pastSubject + currentElapsed;

            if (!notificationStartedRef.current) {
                const hasPermission = await NativeBridge.requestNotificationPermission();
                if (hasPermission) {
                    NativeBridge.startNowBar(currentSubject, chronometerBase, isRunning, totalStudyMsRef.current, subjectStudyMsRef.current);
                    notificationStartedRef.current = true;
                }
            } else {
                NativeBridge.updateNowBar(currentSubject, chronometerBase, isRunning, totalStudyMsRef.current, subjectStudyMsRef.current);
            }
        };

        syncNotification();
    }, [currentSubject, currentType, currentSubItem, isRunning, isLoaded, isEnding])

    useEffect(() => {
        // 몰입형 모드 진입
        NativeBridge.hideStatusBar();

        // 네이티브 타이머 액션(알림 버튼) 리스너 등록
        let listenerHandle: any = null;
        const setupNativeListener = async () => {
            listenerHandle = await NativeBridge.addTimerActionListener((action) => {
                if (action === 'pause') {
                    setIsRunning(prev => {
                        if (prev) {
                            pausedAtTimeRef.current = Date.now()
                            return false
                        }
                        return prev
                    })
                } else if (action === 'resume') {
                    setIsRunning(prev => {
                        if (!prev) {
                            if (pausedAtTimeRef.current !== null) {
                                totalPausedMsRef.current += Date.now() - pausedAtTimeRef.current
                                pausedAtTimeRef.current = null
                            }
                            return true
                        }
                        return prev
                    })
                } else if (action === 'stop') {
                    handleEnd()
                }
            })
        }
        setupNativeListener()

        return () => {
            if (listenerHandle) {
                listenerHandle.remove()
            }
        }
    }, [currentSubject, currentSubItem, currentType])

    const loadWeeklyStats = async () => {
        const today = new Date()
        // 이번 주 월요일~일요일 범위
        const monday = getMonday(today)
        const sunday = getSunday(monday)
        const mondayStr = formatDateYYYYMMDD(monday)
        const sundayStr = formatDateYYYYMMDD(sunday)

        const sessions = await db.sessions
            .where('date')
            .between(mondayStr, sundayStr, true, true)
            .toArray()

        // 이번 주 과목별 통계
        const statsMap = new Map<string, WeeklyStats>()
        let totalWeek = 0
        let selfStudyWeek = 0
        sessions.forEach((session) => {
            const existing = statsMap.get(session.subject) || { subject: session.subject, total: 0, selfStudy: 0 }
            existing.total += session.duration
            if (session.type === '자습' || session.type === '테스트') {
                existing.selfStudy += session.duration
                selfStudyWeek += session.duration
            }
            totalWeek += session.duration
            statsMap.set(session.subject, existing)
        })

        // 지난주 전체(월~일)와 비교
        const prevMonday = new Date(monday)
        prevMonday.setDate(prevMonday.getDate() - 7)
        const prevSunday = getSunday(prevMonday)
        const prevMondayStr = formatDateYYYYMMDD(prevMonday)
        const prevSundayStr = formatDateYYYYMMDD(prevSunday)

        const prevSessions = await db.sessions
            .where('date')
            .between(prevMondayStr, prevSundayStr, true, true)
            .toArray()
        const prevTotal = prevSessions.reduce((sum, s) => sum + s.duration, 0)

        setWeeklyStats(Array.from(statsMap.values()))
        setWeeklyTotal({ total: totalWeek, selfStudy: selfStudyWeek })
        setWeeklyChange(totalWeek - prevTotal)
    }

    const saveSession = async (showEval = false) => {
        // 절대 시각 기반 duration 계산
        const now = Date.now()
        const actualDuration = calculateElapsed()

        if (actualDuration < 1000) return null
        if (isSavingRef.current) return null // Prevent duplicate saves

        isSavingRef.current = true
        if (showEval) setIsEnding(true)

        try {
            const session: StudySession = {
                date: getDateFromTimestamp(originalStartTimeRef.current), // 날짜 무결성: 원래 시작 시각 기준
                subject: currentSubject,
                subItem: currentSubItem,
                type: currentType,
                startTime: originalStartTimeRef.current,
                endTime: now,
                duration: actualDuration
            }
            const id = await db.sessions.add(session)
            localStorage.removeItem(STORAGE_KEY)

            if (showEval) {
                setLastSessionId(id as number)
                setLastSessionDuration(actualDuration)
                setIsRunning(false) // Stop timer immediately
            }
            return id as number
        } finally {
            isSavingRef.current = false
        }
    }

    const refreshTotals = async (subject: string, type: string) => {
        const total = await getTodayTotalStudyTime()
        setTodayTotal(total)

        const bySubject = await getTodayStudyTimeBySubject()
        const subjectData = bySubject.get(subject) || { total: 0, selfStudy: 0 }
        setTodaySubjectTotal(subjectData.total)

        const todaySessions = await db.sessions.where('date').equals(getTodayDate()).toArray()
        const subjectTypeTotal = todaySessions
            .filter(s => s.subject === subject && s.type === type)
            .reduce((sum, s) => sum + s.duration, 0)
        setTodaySubjectTypeTotal(subjectTypeTotal)

        let selfStudy = 0
        bySubject.forEach((times) => { selfStudy += times.selfStudy })
        setTodaySelfStudyTotal(selfStudy)
        await loadWeeklyStats()
    }

    // 새 세션 시작 시 타이머 리셋
    const resetTimerForNewSession = () => {
        originalStartTimeRef.current = Date.now()
        totalPausedMsRef.current = 0
        pausedAtTimeRef.current = null
        setSessionTime(0)
    }

    const handleSubjectChange = async (newSubject: string) => {
        await saveSession()
        setCurrentSubject(newSubject)
        setCurrentSubItem(undefined)
        resetTimerForNewSession()
        await refreshTotals(newSubject, currentType)
    }

    const handleSubItemChange = async (newSubItem: string | undefined) => {
        if (newSubItem === currentSubItem) return
        await saveSession()
        setCurrentSubItem(newSubItem)
        resetTimerForNewSession()
        await refreshTotals(currentSubject, currentType)
    }

    const handleTypeChange = async (newType: string) => {
        if (newType === '테스트') {
            setShowTestTimer(true)
            return
        }
        await saveSession()
        setCurrentType(newType)
        setCountdownDuration(undefined)
        resetTimerForNewSession()
        await refreshTotals(currentSubject, newType)
    }

    const handleTestTimerConfirm = async (minutes: number) => {
        await saveSession()
        setCurrentType('테스트')
        setCountdownDuration(minutes * 60 * 1000)
        resetTimerForNewSession()
        setShowTestTimer(false)
        setShowNotification(false)
    }

    const handlePauseResume = () => {
        if (isRunning) {
            // 일시정지: 현재 시각 기록
            pausedAtTimeRef.current = Date.now()
            setIsRunning(false)
        } else {
            // 재개: 일시정지 시간을 누적에 더하고 pausedAt 해제
            if (pausedAtTimeRef.current !== null) {
                totalPausedMsRef.current += Date.now() - pausedAtTimeRef.current
                pausedAtTimeRef.current = null
            }
            setIsRunning(true)
        }
    }

    const handleEnd = async () => {
        setIsEnding(true)
        NativeBridge.stopNowBar()
        const sessionId = await saveSession(true)
        if (sessionId) {
            setShowEvalModal(true)
        } else {
            navigate('/')
        }
    }

    const handleEvalSave = async (evaluation: SessionEvaluation) => {
        if (lastSessionId) {
            await db.sessions.update(lastSessionId, { evaluation })
        }
        setShowEvalModal(false)
        navigate('/')
    }

    const handleEvalSkip = () => {
        setShowEvalModal(false)
        navigate('/')
    }

    const formatTimeShort = (ms: number) => {
        const hours = Math.floor(ms / 3600000)
        const minutes = Math.floor((ms % 3600000) / 60000)
        return `${hours}h ${minutes}m`
    }

    return (
        <div className="true-black min-h-screen bg-black text-white flex flex-col justify-between safe-area-bottom p-6 md:p-12 overflow-hidden">
            {/* Top Bar */}
            <header className="flex flex-col gap-6 animate-fade-in">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></div>
                        <span className="text-sm font-black uppercase tracking-widest opacity-60">Focusing Now</span>
                    </div>
                    <button onClick={handleEnd} className="px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 font-bold transition-all text-sm">Exit Session</button>
                </div>

                <div className="flex gap-4 overflow-x-auto pb-6 no-scrollbar" style={{ filter: 'url(#liquid-goo)' }}>
                    <SlidingSelector
                        items={settings.subjects.map(s => s.name)}
                        currentValue={currentSubject}
                        onChange={handleSubjectChange}
                        activeColor="bg-white/40"
                        activeTextColor="text-white"
                        layoutId="subject-pill"
                    />
                    <SlidingSelector
                        items={settings.types}
                        currentValue={currentType}
                        onChange={handleTypeChange}
                        activeColor="bg-indigo-500/50"
                        activeTextColor="text-white"
                        layoutId="type-pill"
                    />
                </div>
                {/* Sub-item selector (only shows if current subject has children) */}
                {hasSubItems && (
                    <div className="flex flex-col gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 animate-fade-in shadow-inner">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Select Sub-Item</p>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            <button
                                onClick={() => handleSubItemChange(undefined)}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${!currentSubItem
                                    ? 'bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]'
                                    : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/80 border border-white/5'}`}
                            >
                                전체
                            </button>
                            {currentSubjectData?.children?.map((child) => (
                                <button
                                    key={child}
                                    onClick={() => handleSubItemChange(child)}
                                    className={`px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${currentSubItem === child
                                        ? 'bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]'
                                        : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/80 border border-white/5'}`}
                                >
                                    {child}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </header>

            {/* Main Timer Display */}
            <main className="flex-1 flex flex-col items-center justify-center relative z-0">
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent blur-[120px] pointer-events-none -z-10"></div>

                <div className="relative text-center flex flex-col gap-4">
                    <h2 className="text-xl font-bold opacity-40 uppercase tracking-[0.3em]">
                        {currentSubject}{currentSubItem ? ` › ${currentSubItem}` : ''} · {currentType}
                    </h2>

                    {countdownDuration ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-8xl md:text-[10rem] font-black tracking-tighter tabular-nums text-red-500 drop-shadow-[0_0_50px_rgba(239,68,68,0.3)]">
                                {formatDuration(Math.max(0, countdownDuration - sessionTime))}
                            </span>
                            <div className="flex items-center gap-2 opacity-40">
                                <span className="text-xs font-bold uppercase tracking-widest">Total: {formatDurationWithDecimal(todayTotal + sessionTime)}</span>
                            </div>
                        </div>
                    ) : (
                        <span className="text-8xl md:text-[10rem] font-black tracking-tighter tabular-nums gradient-text drop-shadow-2xl">
                            {formatDurationWithDecimal(todayTotal + sessionTime)}
                        </span>
                    )}

                    {/* 4 Metric Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 w-full max-w-3xl mx-auto">
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-1">{currentSubject} 누적</span>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums">{formatDuration(todaySubjectTotal + sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-1">{currentSubject}+{currentType}</span>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-indigo-300">{formatDuration(todaySubjectTypeTotal + sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-1">현재 세션</span>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-cyan-400">{formatDuration(sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-1">순공 (자습)</span>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-purple-400">{formatDuration(todaySelfStudyTotal + ((currentType === '자습' || currentType === '테스트') ? sessionTime : 0))}</span>
                        </div>
                    </div>
                </div>

                {/* Focus Panel */}
                <FocusPanel />

                {/* Controls Area */}
                <div className="mt-16 flex items-center justify-center gap-10">
                    <button
                        onClick={handlePauseResume}
                        className={`w-28 h-28 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 hover:scale-110 active:scale-90 cursor-pointer ${isRunning ? 'bg-yellow-400 hover:bg-yellow-300' : 'bg-green-500 hover:bg-green-400'}`}
                    >
                        {isRunning ? (
                            /* Pause Icon - Two vertical bars */
                            <div className="flex gap-2 pointer-events-none">
                                <div className="w-3 h-10 bg-black rounded-sm"></div>
                                <div className="w-3 h-10 bg-black rounded-sm"></div>
                            </div>
                        ) : (
                            /* Play Icon - Triangle */
                            <div className="w-0 h-0 border-l-[24px] border-l-white border-t-[16px] border-t-transparent border-b-[16px] border-b-transparent ml-2 pointer-events-none"></div>
                        )}
                    </button>
                </div>
            </main>

            {/* Bottom Insight Bar */}
            <footer className="h-24 bg-white/5 backdrop-blur-3xl rounded-[2.5rem] border border-white/5 flex items-center px-10 gap-8 animate-slide-up">
                <div className="flex-1 flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Weekly progress</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black">{formatTimeShort(weeklyTotal.total + sessionTime)}</span>
                        <span className={`text-xs font-bold ${weeklyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {weeklyChange >= 0 ? '+' : ''}{formatTimeShort(weeklyChange)}
                        </span>
                    </div>
                </div>
                <div className="flex gap-4">
                    {weeklyStats.slice(0, 3).map(stat => (
                        <div key={stat.subject} className="px-4 py-2 bg-white/5 rounded-xl border border-white/5 flex flex-col items-center">
                            <span className="text-[8px] font-black uppercase opacity-40">{stat.subject}</span>
                            <span className="text-xs font-bold">{formatTimeShort(stat.total)}</span>
                        </div>
                    ))}
                </div>
            </footer>

            {/* Liquid Gooey Filter Definition */}
            <svg className="absolute w-0 h-0" style={{ pointerEvents: 'none' }}>
                <defs>
                    <filter id="liquid-goo">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="15" result="blur" />
                        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -12" result="goo" />
                        <feBlend in="SourceGraphic" in2="goo" />
                    </filter>
                </defs>
            </svg>

            {/* Test Completion Notification */}
            <AnimatePresence>
                {showNotification && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
                        {/* Backdrop layer */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/40 backdrop-blur-xl"
                            onClick={() => setShowNotification(false)}
                        />

                        {/* Modal content layer */}
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative liquid-modal p-10 flex flex-col items-center gap-6 max-w-sm w-full text-center shadow-2xl"
                        >
                            <Icon icon="mdi:alarm" className="text-6xl mb-2 text-indigo-400" />
                            <h3 className="text-3xl font-black tracking-tight">테스트 종료!</h3>
                            <p className="font-bold opacity-60">지정한 시간이 모두 지났습니다.<br />수고하셨습니다!</p>
                            <div className="flex flex-col gap-3 w-full mt-4">
                                <button
                                    onClick={() => setShowNotification(false)}
                                    className="w-full py-4 bg-indigo-500 hover:bg-indigo-400 text-white rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all"
                                >
                                    확인
                                </button>
                                <button
                                    onClick={() => {
                                        setShowNotification(false)
                                        setCountdownDuration(undefined)
                                    }}
                                    className="w-full py-4 bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] rounded-2xl font-bold active:scale-95 transition-all text-sm"
                                >
                                    타이머 끄기
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Manual Test Timer Trigger during session */}
            {showTestTimer && (
                <TestTimerModal
                    onClose={() => setShowTestTimer(false)}
                    onConfirm={handleTestTimerConfirm}
                />
            )}

            {/* Session Evaluation Modal */}
            <SessionEvalModal
                isOpen={showEvalModal}
                onClose={handleEvalSkip}
                onSave={handleEvalSave}
                sessionDuration={lastSessionDuration}
                subject={currentSubject}
                subItem={currentSubItem}
            />
        </div>
    )
}

// ── Focus Panel ──────────────────────────────────────────────────────────────

function formatEtaMMSS(etaS: number): string {
    const m = Math.floor(etaS / 60)
    const s = Math.floor(etaS % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function CircleGauge({ score }: { score: number }) {
    const r = 44
    const circ = 2 * Math.PI * r
    const filled = (score / 100) * circ
    const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'

    return (
        <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle
                cx="60" cy="60" r={r}
                fill="none"
                stroke={color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circ}`}
                strokeDashoffset={circ * 0.25}
                style={{ transition: 'stroke-dasharray 0.6s ease, stroke 0.6s ease', filter: `drop-shadow(0 0 6px ${color}88)` }}
            />
            <text x="60" y="65" textAnchor="middle" fill="white" fontSize="22" fontWeight="800" fontFamily="inherit">
                {score}
            </text>
        </svg>
    )
}

function FocusPanel() {
    const serverUrl = useMemo(() => localStorage.getItem('focus_server_url') ?? '', [])
    const { score, etaS, features, connected, sendVideoFrame } = useFocusSync(serverUrl)

    return (
        <div
            className="mt-6 w-full max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-sm p-5"
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">집중도 모니터</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: connected ? '#22c55e' : '#ef4444',
                        boxShadow: connected ? '0 0 6px #22c55e' : 'none',
                        transition: 'background 0.4s ease'
                    }} />
                    <span className="text-[10px] font-bold opacity-50">{connected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            {/* Gauge + ETA row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{ flexShrink: 0 }}>
                    {score !== null
                        ? <CircleGauge score={score} />
                        : (
                            <div style={{
                                width: '120px', height: '120px', borderRadius: '50%',
                                border: '8px solid rgba(255,255,255,0.08)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <span className="text-[10px] font-bold opacity-30">--</span>
                            </div>
                        )
                    }
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">집중도</span>
                        <span className="text-4xl font-black tabular-nums" style={{ color: score !== null ? (score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444') : 'rgba(255,255,255,0.2)' }}>
                            {score !== null ? score : '--'}
                            <span className="text-lg font-bold opacity-40"> / 100</span>
                        </span>
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">남은 시간</span>
                        <span className="text-xl font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {etaS !== null ? formatEtaMMSS(etaS) : '측정 중...'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Feature cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <FeatureCard label="BPM" value={features?.bpm} unit="" decimals={0} color="#f472b6" />
                <FeatureCard label="졸음 지표 (EAR)" value={features?.mean_ear} unit="" decimals={3} color="#facc15" />
                <FeatureCard label="시선 이동률" value={features?.saccade_rate} unit="/s" decimals={2} color="#818cf8" />
            </div>

            {/* Tablet camera */}
            <TabletCamera sendVideoFrame={sendVideoFrame} connected={connected} fps={10} />
        </div>
    )
}

interface FeatureCardProps {
    label: string
    value: number | undefined
    unit: string
    decimals: number
    color: string
}

function FeatureCard({ label, value, unit, decimals, color }: FeatureCardProps) {
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
            <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-1">{label}</span>
            <span className="text-lg font-bold tabular-nums" style={{ color: value !== undefined ? color : 'rgba(255,255,255,0.2)' }}>
                {value !== undefined ? `${value.toFixed(decimals)}${unit}` : '--'}
            </span>
        </div>
    )
}

// ── Sliding Selector ─────────────────────────────────────────────────────────

interface SlidingSelectorProps {
    items: string[]
    currentValue: string
    onChange: (val: string) => void
    activeColor: string
    activeTextColor: string
    layoutId: string
}

function SlidingSelector({ items, currentValue, onChange, activeColor, activeTextColor, layoutId }: SlidingSelectorProps) {
    const selectorRef = useRef<HTMLDivElement>(null)
    const [isPointerDown, setIsPointerDown] = useState(false)
    const [pendingValue, setPendingValue] = useState<string | null>(null)

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isPointerDown) return

        // Find which button is under the pointer
        const element = document.elementFromPoint(e.clientX, e.clientY)
        const button = element?.closest('button[data-value]')
        if (button) {
            const newValue = button.getAttribute('data-value')
            if (newValue && newValue !== currentValue) {
                setPendingValue(newValue) // Store but don't call onChange yet
            }
        }
    }

    const handlePointerUp = () => {
        setIsPointerDown(false)
        if (pendingValue && pendingValue !== currentValue) {
            onChange(pendingValue)
        }
        setPendingValue(null)
    }

    return (
        <div
            ref={selectorRef}
            onPointerDown={() => setIsPointerDown(true)}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerMove={handlePointerMove}
            className="flex gap-1 p-1.5 rounded-2xl bg-white/5 backdrop-blur-3xl border border-white/10 relative touch-none"
        >
            {items.map((item) => (
                <button
                    key={item}
                    data-value={item}
                    onClick={() => onChange(item)}
                    className={`relative px-6 py-2.5 rounded-xl text-sm font-bold transition-colors duration-300 z-10 ${(pendingValue || currentValue) === item ? activeTextColor : 'text-white/40 hover:text-white/70'}`}
                >
                    {(pendingValue || currentValue) === item && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <motion.div
                                layoutId={layoutId}
                                className={`absolute inset-0 ${activeColor} backdrop-blur-md rounded-xl shadow-[0_8px_32px_0_rgba(31,38,135,0.37)] border border-white/20 overflow-hidden`}
                                transition={{ type: "spring", bounce: 0.25, duration: 0.6 }}
                            >
                                {/* Glossy Reflection */}
                                <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent pointer-events-none"></div>
                                <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                            </motion.div>
                        </div>
                    )}
                    <span className="relative z-20">{item}</span>
                </button>
            ))}
        </div>
    )
}
