import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useFocusSync } from '../lib/focusSync'
import type { FocusFeatures } from '../lib/focusSync'
import { useFocusNative } from '../lib/useFocusNative'
import { useFocusWeb } from '../lib/useFocusWeb'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, StudySession, SessionEvaluation, ThoughtNote } from '../lib/db'
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
    formatDateYYYYMMDD,
    addThoughtNote
} from '../lib/db'
import TestTimerModal from '../components/TestTimerModal'
import SessionEvalModal from '../components/SessionEvalModal'
import { TabletCamera } from '../components/TabletCamera'
import { NativeBridge } from '../lib/NativeBridge'
import type { RingerMode } from '../lib/NativeBridge'
import { HelpButton } from '../components/HelpButton'
import { useDrowsiness } from '../lib/useDrowsiness'
import { playTimerEndSound, startDrowsyAlarm, type AlarmModality } from '../lib/alarm'

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
    const [showParkingDrawer, setShowParkingDrawer] = useState(false)
    const [parkedNotes, setParkedNotes] = useState<ThoughtNote[]>([])

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
                    // 테스트 타이머 종료음 — 미디어 볼륨(STREAM_MUSIC)으로 재생되어
                    // 벨소리/진동 모드와 무관하게 들리고, 이어폰 연결 시 이어폰으로 라우팅된다.
                    playTimerEndSound()
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
                    <div className="flex items-center justify-center gap-2">
                        <h2 className="text-xl font-bold opacity-40 uppercase tracking-[0.3em]">
                            {currentSubject}{currentSubItem ? ` › ${currentSubItem}` : ''} · {currentType}
                        </h2>
                        <HelpButton dark title="타이머 표시 안내" items={[
                            { description: '큰 숫자는 오늘 총 공부 시간 + 현재 세션 시간을 합산하여 실시간으로 표시합니다.' },
                            { title: '과목·타입 전환', description: '상단 버튼으로 과목이나 학습 유형을 바꾸면 현재 세션이 저장되고 새 세션이 시작됩니다.' },
                            { title: '일시정지', description: '아래 일시정지 버튼을 누르면 타이머가 멈추고 공부 시간에 포함되지 않습니다.' },
                            { title: '테스트 타입 선택 시', description: '시간을 설정하면 카운트다운 타이머로 전환됩니다. 시간이 끝나면 알림이 표시됩니다.' },
                        ]} />
                    </div>

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
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{currentSubject} 누적</span>
                                <HelpButton dark title={`${currentSubject} 오늘 누적`} items={`오늘 "${currentSubject}" 과목에서 모든 타입(강의·자습·테스트 등)으로 공부한 총 시간입니다. 과목을 전환해도 이전 세션 시간이 합산됩니다.`} />
                            </div>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums">{formatDuration(todaySubjectTotal + sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{currentSubject}+{currentType}</span>
                                <HelpButton dark title="과목+타입 누적" items={`오늘 "${currentSubject}" 과목에서 "${currentType}" 타입으로만 공부한 시간입니다. 예: 수학 강의만, 영어 자습만 따로 보고 싶을 때 유용합니다.`} />
                            </div>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-indigo-300">{formatDuration(todaySubjectTypeTotal + sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">현재 세션</span>
                                <HelpButton dark title="현재 세션 시간" items="이번 공부 시작 버튼을 누른 순간부터 지금까지의 경과 시간입니다. 타입이나 과목을 전환하면 세션이 분리되어 다시 0부터 시작합니다." />
                            </div>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-cyan-400">{formatDuration(sessionTime)}</span>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">순공 (자습)</span>
                                <HelpButton dark title="순공 시간이란?" items={[
                                    { description: '자습·테스트 타입 세션만 합산한 시간입니다. 강의 수강 시간은 포함되지 않습니다.' },
                                    { title: '왜 따로 보나요?', description: '수동적인 강의 시청과 능동적인 자습·문제풀이를 구분하여, 실제 스스로 공부한 시간을 파악하기 위함입니다.' },
                                ]} />
                            </div>
                            <span className="text-2xl md:text-3xl font-bold tabular-nums text-purple-400">{formatDuration(todaySelfStudyTotal + ((currentType === '자습' || currentType === '테스트') ? sessionTime : 0))}</span>
                        </div>
                    </div>
                </div>

                {/* Daily Goal Progress Bar */}
                {settings.dailyGoalMs && (() => {
                    const total = todayTotal + sessionTime
                    const pct = Math.min(100, Math.round((total / settings.dailyGoalMs!) * 100))
                    const goalH = Math.floor(settings.dailyGoalMs! / 3600000)
                    const goalM = Math.floor((settings.dailyGoalMs! % 3600000) / 60000)
                    return (
                        <div className="w-full max-w-3xl mx-auto mt-4 px-1">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest opacity-40 mb-1.5">
                                <span>일일 목표 {goalH > 0 ? `${goalH}h` : ''}{goalM > 0 ? ` ${goalM}m` : ''}</span>
                                <span style={{ color: pct >= 100 ? '#22c55e' : 'inherit' }}>{pct}%{pct >= 100 ? ' ✓' : ''}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-1000"
                                    style={{
                                        width: `${pct}%`,
                                        background: pct >= 100
                                            ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                                            : 'linear-gradient(90deg, #6366f1, #a855f7)',
                                        boxShadow: pct >= 100 ? '0 0 8px rgba(34,197,94,0.5)' : '0 0 8px rgba(168,85,247,0.3)'
                                    }}
                                />
                            </div>
                        </div>
                    )
                })()}

                {/* Focus Panel */}
                <FocusPanel />

                {/* Controls Area */}
                <div className="mt-16 flex items-center justify-center gap-10">
                    {/* Thought Parking Button */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            onClick={() => setShowParkingDrawer(true)}
                            className="flex flex-col items-center gap-0.5 group"
                        >
                            <div className="w-16 h-16 rounded-2xl bg-white/8 hover:bg-blue-500/20 border border-white/10 hover:border-blue-400/40 flex flex-col items-center justify-center gap-0.5 transition-all duration-300 active:scale-90">
                                <span className="text-xl font-black text-blue-400 leading-none">P</span>
                                {parkedNotes.length > 0 && (
                                    <span className="text-[10px] font-black text-blue-300 leading-none">{parkedNotes.length}</span>
                                )}
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-wider opacity-30 group-hover:opacity-50">주차장</span>
                        </button>
                        <HelpButton dark title="생각 주차장 (P)" items={[
                            { description: '공부 중 갑자기 떠오른 관련 없는 생각(할 일, 아이디어 등)을 빠르게 기록해 두는 공간입니다.' },
                            { title: '왜 쓰나요?', description: '생각을 직접 메모 앱으로 전환하면 집중이 깨집니다. 주차장에 버려두면 잊어버릴 걱정 없이 공부에 바로 복귀할 수 있습니다.' },
                            { title: '나중에 확인', description: '세션 평가 화면에서 주차된 생각을 한꺼번에 확인하고 처리할 수 있습니다.' },
                        ]} />
                    </div>

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

                    {/* Spacer to balance layout */}
                    <div className="w-16 h-16" />
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
                parkedNotes={parkedNotes}
            />

            {/* Thought Parking Drawer */}
            <ThoughtParkingDrawer
                isOpen={showParkingDrawer}
                onClose={() => setShowParkingDrawer(false)}
                parkedNotes={parkedNotes}
                onPark={async (content) => {
                    const note: ThoughtNote = {
                        date: getTodayDate(),
                        sessionStartTime: originalStartTimeRef.current,
                        createdAt: Date.now(),
                        content,
                        reviewed: false
                    }
                    const id = await addThoughtNote(note)
                    setParkedNotes(prev => [...prev, { ...note, id }])
                }}
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
                {Math.round(score)}
            </text>
        </svg>
    )
}

