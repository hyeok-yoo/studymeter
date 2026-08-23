import { useState, useEffect } from 'react'
import { db, deleteStudySession, updateStudySession, formatDuration, getTodayDate, formatTimeHHMM, findOverlappingSession, adjustOverlappingSession, getLatestEndTime, getEvalScore } from '../lib/db'
import { useModal } from '../lib/ModalContext'
import { maybeSyncToday } from '../lib/telemetry'
import type { Settings, StudySession, DailyRecord, EvalTag } from '../lib/db'
import { getTopTags, getTagsForScope, recordTagUsage, TAG_CATEGORY_LABELS } from '../lib/tags'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { spring } from '../lib/motion'
import Pressable from '../components/ui/Pressable'
import Chip from '../components/ui/Chip'
import Modal from '../components/ui/Modal'
import { addDays, koDate, parseHhmm } from '../lib/format'

interface EditRecordsProps {
    settings: Settings
}

/**
 * 이 폼의 입력 필드 공통 클래스.
 * ui/styles 의 `inputCompact` 토큰과 달리 여기는 아직 하드코딩 색을 쓴다 —
 * 토큰은 `--color-surface` 를 참조하는데 그 변수가 아직 정의돼 있지 않아
 * 배경이 투명해져 버린다. 변수를 채우기 전까지는 이 상수가 단일 소스다.
 */
const FIELD = 'px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500'