// ── Focus Panel (tabbed) ─────────────────────────────────────────────────────

interface ScorePoint { t: number; score: number }

function MetricCard({ label, value, unit, decimals, color }: { label: string; value: number | undefined | null; unit: string; decimals: number; color: string }) {
    const valid = value !== undefined && value !== null && isFinite(value as number)
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
            <span className="block text-[9px] font-black uppercase tracking-widest opacity-40 mb-1">{label}</span>
            <span className="text-base font-bold tabular-nums" style={{ color: valid ? color : 'rgba(255,255,255,0.2)' }}>
                {valid ? `${(value as number).toFixed(decimals)}${unit}` : '--'}
            </span>
        </div>
    )
}

// ── Tab 1: 집중도 ─────────────────────────────────────────────────────────────
function FocusTab({ score, etaS, scoreHistory }: { score: number | null; etaS: number | null; scoreHistory: ScorePoint[] }) {
    // Build projection points: extend from last history point using linear trend
    const projPoints = useMemo(() => {
        if (scoreHistory.length < 3) return []
        const last = scoreHistory[scoreHistory.length - 1]
        const prev = scoreHistory[Math.max(0, scoreHistory.length - 6)]
        const dt = last.t - prev.t
        if (dt <= 0) return []
        const slope = (last.score - prev.score) / dt
        const pts = []
        for (let i = 1; i <= 8; i++) {
            const t = last.t + i * 10
            const s = Math.max(0, Math.min(100, last.score + slope * i * 10))
            pts.push({ t, score: undefined as undefined, proj: s })
        }
        return pts
    }, [scoreHistory])

    const chartData = useMemo(() => {
        const hist = scoreHistory.map(p => ({ t: p.t, score: p.score, proj: undefined as number | undefined }))
        return [...hist, ...projPoints]
    }, [scoreHistory, projPoints])

    const scoreColor = score !== null ? (score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444') : 'rgba(255,255,255,0.2)'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Gauge row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{ flexShrink: 0 }}>
                    {score !== null ? <CircleGauge score={score} /> : (
                        <div style={{ width: '120px', height: '120px', borderRadius: '50%', border: '8px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="text-[10px] font-bold opacity-30">--</span>
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">집중 점수</span>
                        <span className="text-4xl font-black tabular-nums" style={{ color: scoreColor }}>
                            {score !== null ? score.toFixed(1) : '--'}
                            <span className="text-lg font-bold opacity-40"> / 100</span>
                        </span>
                    </div>
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-0.5">집중 유지 ETA</span>
                        <span className="text-xl font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {etaS !== null ? formatEtaMMSS(etaS) : '측정 중...'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Score history + projection chart */}
            {chartData.length > 1 && (
                <div>
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">집중도 추이 + 예측 곡선</span>
                    <div style={{ width: '100%', height: '120px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                                <XAxis dataKey="t" hide />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} />
                                <Tooltip
                                    contentStyle={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '10px' }}
                                    labelFormatter={() => ''}
                                    formatter={(val: number | undefined) => [val != null ? val.toFixed(1) : '--', '']}
                                />
                                <ReferenceLine y={70} stroke="rgba(34,197,94,0.3)" strokeDasharray="3 3" />
                                <ReferenceLine y={40} stroke="rgba(245,158,11,0.3)" strokeDasharray="3 3" />
                                <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={2} dot={false} connectNulls={false} />
                                <Line type="monotone" dataKey="proj" stroke="#818cf8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Tab 2: 시선 ──────────────────────────────────────────────────────────────
function GazeTab({ features, gazeX, gazeY }: {
    features: ReturnType<typeof useFocusSync>['features']
    gazeX?: number | null  // actual calibrated gaze pos, 0-1 normalized (from native)
    gazeY?: number | null
}) {
    const [dotPos, setDotPos] = useState({ x: 0.5, y: 0.5 })
    const dotPosRef = useRef({ x: 0.5, y: 0.5 })
    const hasActualGaze = gazeX != null && gazeY != null

    useEffect(() => {
        if (hasActualGaze) {
            // Use calibrated gaze position directly (smooth with light EMA)
            const nx = Math.min(1, Math.max(0, gazeX!))
            const ny = Math.min(1, Math.max(0, gazeY!))
            dotPosRef.current = { x: dotPosRef.current.x * 0.6 + nx * 0.4, y: dotPosRef.current.y * 0.6 + ny * 0.4 }
            setDotPos({ ...dotPosRef.current })
        }
    }, [gazeX, gazeY, hasActualGaze])

    const saccadeRate = features?.saccade_rate ?? 0
    const isSaccade = saccadeRate > 2
    const dotColor = isSaccade ? '#f472b6' : '#22c55e'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">
                    {hasActualGaze ? '캘리브레이션 기반 실시간 시선 위치' : '시선 위치 (캘리브레이션 후 정확도 향상)'}
                </span>
                <div style={{ position: 'relative', width: '100%', paddingTop: '50%', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: `1px solid ${hasActualGaze ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0 }}>
                        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ position: 'absolute', top: '33%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                        <div style={{ position: 'absolute', top: '66%', left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.04)' }} />
                    </div>
                    {hasActualGaze ? (
                        <motion.div
                            animate={{ left: `${dotPos.x * 100}%`, top: `${dotPos.y * 100}%` }}
                            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                            style={{ position: 'absolute', width: '18px', height: '18px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 14px 5px ${dotColor}66`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
                        />
                    ) : (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="text-[10px] opacity-30">캘리브레이션 필요</span>
                        </div>
                    )}
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.12, pointerEvents: 'none' }}>
                        <div style={{ width: '20px', height: '1px', background: 'white', position: 'absolute', top: 0, left: '-10px' }} />
                        <div style={{ width: '1px', height: '20px', background: 'white', position: 'absolute', top: '-10px', left: 0 }} />
                    </div>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <MetricCard label="새카드율 (시선 점프)" value={features?.saccade_rate} unit="/s" decimals={2} color="#f472b6" />
                <MetricCard label="고정 비율 (응시 유지)" value={features?.fixation_ratio} unit="" decimals={2} color="#22c55e" />
                <MetricCard label="평균 고정 시간" value={features?.mean_fix_duration} unit="s" decimals={3} color="#60a5fa" />
                <MetricCard label="평균 시선 속도" value={features?.mean_velocity} unit="px/s" decimals={0} color="#a78bfa" />
                <MetricCard label="속도 분산" value={features?.std_velocity} unit="px/s" decimals={0} color="#fb923c" />
                <MetricCard label="EAR (눈 감은 정도)" value={features?.mean_ear} unit="" decimals={3} color="#facc15" />
                <MetricCard label="EAR 최솟값 (순간 졸음)" value={features?.min_ear} unit="" decimals={3} color="#f97316" />
                <MetricCard label="유효 프레임 비율" value={features?.valid_ratio} unit="" decimals={2} color="#34d399" />
            </div>

            {/* 고급 모드: 졸음·자세 상세 지표 */}
            <AdvancedFeaturesSection features={features} />
        </div>
    )
}

// ── 고급 모드: 졸음·자세 ───────────────────────────────────────────────────────

const ADVANCED_FEATURES_KEY = 'sm_advanced_features'

/** 고급 모드 전용 지표 카드. perclos는 ×100 후 %, 나머지는 지정 단위/소수. null/비유한 → "—". */
function AdvancedMetricCard({ label, value, unit, decimals, scale = 1, color }: {
    label: string; value: number | undefined | null; unit: string; decimals: number; scale?: number; color: string
}) {
    const valid = value !== undefined && value !== null && isFinite(value as number)
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
            <span className="block text-[9px] font-black uppercase tracking-widest opacity-40 mb-1">{label}</span>
            <span className="text-base font-bold tabular-nums" style={{ color: valid ? color : 'rgba(255,255,255,0.2)' }}>
                {valid ? `${((value as number) * scale).toFixed(decimals)}${unit}` : '—'}
            </span>
        </div>
    )
}

function AdvancedFeaturesSection({ features }: { features: ReturnType<typeof useFocusSync>['features'] }) {
    const enabled = localStorage.getItem(ADVANCED_FEATURES_KEY) === 'true'
    if (!enabled) return null

    return (
        <div>
            <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2 mt-2">졸음·자세 (고급 모드)</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <AdvancedMetricCard label="PERCLOS (눈 감은 비율)" value={features?.perclos} unit="%" decimals={1} scale={100} color="#f97316" />
                <AdvancedMetricCard label="깜빡임 빈도" value={features?.blink_rate_hz} unit="/s" decimals={2} color="#facc15" />
                <AdvancedMetricCard label="평균 깜빡임 시간" value={features?.mean_blink_dur_s} unit="s" decimals={2} color="#fb923c" />
                <AdvancedMetricCard label="EAR 정규화" value={features?.ear_norm} unit="" decimals={3} color="#fbbf24" />
                <AdvancedMetricCard label="시선 분산 정규화" value={features?.disp_norm} unit="" decimals={3} color="#a78bfa" />
                <AdvancedMetricCard label="고개 상하 각도" value={features?.head_pitch_deg} unit="°" decimals={1} color="#60a5fa" />
                <AdvancedMetricCard label="고개 좌우 각도" value={features?.head_yaw_deg} unit="°" decimals={1} color="#22d3ee" />
                <AdvancedMetricCard label="고개 움직임 표준편차" value={features?.head_move_std_deg} unit="°" decimals={2} color="#34d399" />
                <AdvancedMetricCard label="EAR 추세 (60초)" value={features?.ear_slope_60s} unit="" decimals={3} color="#f472b6" />
                <AdvancedMetricCard label="고정비율 추세 (60초)" value={features?.fix_ratio_slope_60s} unit="" decimals={3} color="#818cf8" />
            </div>
        </div>
    )
}

// ── Tab 3: 생체신호 ───────────────────────────────────────────────────────────
function BioTab({ features, roiColors }: {
    features: ReturnType<typeof useFocusSync>['features']
    roiColors?: { forehead?: string; rightCheek?: string; leftCheek?: string } | null
}) {
    const bpm = features?.bpm
    const pulsePeriodMs = bpm && isFinite(bpm) && bpm > 0 ? (60000 / bpm) : 1000
    const [pulse, setPulse] = useState(false)
    const hasActualColors = !!(roiColors?.forehead)

    useEffect(() => {
        const id = setInterval(() => setPulse(p => !p), pulsePeriodMs / 2)
        return () => clearInterval(id)
    }, [pulsePeriodMs])

    // If actual ROI colors are available, use them directly
    // Otherwise fall back to LF/HF-based estimate
    const lf_hf = features?.lf_hf
    const stress = lf_hf && isFinite(lf_hf) ? Math.min(1, lf_hf / 4) : 0.5
    const rEst = Math.round(200 + stress * 40), gEst = Math.round(120 - stress * 30), bEst = Math.round(120 - stress * 20)

    const foreheadColor = roiColors?.forehead ?? `rgb(${rEst},${gEst},${bEst})`
    const rCheekColor = roiColors?.rightCheek ?? foreheadColor
    const lCheekColor = roiColors?.leftCheek ?? foreheadColor

    // Average color for pulsing face
    const pulseBase = foreheadColor
    const pulseBright = pulse
        ? pulseBase.startsWith('#')
            ? pulseBase + 'cc'  // darken slightly on pulse for hex
            : pulseBase
        : pulseBase

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
                <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-2">
                    rPPG 얼굴 ROI 색상 {hasActualColors ? '(실시간 측정값)' : '(추정값)'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', border: `1px solid ${hasActualColors ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
                    {/* Face regions: forehead top + cheeks below */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        {/* Forehead */}
                        <motion.div
                            animate={{ scale: pulse ? 1.06 : 1.0, background: pulseBright }}
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                            style={{ width: '44px', height: '22px', borderRadius: '8px 8px 4px 4px', boxShadow: `0 0 12px 3px ${foreheadColor}88` }}
                        />
                        {/* Eyes placeholder */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <div style={{ width: '14px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                            <div style={{ width: '14px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                        </div>
                        {/* Cheeks */}
                        <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                            <motion.div animate={{ background: rCheekColor }} transition={{ duration: 0.3 }}
                                style={{ width: '16px', height: '12px', borderRadius: '50%', boxShadow: `0 0 6px ${rCheekColor}88` }} />
                            <div style={{ width: '12px', height: '22px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />
                            <motion.div animate={{ background: lCheekColor }} transition={{ duration: 0.3 }}
                                style={{ width: '16px', height: '12px', borderRadius: '50%', boxShadow: `0 0 6px ${lCheekColor}88` }} />
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <p className="text-[10px] opacity-50 leading-relaxed">
                            <span style={{ color: '#00dcff' }}>이마</span> + <span style={{ color: '#ffa040' }}>양쪽 볼</span> 3곳 ROI의<br />
                            평균 RGB 색상을 실시간으로 추출합니다.<br />
                            미세한 <span style={{ color: '#f472b6' }}>혈류 변화</span>로 심박수를 계산합니다.
                        </p>
                        {hasActualColors && (
                            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                                <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: foreheadColor, border: '1px solid rgba(255,255,255,0.2)' }} />
                                <span className="text-[9px] opacity-40">이마</span>
                                <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: rCheekColor, border: '1px solid rgba(255,255,255,0.2)' }} />
                                <span className="text-[9px] opacity-40">오른볼</span>
                                <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: lCheekColor, border: '1px solid rgba(255,255,255,0.2)' }} />
                                <span className="text-[9px] opacity-40">왼볼</span>
                            </div>
                        )}
                        {hasActualColors && (
                            <p className="text-[9px] opacity-25 mt-1 font-mono">{roiColors?.forehead} · {roiColors?.rightCheek} · {roiColors?.leftCheek}</p>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                <MetricCard label="BPM (심박수)" value={features?.bpm} unit="" decimals={0} color="#f472b6" />
                <MetricCard label="RMSSD (심박 변동)" value={features?.rmssd} unit="ms" decimals={1} color="#fb923c" />
                <MetricCard label="SDNN (전체 변동성)" value={features?.sdnn} unit="ms" decimals={1} color="#facc15" />
                <MetricCard label="LF/HF (교감/부교감)" value={features?.lf_hf} unit="" decimals={2} color="#60a5fa" />
                <MetricCard label="X 분산 (좌우 시선)" value={features?.dispersion_x} unit="px" decimals={0} color="#a78bfa" />
                <MetricCard label="Y 분산 (상하 시선)" value={features?.dispersion_y} unit="px" decimals={0} color="#34d399" />
            </div>
        </div>
    )
}

const FOCUS_TABS = ['집중도', '시선', '생체신호'] as const
type FocusTabName = typeof FOCUS_TABS[number]

type MeasureMode = 'pc' | 'native' | 'web'

function FocusPanel() {
    const isApp = NativeBridge.isNative()
    const localMode: MeasureMode = isApp ? 'native' : 'web'
    const [mode, setMode] = useState<MeasureMode>(() => {
        const saved = localStorage.getItem('focus_measure_mode') as MeasureMode | null
        return saved === 'pc' ? 'pc' : localMode
    })
    const saveMode = (m: MeasureMode) => { setMode(m); localStorage.setItem('focus_measure_mode', m) }

    if (mode === 'pc') return <FocusPanelPC onSwitchMode={() => saveMode(localMode)} />
    return isApp
        ? <FocusPanelNative onSwitchMode={() => saveMode('pc')} />
        : <FocusPanelWeb onSwitchMode={() => saveMode('pc')} />
}

function FocusPanelPC({ onSwitchMode }: { onSwitchMode: () => void }) {
    const serverUrl = useMemo(() => localStorage.getItem('focus_server_url') ?? '', [])
    const { score, etaS, features, connected, sendVideoFrame } = useFocusSync(serverUrl)
    const [activeTab, setActiveTab] = useState<FocusTabName>('집중도')
    const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([])
    const tStartRef = useRef(Date.now())

    useEffect(() => {
        if (score === null) return
        setScoreHistory(prev => {
            const t = (Date.now() - tStartRef.current) / 1000
            const next = [...prev, { t, score }]
            return next.length > 60 ? next.slice(next.length - 60) : next
        })
    }, [score])

    return (
        <div className="mt-6 w-full max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-sm p-5"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FocusPanelHeader
                label="PC 연결 측정"
                dot={connected}
                dotLabel={connected ? 'Connected' : 'Disconnected'}
                onSwitchMode={onSwitchMode}
                switchLabel="태블릿 자체 측정으로"
            />
            <FocusTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
            <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                    {activeTab === '집중도' && <FocusTab score={score} etaS={etaS} scoreHistory={scoreHistory} />}
                    {activeTab === '시선' && <GazeTab features={features} gazeX={null} gazeY={null} />}
                    {activeTab === '생체신호' && <BioTab features={features} roiColors={null} />}
                </motion.div>
            </AnimatePresence>
            <TabletCamera sendVideoFrame={sendVideoFrame} connected={connected} fps={10} />
        </div>
    )
}

/** 태블릿(네이티브) / 브라우저(웹) 자체 측정 엔진의 공통 인터페이스. */
interface FocusEngine {
    score: number | null
    etaS: number | null
    features: FocusFeatures | null
    running: boolean
    status: string
    cameraJpeg: string | null
    gazeX: number | null
    gazeY: number | null
    roiColors: { forehead?: string; rightCheek?: string; leftCheek?: string } | null
    trainingState: { session_count: number; is_calibrated: boolean } | null
    start: (opts?: { lightMode?: boolean }) => void | Promise<void>
    stop: () => void | Promise<void>
    startCalibration: (scenario?: 'book' | 'monitor') => Promise<boolean | void>
    setDebugMode: (enabled: boolean) => void | Promise<void>
    addSessionRating: (mean: number, rating: number) => void | Promise<void>
}

function FocusPanelNative({ onSwitchMode }: { onSwitchMode: () => void }) {
    const engine = useFocusNative()
    return (
        <LocalFocusPanel
            engine={engine}
            available={engine.isNative}
            supportsCalibration
            label="태블릿 자체 측정"
            switchLabel="PC 연결로"
            unavailableMsg="태블릿 자체 측정은 Android 앱에서만 사용 가능합니다"
            onSwitchMode={onSwitchMode}
        />
    )
}

function FocusPanelWeb({ onSwitchMode }: { onSwitchMode: () => void }) {
    const engine = useFocusWeb()
    return (
        <LocalFocusPanel
            engine={engine}
            available
            supportsCalibration={false}
            label="브라우저 자체 측정"
            switchLabel="PC 연결로"
            onSwitchMode={onSwitchMode}
        />
    )
}

function LocalFocusPanel({ engine, available, supportsCalibration, label, switchLabel, unavailableMsg, onSwitchMode }: {
    engine: FocusEngine
    available: boolean
    supportsCalibration: boolean
    label: string
    switchLabel: string
    unavailableMsg?: string
    onSwitchMode: () => void
}) {
    const { score, etaS, features, running, status,
            cameraJpeg, gazeX, gazeY, roiColors,
            trainingState, addSessionRating,
            start, stop, startCalibration, setDebugMode } = engine
    const [cameraOpen, setCameraOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<FocusTabName>('집중도')
    const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([])
    const tStartRef = useRef(Date.now())
    const sessionMeanRef = useRef<number[]>([])
    const [showRating, setShowRating] = useState(false)
    const [ratingHover, setRatingHover] = useState(0)
    // 측정 모드 선택: false=집중도+졸음(풀), true=졸음만(라이트). 측정 중에는 변경 불가.
    const [lightMode, setLightMode] = useState(false)

    useEffect(() => {
        // 라이트 모드(점수 없음) 또는 NaN 점수는 집중도 이력/평점 산정에서 제외
        if (score === null || !Number.isFinite(score)) return
        sessionMeanRef.current.push(score)
        setScoreHistory(prev => {
            const t = (Date.now() - tStartRef.current) / 1000
            const next = [...prev, { t, score }]
            return next.length > 60 ? next.slice(next.length - 60) : next
        })
    }, [score])

    // Show rating UI when session ends; collapse camera when stopped
    useEffect(() => {
        if (!running && scoreHistory.length > 5) {
            setShowRating(true)
        }
        if (!running && cameraOpen) {
            setCameraOpen(false)
            setDebugMode(false)
        }
        if (running) {
            setShowRating(false)
            sessionMeanRef.current = []
        }
    }, [running])

    const handleRating = async (rating: number) => {
        const scores = sessionMeanRef.current
        if (scores.length === 0) return
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length
        await addSessionRating(mean, rating)
        setShowRating(false)
        sessionMeanRef.current = []
    }

    const statusLabel = status === 'unavailable' ? '앱에서만 사용 가능'
        : status === 'starting' ? '시작 중...'
        : status === 'running' ? '측정 중'
        : status === 'error' ? '오류'
        : '대기 중'
    const statusColor = status === 'running' ? '#22c55e' : status === 'error' ? '#ef4444' : status === 'unavailable' ? '#6b7280' : '#f59e0b'

    return (
        <div className="mt-6 w-full max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/5 backdrop-blur-sm p-5"
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FocusPanelHeader
                label={label}
                dot={status === 'running'}
                dotColor={statusColor}
                dotLabel={statusLabel}
                onSwitchMode={onSwitchMode}
                switchLabel={switchLabel}
            />

            {/* 측정 모드 선택 (측정 시작 전에만) */}
            {available && !running && (
                <div style={{ display: 'flex', gap: '6px', padding: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '12px' }}>
                    {([
                        { v: false, label: '집중도 + 졸음', desc: '전체 측정' },
                        { v: true, label: '졸음만 (라이트)', desc: '저전력' },
                    ] as const).map(opt => (
                        <button
                            key={String(opt.v)}
                            onClick={() => setLightMode(opt.v)}
                            disabled={status === 'starting'}
                            style={{
                                flex: 1, padding: '8px 0', borderRadius: '9px', fontSize: '11px', fontWeight: 800,
                                display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center',
                                background: lightMode === opt.v ? 'rgba(129,140,248,0.22)' : 'transparent',
                                color: lightMode === opt.v ? '#a5b4fc' : 'rgba(255,255,255,0.4)',
                                border: lightMode === opt.v ? '1px solid rgba(129,140,248,0.35)' : '1px solid transparent',
                                cursor: status === 'starting' ? 'not-allowed' : 'pointer', transition: 'all 0.2s ease',
                            }}
                        >
                            <span>{opt.label}</span>
                            <span style={{ fontSize: '8px', opacity: 0.6, fontWeight: 700 }}>{opt.desc}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Start/Stop + Calibration controls */}
            {available && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={running ? stop : () => start({ lightMode })}
                        disabled={status === 'starting' || status === 'unavailable'}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: '10px', fontSize: '12px', fontWeight: 800,
                            background: running ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                            color: running ? '#f87171' : '#4ade80',
                            border: `1px solid ${running ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                            cursor: status === 'starting' || status === 'unavailable' ? 'not-allowed' : 'pointer',
                            opacity: status === 'starting' || status === 'unavailable' ? 0.5 : 1,
                            transition: 'all 0.2s ease',
                        }}
                    >
                        {status === 'starting' ? '시작 중...' : running ? '측정 중지' : lightMode ? '졸음 감지 시작' : '측정 시작'}
                    </button>
                    {supportsCalibration && (
                        <button
                            onClick={() => startCalibration('monitor')}
                            style={{
                                padding: '10px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700,
                                background: 'rgba(129,140,248,0.12)', color: '#a5b4fc',
                                border: '1px solid rgba(129,140,248,0.25)', cursor: 'pointer',
                            }}
                        >
                            캘리브레이션
                        </button>
                    )}
                </div>
            )}

            {/* Camera preview — collapsed by default to avoid throttling */}
            {available && running && (
                <div>
                    <button
                        onClick={() => {
                            const next = !cameraOpen
                            setCameraOpen(next)
                            setDebugMode(next)
                        }}
                        style={{
                            width: '100%', padding: '7px 12px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                            background: cameraOpen ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
                            color: cameraOpen ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                            border: `1px solid ${cameraOpen ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)'}`,
                            cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '6px',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        <span style={{ fontSize: '9px' }}>{cameraOpen ? '▼' : '▶'}</span>
                        카메라 미리보기 {cameraOpen ? '' : '(성능 영향 없음)'}
                    </button>
                    {cameraOpen && (
                        <div style={{ marginTop: '6px', position: 'relative', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#000' }}>
                            {cameraJpeg
                                ? <img src={cameraJpeg} alt="카메라 미리보기" style={{ width: '100%', display: 'block', objectFit: 'contain', maxHeight: '240px' }} />
                                : <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>프레임 대기 중...</div>
                            }
                            {cameraJpeg && (
                                <div style={{ position: 'absolute', bottom: '6px', left: '8px', fontSize: '9px', fontWeight: 700,
                                    color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: '4px' }}>
                                    LIVE · ROI 오버레이
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Session rating after measurement */}
            {available && showRating && (
                <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#a5b4fc', marginBottom: '10px', textAlign: 'center' }}>
                        세션 집중도를 평가해주세요 (점수 개인화에 사용됩니다)
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        {[1,2,3,4,5].map(r => (
                            <button
                                key={r}
                                onClick={() => handleRating(r)}
                                onMouseEnter={() => setRatingHover(r)}
                                onMouseLeave={() => setRatingHover(0)}
                                style={{
                                    fontSize: '22px', background: 'none', border: 'none', cursor: 'pointer',
                                    opacity: ratingHover > 0 ? (r <= ratingHover ? 1 : 0.3) : 0.6,
                                    transform: r <= ratingHover ? 'scale(1.2)' : 'scale(1)',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                ★
                            </button>
                        ))}
                    </div>
                    {trainingState && (
                        <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: '6px' }}>
                            누적 {trainingState.session_count}회 · {trainingState.is_calibrated ? '✓ 개인화 적용 중' : `${3 - trainingState.session_count}회 더 필요`}
                        </p>
                    )}
                    <button
                        onClick={() => setShowRating(false)}
                        style={{ display: 'block', margin: '8px auto 0', fontSize: '9px', color: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                        건너뛰기
                    </button>
                </div>
            )}

            {!available && unavailableMsg && (
                <div style={{ padding: '16px', background: 'rgba(107,114,128,0.1)', borderRadius: '12px', border: '1px solid rgba(107,114,128,0.2)', textAlign: 'center' }}>
                    <p className="text-[11px] opacity-50">{unavailableMsg}</p>
                </div>
            )}

            {/* 라이트 모드면 졸음 전용 상태 카드, 아니면 집중도 탭들 */}
            {lightMode ? (
                <LightModeStatus features={features} running={running} />
            ) : (
                <>
                    <FocusTabBar activeTab={activeTab} setActiveTab={setActiveTab} />
                    <AnimatePresence mode="wait">
                        <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                            {activeTab === '집중도' && <FocusTab score={score} etaS={etaS} scoreHistory={scoreHistory} />}
                            {activeTab === '시선' && <GazeTab features={features} gazeX={gazeX} gazeY={gazeY} />}
                            {activeTab === '생체신호' && <BioTab features={features} roiColors={roiColors} />}
                        </motion.div>
                    </AnimatePresence>
                </>
            )}

            {/* 졸음 감지 경고 — 집중도 측정 중에도, 라이트 모드 단독으로도 작동 */}
            <DrowsinessAlert features={features} running={running} />
        </div>
    )
}

/**
 * 졸음 감지 경고. 집중도 측정 중 features.mean_ear 스트림으로 눈 감김 지속을 추적하고,
 * 임계(≈15초)를 넘으면 디바이스 벨소리 모드에 따라 소리/진동으로 알리며(무음이면 화면만),
 * 눈을 다시 뜰 때까지 전체화면 팝업을 띄운다.
 */
function DrowsinessAlert({ features, running }: { features: FocusFeatures | null; running: boolean }) {
    const { drowsy } = useDrowsiness(features, running)
    const [ringerMode, setRingerMode] = useState<RingerMode>('normal')
    const stopAlarmRef = useRef<(() => void) | null>(null)

    // 알람(소리/진동)은 외부 시스템 → effect 로 동기화. 눈을 다시 뜨면(drowsy=false) 정지.
    useEffect(() => {
        if (!drowsy) {
            stopAlarmRef.current?.()
            stopAlarmRef.current = null
            return
        }
        let cancelled = false
        ;(async () => {
            const mode = await NativeBridge.getRingerMode()
            if (cancelled) return
            setRingerMode(mode) // 비동기 콜백 내 setState (허용)
            const modality: AlarmModality = mode === 'silent' ? 'silent' : mode === 'vibrate' ? 'vibrate' : 'sound'
            stopAlarmRef.current = startDrowsyAlarm(modality)
        })()
        return () => {
            cancelled = true
            stopAlarmRef.current?.()
            stopAlarmRef.current = null
        }
    }, [drowsy])

    if (!drowsy) return null

    // "확인": 현재 알람만 즉시 끔(팝업은 눈을 다시 뜰 때까지 유지). 상태 불필요 — ref 로 정지.
    const silence = () => { stopAlarmRef.current?.(); stopAlarmRef.current = null }

    const modeLabel = ringerMode === 'silent'
        ? '무음 모드 — 소리·진동 없이 화면으로만 알립니다'
        : ringerMode === 'vibrate'
            ? '진동으로 알리는 중'
            : '소리로 알리는 중'

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="absolute inset-0 bg-red-950/60 backdrop-blur-md"
            />
            <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: [1, 1.03, 1], opacity: 1 }}
                transition={{ scale: { repeat: Infinity, duration: 1.1 } }}
                className="relative liquid-modal p-10 flex flex-col items-center gap-5 max-w-sm w-full text-center shadow-2xl border border-red-500/40"
            >
                <Icon icon="mdi:sleep" className="text-7xl text-red-400" />
                <h3 className="text-3xl font-black tracking-tight">졸음이 감지됐어요!</h3>
                <p className="font-bold opacity-70 leading-relaxed">
                    눈이 15초 넘게 감겨 있었어요.<br />눈을 크게 뜨고 잠을 깨워주세요.
                </p>
                <p className="text-[11px] font-bold uppercase tracking-widest text-red-300/80">{modeLabel}</p>
                <button
                    onClick={silence}
                    className="w-full py-4 bg-red-500 hover:bg-red-400 text-white rounded-2xl font-black text-lg shadow-xl active:scale-95 transition-all"
                >
                    확인 (소리·진동 끄기)
                </button>
                <p className="text-[10px] opacity-40">눈을 다시 뜨면 자동으로 닫힙니다</p>
            </motion.div>
        </div>,
        document.body,
    )
}

/** 라이트 모드(졸음 전용) 상태 카드. 집중 점수·심박 측정은 끄고 눈 상태만 감시함을 안내. */
function LightModeStatus({ features, running }: { features: FocusFeatures | null; running: boolean }) {
    const eyesDetected = features != null && Number.isFinite(features.mean_ear)
    return (
        <div style={{ padding: '18px', borderRadius: '14px', background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', textAlign: 'center' }}>
            <Icon icon="mdi:eye-check-outline" style={{ fontSize: '34px', color: running ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }} />
            <p style={{ fontSize: '14px', fontWeight: 800, color: running ? '#c7d2fe' : 'rgba(255,255,255,0.5)' }}>
                {running ? (eyesDetected ? '눈 상태 감시 중' : '얼굴을 찾는 중…') : '졸음 감지 라이트 모드'}
            </p>
            <p style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
                {running
                    ? '눈이 15초 넘게 감기면 알려드려요.'
                    : '“졸음 감지 시작”을 누르면 눈 상태만 가볍게 감시합니다.'}
                <br />집중 점수·심박(rPPG) 측정은 꺼져 <b>배터리를 절약</b>합니다.
            </p>
        </div>
    )
}

function FocusPanelHeader({ label, dot, dotColor, dotLabel, onSwitchMode, switchLabel }: {
    label: string; dot: boolean; dotColor?: string; dotLabel: string; onSwitchMode: () => void; switchLabel: string
}) {
    const color = dotColor ?? (dot ? '#22c55e' : '#ef4444')
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">집중도 모니터</span>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(129,140,248,0.15)', color: '#a5b4fc', border: '1px solid rgba(129,140,248,0.2)' }}>{label}</span>
                <HelpButton dark title="집중도 모니터란?" items={[
                    { description: '카메라로 얼굴을 분석해 집중 점수(0–100)를 실시간으로 측정합니다.' },
                    { title: '집중도 탭', description: '전체 집중 점수와 트렌드 그래프, 집중 유지 예상 시간(ETA)을 보여줍니다.' },
                    { title: '시선 탭', description: '눈 움직임(새카드율·고정 비율)을 분석해 시선이 분산되는지 추적합니다.' },
                    { title: '생체신호 탭', description: 'rPPG 기술로 카메라에서 심박수·심박 변동성 등 생체 신호를 비접촉으로 측정합니다.' },
                    { title: '측정 모드', description: '브라우저 자체 측정(웹캠) 또는 PC 연결 측정(별도 서버)을 지원합니다.' },
                ]} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, boxShadow: dot ? `0 0 5px ${color}` : 'none', transition: 'all 0.4s ease' }} />
                    <span className="text-[10px] font-bold opacity-40">{dotLabel}</span>
                </div>
                <button onClick={onSwitchMode} style={{
                    fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
                    border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                    transition: 'all 0.2s ease',
                }}>
                    {switchLabel} ↕
                </button>
            </div>
        </div>
    )
}

function FocusTabBar({ activeTab, setActiveTab }: { activeTab: FocusTabName; setActiveTab: (t: FocusTabName) => void }) {
    return (
        <div style={{ display: 'flex', gap: '4px', padding: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '12px' }}>
            {FOCUS_TABS.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    flex: 1, padding: '6px 0', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
                    background: activeTab === tab ? 'rgba(129,140,248,0.25)' : 'transparent',
                    color: activeTab === tab ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                    border: activeTab === tab ? '1px solid rgba(129,140,248,0.35)' : '1px solid transparent',
                    transition: 'all 0.2s ease', cursor: 'pointer',
                }}>
                    {tab}
                </button>
            ))}
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

// ── Thought Parking Drawer ────────────────────────────────────────────────────

interface ThoughtParkingDrawerProps {
    isOpen: boolean
    onClose: () => void
    parkedNotes: ThoughtNote[]
    onPark: (content: string) => Promise<void>
}

function ThoughtParkingDrawer({ isOpen, onClose, parkedNotes, onPark }: ThoughtParkingDrawerProps) {
    const [input, setInput] = useState('')
    const [justParked, setJustParked] = useState<string | null>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300)
        }
    }, [isOpen])

    const handlePark = async () => {
        const text = input.trim()
        if (!text) return
        setJustParked(text)
        setInput('')
        await onPark(text)
        setTimeout(() => setJustParked(null), 2000)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handlePark()
        }
        if (e.key === 'Escape') onClose()
    }

    const formatAgo = (ts: number) => {
        const diff = Math.floor((Date.now() - ts) / 1000)
        if (diff < 60) return `${diff}초 전`
        return `${Math.floor(diff / 60)}분 전`
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-end">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                        className="relative w-full liquid-modal rounded-b-none rounded-t-[2rem] p-6 pb-10 max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Handle bar */}
                        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-5" />

                        {/* Header */}
                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
                                    <span className="text-base font-black text-blue-400">P</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-white">생각 주차장</h3>
                                    <p className="text-[11px] text-white/40">지금 공부와 관계없는 생각을 여기 버려두고 집중으로 돌아가세요</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/40 hover:bg-white/20 transition-all">
                                ×
                            </button>
                        </div>

                        {/* Parked notes list */}
                        {parkedNotes.length > 0 && (
                            <div className="mt-4 space-y-2 max-h-44 overflow-y-auto no-scrollbar">
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-2">이번 세션에 주차됨</p>
                                <AnimatePresence>
                                    {[...parkedNotes].reverse().map((note, i) => (
                                        <motion.div
                                            key={note.id ?? i}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-400/20"
                                        >
                                            <span className="text-blue-400 font-black text-xs mt-0.5 flex-shrink-0">P</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-white/80 leading-relaxed">{note.content}</p>
                                                <p className="text-[10px] text-white/25 mt-0.5">{formatAgo(note.createdAt)}</p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}

                        {/* Success flash */}
                        <AnimatePresence>
                            {justParked && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="mt-3 px-4 py-2.5 rounded-xl bg-green-500/15 border border-green-400/25 text-center"
                                >
                                    <p className="text-xs font-bold text-green-400">주차 완료! 이 생각은 안전해요.</p>
                                    <p className="text-[10px] text-white/30 mt-0.5">"{justParked.slice(0, 30)}{justParked.length > 30 ? '...' : ''}"</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Input area */}
                        <div className="mt-4 flex flex-col gap-3">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="지금 머릿속에 걸리는 생각... (Enter로 주차)"
                                rows={3}
                                className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 resize-none outline-none focus:border-blue-400/40 focus:bg-white/[0.08] transition-all font-medium text-sm leading-relaxed"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={handlePark}
                                    disabled={!input.trim()}
                                    className="flex-1 py-4 rounded-2xl bg-blue-500/80 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-black text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <span className="text-base font-black">P</span> 주차하기
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white/50 font-bold text-sm transition-all active:scale-95"
                                >
                                    집중으로 돌아가기 →
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