export default function EditRecords({ settings }: EditRecordsProps) {
    const { showConfirm } = useModal()
    const [selectedDate, setSelectedDate] = useState(getTodayDate())
    const [dailyRecord, setDailyRecord] = useState<DailyRecord | null>(null)
    const [recentSessions, setRecentSessions] = useState<StudySession[]>([])

    // Form for Adding/Editing Manual Session
    const [addSubject, setAddSubject] = useState(settings.subjects[0]?.name || '')
    const [addSubItem, setAddSubItem] = useState<string | undefined>(undefined)
    const [addType, setAddType] = useState(settings.types[0])
    const [editingSessionId, setEditingSessionId] = useState<number | null>(null)

    // Dual input mode: 'duration' or 'timeRange'
    const [inputMode, setInputMode] = useState<'duration' | 'timeRange'>('duration')

    // Duration mode inputs
    const [inputHours, setInputHours] = useState('')
    const [inputMinutes, setInputMinutes] = useState('')

    // Time range mode inputs
    const [inputStartTime, setInputStartTime] = useState('')
    const [inputEndTime, setInputEndTime] = useState('')

    // Evaluation inputs (신형: 단일 점수 + 태그)
    const [score, setScore] = useState<number | null>(null)
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [showAllTags, setShowAllTags] = useState(false)
    const [showEvalFields, setShowEvalFields] = useState(false)
    const [correct, setCorrect] = useState('')
    const [total, setTotal] = useState('')
    const [memo, setMemo] = useState('')

    const toggleTag = (name: string) => {
        setSelectedTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
    }

    // 표시할 태그 목록: 기본 상위 8개(선택된 것 우선), 더보기 시 카테고리별 전체
    const topTags: EvalTag[] = getTopTags(settings, 'session', 8, selectedTags)
    const allTagsByCategory: Array<[EvalTag['category'], EvalTag[]]> =
        (Object.keys(TAG_CATEGORY_LABELS) as EvalTag['category'][])
            .map(cat => [cat, getTagsForScope(settings, 'session').filter(t => t.category === cat)] as [EvalTag['category'], EvalTag[]])
            .filter(([, tags]) => tags.length > 0)

    // Overlap warning state
    const [showOverlapWarning, setShowOverlapWarning] = useState(false)
    const [overlappingSession, setOverlappingSession] = useState<StudySession | null>(null)
    /** 기존 세션의 종료 시간을 앞당겨 겹침을 풀 수 있는지 (기존 세션이 먼저 시작했을 때만) */
    const [canTrimOverlap, setCanTrimOverlap] = useState(true)
    const [pendingSubmit, setPendingSubmit] = useState<{
        startTime: number;
        endTime: number;
        duration: number;
    } | null>(null)

    // Get current subject's children
    const currentSubjectData = settings.subjects.find(s => s.name === addSubject)
    const hasSubItems = currentSubjectData?.children && currentSubjectData.children.length > 0

    const isToday = selectedDate === getTodayDate()

    async function loadData() {
        const record = await db.dailyRecords.get(selectedDate)
        setDailyRecord(record || { date: selectedDate, firstVisitCompleted: false })

        const sessions = await db.sessions
            .where('date')
            .equals(selectedDate)
            .toArray()
        // Sort by startTime descending (latest first)
        sessions.sort((a, b) => b.startTime - a.startTime)
        setRecentSessions(sessions)
    }

    useEffect(() => {
        loadData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate])

    const handleUpdateDaily = async (field: keyof DailyRecord, value: string) => {
        const existing = await db.dailyRecords.get(selectedDate)
        if (existing) {
            await db.dailyRecords.update(selectedDate, { [field]: value })
        } else {
            await db.dailyRecords.add({
                date: selectedDate,
                firstVisitCompleted: false,
                [field]: value
            })
        }
        loadData()
    }

    // 평가 입력 7종 비우기 — 폼 전체 리셋과 '평가 없는 세션 선택' 두 경로가 같은 규칙을 쓴다.
    const resetEvalFields = () => {
        setScore(null)
        setSelectedTags([])
        setShowAllTags(false)
        setShowEvalFields(false)
        setCorrect('')
        setTotal('')
        setMemo('')
    }

    const handleResetForm = () => {
        setEditingSessionId(null)
        setAddSubject(settings.subjects[0]?.name || '')
        setAddSubItem(undefined)
        setAddType(settings.types[0])
        setInputHours('')
        setInputMinutes('')
        setInputStartTime('')
        setInputEndTime('')
        resetEvalFields()
    }

    const handleSelectSession = (session: StudySession) => {
        setEditingSessionId(session.id!)
        setAddSubject(session.subject)
        setAddSubItem(session.subItem)
        setAddType(session.type)

        // Set both modes' values
        const totalMinutes = Math.floor(session.duration / 60000)
        setInputHours(Math.floor(totalMinutes / 60).toString() || '')
        setInputMinutes((totalMinutes % 60).toString() || '')

        setInputStartTime(formatTimeHHMM(session.startTime))
        setInputEndTime(formatTimeHHMM(session.endTime))

        // Set evaluation values (신형 score+tags / 구형 focus·satisfaction → getEvalScore로 점수 프리필)
        if (session.evaluation) {
            const evalScore = getEvalScore(session.evaluation)
            setScore(evalScore !== null ? Math.round(evalScore) : null)
            setSelectedTags(session.evaluation.tags ?? [])
            setShowAllTags(false)
            setCorrect(session.evaluation.problemSolving?.correct.toString() || '')
            setTotal(session.evaluation.problemSolving?.total.toString() || '')
            setMemo(session.evaluation.memo || '')
            setShowEvalFields(true)
        } else {
            resetEvalFields()
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        let duration: number
        let startTime: number
        let endTime: number

        if (inputMode === 'duration') {
            const h = parseInt(inputHours) || 0
            const m = parseInt(inputMinutes) || 0
            const totalMins = (h * 60) + m
            if (totalMins <= 0) return

            duration = totalMins * 60000

            if (editingSessionId) {
                const session = recentSessions.find(s => s.id === editingSessionId)
                startTime = session?.startTime || Date.now() - duration
                endTime = startTime + duration
            } else {
                // 새 세션: 기존 세션들의 가장 늦은 종료 시간 이후에 자동 배치
                const latestEnd = await getLatestEndTime(selectedDate)
                if (latestEnd !== null) {
                    startTime = latestEnd + 1000 // 1초 간격
                    endTime = startTime + duration
                } else {
                    // 세션이 없으면 09:00 기준
                    const baseDate = new Date(selectedDate + 'T09:00:00')
                    startTime = baseDate.getTime()
                    endTime = startTime + duration
                }
            }
        } else {
            // Time range mode
            if (!inputStartTime || !inputEndTime) return

            const startOffset = parseHhmm(inputStartTime)
            const endOffset = parseHhmm(inputEndTime)
            if (startOffset === null || endOffset === null) return

            // 자정 기준 오프셋을 '분'으로 넘긴다 — setHours 가 60분 초과분을 시로 올려 주므로
            // 결과는 setHours(시, 분) 과 같고, epoch 덧셈과 달리 서머타임에도 안전하다.
            const atOffset = (offsetMs: number) => {
                const d = new Date(selectedDate + 'T00:00:00')
                d.setHours(0, offsetMs / 60000, 0, 0)
                return d.getTime()
            }

            startTime = atOffset(startOffset)
            endTime = atOffset(endOffset)

            // Handle overnight sessions
            if (endTime <= startTime) {
                endTime += 24 * 60 * 60 * 1000 // Add one day
            }

            duration = endTime - startTime
            if (duration <= 0) return
        }

        // Check for overlapping session (전체 범위 겹침 확인)
        const overlapping = await findOverlappingSession(selectedDate, startTime, editingSessionId ?? undefined, endTime)
        if (overlapping) {
            // timeRange 모드상으로 직접 입력된 세션이면 경고만 표시.
            // 단, 기존 세션이 새 세션보다 늦게 시작했다면 "종료 시간을 앞당기는" 조정이
            // 성립하지 않는다(길이가 음수가 된다) — 그때는 조정을 제안하지 않는다.
            setOverlappingSession(overlapping)
            setCanTrimOverlap(overlapping.startTime < startTime)
            setPendingSubmit({ startTime, endTime, duration })
            setShowOverlapWarning(true)
            return
        }

        await saveSession(startTime, endTime, duration)
    }

    const saveSession = async (startTime: number, endTime: number, duration: number) => {
        // showEvalFields가 true일 때만 evaluation 저장 (건너뛰기 시 미기록)
        const evaluation = showEvalFields ? {
            score: score ?? 7,
            tags: selectedTags,
            ...(correct && total ? {
                problemSolving: {
                    correct: parseInt(correct) || 0,
                    total: parseInt(total) || 0
                }
            } : {}),
            ...(memo.trim() ? { memo: memo.trim() } : {})
        } : undefined

        if (evaluation) recordTagUsage(selectedTags)

        if (editingSessionId) {
            await updateStudySession(editingSessionId, {
                subject: addSubject,
                subItem: addSubItem,
                type: addType,
                startTime,
                endTime,
                duration,
                evaluation
            })
        } else {
            const session: StudySession = {
                date: selectedDate,
                subject: addSubject,
                subItem: addSubItem,
                type: addType,
                startTime,
                endTime,
                duration,
                evaluation
            }
            await db.sessions.add(session)
        }
        maybeSyncToday(false) // throttle 적용 — 수동 편집마다 강제 동기화 불필요

        handleResetForm()
        loadData()
    }

    const handleOverlapConfirm = async () => {
        if (overlappingSession && pendingSubmit) {
            // Adjust the overlapping session's end time to 1ms before the new session starts.
            // 조정이 거절되면(음수 길이가 될 상황) 겹침이 그대로 남으므로 새 세션도 저장하지 않는다.
            const trimmed = await adjustOverlappingSession(overlappingSession.id!, pendingSubmit.startTime - 1)
            if (!trimmed) {
                setCanTrimOverlap(false)
                return
            }
            await saveSession(pendingSubmit.startTime, pendingSubmit.endTime, pendingSubmit.duration)
        }
        setShowOverlapWarning(false)
        setOverlappingSession(null)
        setPendingSubmit(null)
    }

    const handleOverlapCancel = () => {
        setShowOverlapWarning(false)
        setOverlappingSession(null)
        setPendingSubmit(null)
    }

    const handleDelete = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation()
        const confirmed = await showConfirm('기록 삭제', '정말 이 학습 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')
        if (!confirmed) return
        await deleteStudySession(id)
        maybeSyncToday(false) // throttle 적용
        if (editingSessionId === id) handleResetForm()
        loadData()
    }

    const handlePrevDay = () => setSelectedDate(addDays(selectedDate, -1))
    const handleNextDay = () => {
        const next = addDays(selectedDate, 1)
        if (next <= getTodayDate()) setSelectedDate(next)
    }
    const handleToday = () => setSelectedDate(getTodayDate())

    return (
        <motion.div
            className="flex flex-col gap-10"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.default}
        >
            <header>
                <h1 className="text-display text-3xl font-black gradient-text">학습 기록 편집</h1>
                <p className="text-[var(--color-text-secondary)]">일정과 공부 세션을 관리하세요.</p>
            </header>

            {/* Date Navigation */}
            <div className="flex items-center justify-center gap-4">
                <Pressable
                    onClick={handlePrevDay}
                    pressScale={0.9}
                    className="w-10 h-10 rounded-full glass-card-elevated flex items-center justify-center font-bold"
                >
                    <Icon icon="mdi:chevron-left" className="text-2xl" />
                </Pressable>
                <div className="flex flex-col items-center">
                    <span className="text-lg font-bold tabular-nums">{koDate(selectedDate, 'paren')}</span>
                    {!isToday && (
                        <button
                            onClick={handleToday}
                            className="text-xs text-indigo-400 hover:underline mt-1"
                        >
                            오늘로 이동
                        </button>
                    )}
                </div>
                <Pressable
                    onClick={handleNextDay}
                    disabled={isToday}
                    pressScale={0.9}
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${isToday ? 'bg-white/5 opacity-30 cursor-not-allowed' : 'glass-card-elevated'
                        }`}
                >
                    <Icon icon="mdi:chevron-right" className="text-2xl" />
                </Pressable>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Daily Stats & Manual Entry */}
                <div className="flex flex-col gap-8">
                    {/* Daily Schedule Stats */}
                    <section className="glass-card p-6 flex flex-col gap-6">
                        <div className="flex items-center gap-2">
                            <Icon icon="mdi:calendar" className="text-xl text-indigo-400" />
                            <h2 className="text-lg font-bold">{koDate(selectedDate, 'paren')} 일정</h2>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {([
                                { label: '기상 시간', field: 'wakeUpTime', icon: 'mdi:weather-sunset-up', color: 'text-orange-400' },
                                { label: '전날 취침 시간', field: 'bedTime', icon: 'mdi:weather-night', color: 'text-indigo-400' },
                                ...(dailyRecord?.arrivalTime ? [{ label: '등원 시간', field: 'arrivalTime', icon: 'mdi:school-outline', color: 'text-blue-400' }] : []),
                                ...(dailyRecord?.leaveTime ? [{ label: '하원 시간', field: 'leaveTime', icon: 'mdi:door-open', color: 'text-green-400' }] : []),
                            ] as { label: string; field: 'wakeUpTime' | 'bedTime' | 'arrivalTime' | 'leaveTime'; icon: string; color: string }[]).map((item) => (
                                <div key={item.field} className="flex flex-col gap-2">
                                    <label className="text-xs font-bold opacity-60 flex items-center gap-1">
                                        <Icon icon={item.icon} className={`text-lg ${item.color}`} /> {item.label}
                                    </label>
                                    <input
                                        type="time"
                                        value={dailyRecord?.[item.field] || ''}
                                        onChange={(e) => handleUpdateDaily(item.field, e.target.value)}
                                        className={`${FIELD} transition-all`}
                                    />
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Manual Session Entry */}
                    <section className={`glass-card p-6 flex flex-col gap-6 border-indigo-500/20 transition-all ${editingSessionId ? 'bg-indigo-500/10 ring-2 ring-indigo-500/50 scale-[1.02]' : 'bg-gradient-to-br from-indigo-500/5 to-purple-500/5'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Icon icon={editingSessionId ? "mdi:pencil-outline" : "mdi:pencil-plus-outline"} className="text-xl" />
                                <h2 className="text-lg font-bold">{editingSessionId ? '기록 수정하기' : '공부 기록 추가'}</h2>
                            </div>
                            {editingSessionId && (
                                <button onClick={handleResetForm} className="text-xs font-bold text-indigo-500 hover:underline">취소</button>
                            )}
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-3">
                                <select
                                    value={addSubject}
                                    onChange={(e) => {
                                        setAddSubject(e.target.value)
                                        setAddSubItem(undefined)
                                    }}
                                    className={FIELD}
                                >
                                    {settings.subjects.map(s => <option key={s.name} value={s.name} className="bg-slate-900">{s.name}</option>)}
                                </select>
                                <select
                                    value={addType}
                                    onChange={(e) => setAddType(e.target.value)}
                                    className={FIELD}
                                >
                                    {settings.types.map(t => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
                                </select>
                            </div>

                            {/* Sub-item dropdown */}
                            {hasSubItems && (
                                <select
                                    value={addSubItem || ''}
                                    onChange={(e) => setAddSubItem(e.target.value || undefined)}
                                    className={FIELD}
                                >
                                    <option value="" className="bg-slate-900">전체 (하위 항목 없음)</option>
                                    {currentSubjectData?.children?.map(child => (
                                        <option key={child} value={child} className="bg-slate-900">{child}</option>
                                    ))}
                                </select>
                            )}

                            {/* Input Mode Toggle — Segmented control */}
                            <div className="relative flex gap-1 p-1 bg-black/[0.04] dark:bg-white/5 rounded-xl">
                                {([
                                    { key: 'duration' as const, icon: 'mdi:timer-outline', label: '시간 입력' },
                                    { key: 'timeRange' as const, icon: 'mdi:clock-outline', label: '시작~끝 입력' },
                                ]).map(m => {
                                    const active = inputMode === m.key
                                    return (
                                        <button
                                            key={m.key}
                                            type="button"
                                            onClick={() => setInputMode(m.key)}
                                            className={`relative flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${active ? 'text-white' : 'text-[var(--color-text-secondary)]'}`}
                                        >
                                            {active && (
                                                <motion.div
                                                    layoutId="inputModeIndicator"
                                                    transition={spring.default}
                                                    className="absolute inset-0 z-0 rounded-lg bg-indigo-500 shadow-lg"
                                                />
                                            )}
                                            <span className="relative z-10 flex items-center justify-center gap-1"><Icon icon={m.icon} className="text-lg" /> {m.label}</span>
                                        </button>
                                    )
                                })}
                            </div>

                            {/* Duration Mode */}
                            {inputMode === 'duration' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="relative">
                                        <input
                                            type="number"
                                            placeholder="0"
                                            value={inputHours}
                                            onChange={(e) => setInputHours(e.target.value)}
                                            className={`w-full ${FIELD} pr-10`}
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs opacity-40 font-bold">시</span>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            placeholder="0"
                                            value={inputMinutes}
                                            onChange={(e) => setInputMinutes(e.target.value)}
                                            className={`w-full ${FIELD} pr-10`}
                                        />
                                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs opacity-40 font-bold">분</span>
                                    </div>
                                </div>
                            )}

                            {/* Time Range Mode */}
                            {inputMode === 'timeRange' && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs opacity-40 font-bold">시작 시간</label>
                                        <input
                                            type="time"
                                            value={inputStartTime}
                                            onChange={(e) => setInputStartTime(e.target.value)}
                                            className={FIELD}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs opacity-40 font-bold">종료 시간</label>
                                        <input
                                            type="time"
                                            value={inputEndTime}
                                            onChange={(e) => setInputEndTime(e.target.value)}
                                            className={FIELD}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Evaluation Section Toggle */}
                            <div className="pt-2 border-t border-white/5 space-y-4">
                                <button
                                    type="button"
                                    onClick={() => setShowEvalFields(!showEvalFields)}
                                    className="flex items-center justify-between w-full group"
                                >
                                    <div className="flex items-center gap-2">
                                        <Icon icon="mdi:sparkles" className="text-lg text-amber-400" />
                                        <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-widest group-hover:text-[var(--color-text)] transition-colors">평가 정보 {showEvalFields ? '숨기기' : '추가하기'}</span>
                                    </div>
                                    <span className={`text-[10px] font-black text-[var(--color-text-secondary)] transition-transform ${showEvalFields ? 'rotate-180' : ''}`}>▼</span>
                                </button>

                                <AnimatePresence>
                                    {showEvalFields && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="overflow-hidden space-y-6"
                                        >
                                            {/* Score 1-10 (단일 점수) */}
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">세션 점수</span>
                                                    <span className="text-sm font-black text-[var(--color-text)]">
                                                        {score === null ? (
                                                            <span className="text-[var(--color-text-secondary)] font-bold">미선택 (건너뛰면 7)</span>
                                                        ) : `${score}/10`}
                                                    </span>
                                                </div>
                                                <div className="flex gap-1 h-10">
                                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                                                        const active = score !== null && n <= score
                                                        return (
                                                            <button
                                                                key={n}
                                                                type="button"
                                                                onClick={() => setScore(n)}
                                                                className={`flex-1 rounded-lg text-xs font-black transition-all ${active
                                                                    ? 'bg-indigo-500 text-white shadow-md scale-[1.04] z-10'
                                                                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-indigo-500/10'
                                                                    }`}
                                                            >
                                                                {n}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>

                                            {/* Tag Chips */}
                                            <div className="space-y-3">
                                                <span className="text-[10px] font-black text-[var(--color-text-secondary)] uppercase tracking-widest pl-1">태그</span>
                                                <div className="flex flex-wrap gap-2">
                                                    {topTags.map(tag => (
                                                        <Chip
                                                            key={tag.name}
                                                            active={selectedTags.includes(tag.name)}
                                                            onClick={() => toggleTag(tag.name)}
                                                        >
                                                            {tag.name}
                                                        </Chip>
                                                    ))}
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAllTags(v => !v)}
                                                        className="px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-indigo-500/10 transition-all"
                                                    >
                                                        {showAllTags ? '접기' : '더보기'}
                                                    </button>
                                                </div>

                                                <AnimatePresence>
                                                    {showAllTags && (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            className="space-y-3 overflow-hidden pt-1"
                                                        >
                                                            {allTagsByCategory.map(([cat, tags]) => (
                                                                <div key={cat} className="space-y-1.5">
                                                                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-secondary)]">{TAG_CATEGORY_LABELS[cat]}</p>
                                                                    {/* 여기 칩은 선택 시 그림자가 없다 — ui/Chip 의 indigo 활성 톤과 다르므로 그대로 둔다. */}
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {tags.map(tag => (
                                                                            <button
                                                                                key={tag.name}
                                                                                type="button"
                                                                                onClick={() => toggleTag(tag.name)}
                                                                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${selectedTags.includes(tag.name)
                                                                                    ? 'bg-indigo-500 text-white'
                                                                                    : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-indigo-500/10'
                                                                                    }`}
                                                                            >
                                                                                {tag.name}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>

                                            {/* Problem Solving */}
                                            <div className="flex items-center gap-3 bg-[var(--color-surface)] p-2 rounded-2xl border border-[var(--color-border)]">
                                                <span className="text-xs font-bold text-[var(--color-text-secondary)] pl-2">문제</span>
                                                <input
                                                    type="number"
                                                    value={correct}
                                                    onChange={(e) => setCorrect(e.target.value)}
                                                    placeholder="맞힌 수"
                                                    className="w-full bg-transparent text-center font-bold text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/30 outline-none"
                                                />
                                                <span className="text-[var(--color-text-secondary)]/20 font-black">/</span>
                                                <input
                                                    type="number"
                                                    value={total}
                                                    onChange={(e) => setTotal(e.target.value)}
                                                    placeholder="전체"
                                                    className="w-full bg-transparent text-center font-bold text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/30 outline-none"
                                                />
                                            </div>

                                            {/* Memo */}
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-[var(--color-text-secondary)] uppercase tracking-widest pl-1">메모</label>
                                                <textarea
                                                    value={memo}
                                                    onChange={(e) => setMemo(e.target.value)}
                                                    placeholder="간단한 소감..."
                                                    rows={2}
                                                    className="w-full px-4 py-3 rounded-2xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/30 resize-none outline-none focus:border-[var(--color-primary)] transition-all"
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>


                            <Pressable type="submit" pressScale={0.98} className={`w-full py-3.5 rounded-xl text-white font-bold text-sm transition-colors shadow-lg shadow-indigo-500/25 ${editingSessionId ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-indigo-500 hover:bg-indigo-400'}`}>
                                {editingSessionId ? '기록 수정 완료' : '기록 추가하기'}
                            </Pressable>
                        </form>
                    </section>
                </div>

                {/* Right Column: Recent Sessions List */}
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Icon icon="mdi:script-text-outline" className="text-xl text-indigo-400" />
                            <h2 className="text-lg font-bold">{koDate(selectedDate, 'paren')} 세션</h2>
                        </div>
                        <span className="text-[10px] font-bold opacity-40 uppercase tracking-widest">{recentSessions.length} sessions</span>
                    </div>

                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 no-scrollbar">
                        <p className="text-[10px] text-indigo-500 font-bold opacity-60 text-center tracking-tight flex items-center justify-center gap-1"><Icon icon="mdi:lightbulb-on-outline" className="text-lg" /> 내역을 클릭하면 수정, 왼쪽으로 밀면 삭제할 수 있습니다.</p>
                        <AnimatePresence mode="popLayout">
                            {recentSessions.map((session, i) => (
                                <div key={session.id} className="relative overflow-hidden rounded-[2rem]">
                                    {/* Delete Button */}
                                    <div
                                        className="absolute inset-y-2 right-2 w-[80px] bg-red-500 flex items-center justify-center rounded-2xl shadow-inner"
                                        onPointerDown={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={(e) => handleDelete(e, session.id!)}
                                            className="text-white font-black flex flex-col items-center gap-1 active:scale-90 transition-transform w-full h-full justify-center"
                                        >
                                            <Icon icon="mdi:trash-can-outline" className="text-2xl" />
                                            <span className="text-[10px] uppercase tracking-tighter">Delete</span>
                                        </button>
                                    </div>

                                    {/* Session Card */}
                                    <motion.div
                                        drag="x"
                                        dragConstraints={{ left: -100, right: 0 }}
                                        dragElastic={0.05}
                                        dragMomentum={false}
                                        layout
                                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, x: -100 }}
                                        whileTap={{ scale: 0.98 }}
                                        transition={{
                                            ...spring.default,
                                            opacity: { ...spring.default, delay: Math.min(i, 5) * 0.05 },
                                            y: { ...spring.default, delay: Math.min(i, 5) * 0.05 },
                                            layout: spring.snappy,
                                        }}
                                        onClick={() => handleSelectSession(session)}
                                        className={`relative glass-card-solid p-4 flex items-center justify-between group cursor-pointer transition-colors hover:border-indigo-500/50 ${editingSessionId === session.id ? 'ring-2 ring-indigo-500 border-transparent shadow-xl' : ''}`}
                                    >
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold">{session.subject}</span>
                                                {session.subItem && <span className="text-[10px] text-indigo-400 font-medium">› {session.subItem}</span>}
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 opacity-60 font-medium">{session.type}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs opacity-60 tabular-nums">
                                                <span className="font-medium text-indigo-400">{formatTimeHHMM(session.startTime)}</span>
                                                <span>~</span>
                                                <span className="font-medium text-indigo-400">{formatTimeHHMM(session.endTime)}</span>
                                                <span className="opacity-40">|</span>
                                                <span>{formatDuration(session.duration)}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="w-1 h-8 bg-white/5 rounded-full group-hover:bg-indigo-500/20 transition-colors"></div>
                                            <span className="text-xl opacity-20 group-hover:opacity-40 transition-opacity">‹</span>
                                        </div>
                                    </motion.div>
                                </div>
                            ))}
                        </AnimatePresence>

                        {recentSessions.length === 0 && (
                            <div className="text-center py-20 bg-white/5 rounded-[2rem] border border-dashed border-white/10">
                                <p className="text-sm opacity-30 italic">{koDate(selectedDate, 'paren')} 기록된 세션이 없습니다.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Overlap Warning Modal */}
            <Modal
                open={showOverlapWarning && !!overlappingSession}
                onClose={handleOverlapCancel}
                width="max-w-md"
                className="p-10 flex flex-col gap-6"
                scrim="bg-black/40 backdrop-blur-xl"
                ariaLabel="세션 시간 중복"
            >
                {overlappingSession && (<>
                    <div className="flex items-center gap-3">
                        <Icon icon="mdi:alert" className="text-3xl text-amber-500" />
                        <h3 className="text-xl font-bold">세션 시간 중복</h3>
                    </div>

                    <div className="bg-white/5 rounded-xl p-4 space-y-2">
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            선택한 시간에 이미 다음 세션이 존재합니다:
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="font-bold">{overlappingSession.subject}</span>
                            {overlappingSession.subItem && (
                                <span className="text-indigo-400 text-sm">› {overlappingSession.subItem}</span>
                            )}
                        </div>
                        <div className="text-sm text-[var(--color-text-secondary)]">
                            {formatTimeHHMM(overlappingSession.startTime)} ~ {formatTimeHHMM(overlappingSession.endTime)}
                        </div>
                    </div>

                    <p className="text-sm text-[var(--color-text-secondary)]">
                        {canTrimOverlap
                            ? '계속하면 기존 세션의 종료 시간이 새 세션 시작 시간 직전으로 자동 조정됩니다.'
                            : '기존 세션이 새 세션보다 늦게 시작하므로 종료 시간을 앞당겨 겹침을 풀 수 없습니다. 새 세션의 시간을 바꾸거나, 기존 세션을 먼저 수정·삭제해 주세요.'}
                    </p>

                    <div className="flex gap-3 mt-4">
                        <button
                            onClick={handleOverlapCancel}
                            className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] font-bold transition-all active:scale-95"
                        >
                            {canTrimOverlap ? '취소' : '닫기'}
                        </button>
                        {canTrimOverlap && (
                            <button
                                onClick={handleOverlapConfirm}
                                className="flex-1 py-4 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black shadow-xl active:scale-95 transition-all"
                            >
                                조정하고 추가
                            </button>
                        )}
                    </div>
                </>)}
            </Modal>
        </motion.div>
    )
}
