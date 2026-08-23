import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import Pressable from '../components/ui/Pressable'
import SlidingSelector from '../components/ui/SlidingSelector'
import Chip from '../components/ui/Chip'
import { Stat } from '../components/ui/Stat'
import { spring, fadeRise, materialize } from '../lib/motion'
import { hm, hms, hmsDecimal, ymd, toDate, addDays } from '../lib/format'
import { groupTotals, sumDuration, sumTotals, isSelfStudy } from '../lib/sessions'
import { useStudyTimer } from '../lib/useStudyTimer'
import type { Settings, StudySession, SessionEvaluation, ThoughtNote } from '../lib/db'
import { db, getTodayDate, getDateFromTimestamp, getSessionsOn, getMonday, getSunday, getStudyToday, addThoughtNote } from '../lib/db'
import TestTimerModal from '../components/TestTimerModal'
import RoomPanel from '../components/RoomPanel'
import { useSessionEvents } from '../lib/ha/useSessionEvents'
import SessionEvalModal from '../components/SessionEvalModal'
import ThoughtParkingDrawer from '../components/ThoughtParkingDrawer'
import FocusPanel from '../components/focus/FocusPanel'
import { NativeBridge } from '../lib/NativeBridge'
import { HelpButton } from '../components/HelpButton'
import { maybeSyncToday } from '../lib/telemetry'
import { playTimerEndSound } from '../lib/alarm'
import { consumeSessionDrowsyCount } from '../lib/drowsyCounter'

interface StudyProps {
    settings: Settings
}

/** 오늘 화면에 띄우는 네 가지 누적치 — 항상 한 번의 조회에서 함께 나온다. */
interface TodayTotals {
    all: number
    subject: number
    subjectType: number
    selfStudy: number
}

interface WeeklyStats {
    bySubject: Array<{ subject: string; total: number }>
    total: number
    /** 지난주 대비 증감 (ms) */
    change: number
}

const ZERO_TOTALS: TodayTotals = { all: 0, subject: 0, subjectType: 0, selfStudy: 0 }
const ZERO_WEEK: WeeklyStats = { bySubject: [], total: 0, change: 0 }

export default function Study({ settings }: StudyProps) {
    const navigate = useNavigate()
    const { state } = useLocation()

    /** 알림의 종료 버튼 → handleEnd. 훅보다 뒤에 정의되므로 ref 를 거친다. */
    const endRef = useRef<() => void>(() => {})
    const timer = useStudyTimer(
        {
            subject: state?.subject || settings.subjects[0]?.name || '',
            subItem: state?.subItem,
            type: state?.type || settings.types[0],
            countdownMs: state?.countdownDuration,
        },
        () => endRef.current(),
    )
    const { subject, subItem, type, countdownMs } = timer.session

    const [totals, setTotals] = useState<TodayTotals>(ZERO_TOTALS)
    const [weekly, setWeekly] = useState<WeeklyStats>(ZERO_WEEK)

    const [showTestTimer, setShowTestTimer] = useState(false)
    const [showCountdownDone, setShowCountdownDone] = useState(false)
    const [showEvalModal, setShowEvalModal] = useState(false)
    const [isEnding, setIsEnding] = useState(false)
    const [lastSession, setLastSession] = useState<{ id: number; duration: number } | null>(null)
    const [showParking, setShowParking] = useState(false)
    const [parkedNotes, setParkedNotes] = useState<ThoughtNote[]>([])
    /** 방 패널이 실제로 떠 있는지 (집일 때만 true) */
    const [roomAvailable, setRoomAvailable] = useState(false)
    /** 카메라 파이프라인이 무거우므로 펼칠 때만 마운트한다 */
    const [focusOpen, setFocusOpen] = useState(false)

    const savingRef = useRef(false)
    const endingRef = useRef(false)
    const sendSessionEvent = useSessionEvents(settings.haConfig)

    const children = settings.subjects.find((s) => s.name === subject)?.children ?? []

    // ── 집계 ────────────────────────────────────────────────────────────────
    // 네 가지 누적치가 모두 "오늘의 세션들"에서 나오므로 조회는 한 번이면 된다.
    const refreshTotals = useCallback(async (subj: string, ty: string) => {
        const sessions = await getSessionsOn()
        setTotals({
            all: sumDuration(sessions),
            subject: groupTotals(sessions, (s) => s.subject).get(subj)?.total ?? 0,
            subjectType: sumDuration(sessions.filter((s) => s.subject === subj && s.type === ty)),
            selfStudy: sumTotals(sessions).selfStudy,
        })

        const monday = getMonday(getStudyToday())
        const week = (from: Date) =>
            db.sessions.where('date').between(ymd(from), ymd(getSunday(from)), true, true).toArray()
        const [thisWeek, lastWeek] = await Promise.all([week(monday), week(toDate(addDays(monday, -7)))])
        setWeekly({
            bySubject: Array.from(groupTotals(thisWeek, (s) => s.subject), ([s, t]) => ({ subject: s, total: t.total })),
            total: sumDuration(thisWeek),
            change: sumDuration(thisWeek) - sumDuration(lastWeek),
        })
    }, [])

    useEffect(() => {
        if (timer.ready) refreshTotals(subject, type)
        // 복원이 끝난 시점의 과목·유형으로 한 번만 채운다. 이후 갱신은 전환 핸들러가 한다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timer.ready])

    // ── 몰입형 모드 ─────────────────────────────────────────────────────────
    useEffect(() => {
        NativeBridge.hideStatusBar()
        return () => { NativeBridge.showStatusBar() }
    }, [])

    // ── 카운트다운 종료 ─────────────────────────────────────────────────────
    // 울렸는지를 세션 시작 시각으로 래치한다. 모달의 표시 여부로 막으면 "확인"을
    // 누르는 순간 조건이 되살아나 팝업과 종료음이 곧바로 되돌아왔다. 시작 시각을
    // 쓰면 다음 테스트(restart)에서는 값이 달라져 제대로 다시 울린다.
    const countdownFiredAt = useRef<number | null>(null)
    useEffect(() => {
        if (!countdownMs || timer.elapsed < countdownMs) return
        if (countdownFiredAt.current === timer.startedAt.current) return
        countdownFiredAt.current = timer.startedAt.current
        setShowCountdownDone(true)
        // 미디어 볼륨으로 재생되어 벨소리/진동 모드와 무관하게 들리고, 이어폰이 있으면 그쪽으로 간다.
        playTimerEndSound()
    }, [countdownMs, timer.elapsed, timer.startedAt])

    // ── Now Bar (Android 알림) ──────────────────────────────────────────────
    const nowBarStarted = useRef(false)
    useEffect(() => {
        if (!timer.ready || !NativeBridge.isNative()) return
        if (isEnding) {
            NativeBridge.stopNowBar()
            nowBarStarted.current = false
            return
        }
        ;(async () => {
            // Java 쪽에서 더할 필요가 없도록 현재 세션까지 포함한 합산값을 넘긴다.
            const sessions = await getSessionsOn()
            const elapsed = timer.elapsedNow()
            const total = sumDuration(sessions) + elapsed
            const bySubject = (groupTotals(sessions, (s) => s.subject).get(subject)?.total ?? 0) + elapsed
            const base = Date.now() - elapsed
            if (nowBarStarted.current) {
                NativeBridge.updateNowBar(subject, base, timer.isRunning, total, bySubject, countdownMs ?? 0)
            } else if (await NativeBridge.requestNotificationPermission()) {
                NativeBridge.startNowBar(subject, base, timer.isRunning, total, bySubject, countdownMs ?? 0)
                nowBarStarted.current = true
            }
        })()
    }, [subject, type, subItem, countdownMs, timer.isRunning, timer.ready, timer.elapsedNow, isEnding])

    // ── HA 세션 이벤트 ──────────────────────────────────────────────────────
    // 시작은 1회, 이후엔 값이 실제로 바뀐 것만 알린다 (불필요한 요청 방지).
    const haSent = useRef<{ running: boolean; subject: string } | null>(null)
    useEffect(() => {
        if (!timer.ready) return
        const payload = { subject, type, subItem, countdownMs: countdownMs ?? 0 }
        const prev = haSent.current
        haSent.current = { running: timer.isRunning, subject }
        if (!prev) return sendSessionEvent('start', payload)
        if (prev.running !== timer.isRunning) sendSessionEvent(timer.isRunning ? 'resume' : 'pause', payload)
        if (prev.subject !== subject) sendSessionEvent('subject_change', payload)
    }, [timer.ready, timer.isRunning, subject, type, subItem, countdownMs, sendSessionEvent])

    // ── 세션 저장 ───────────────────────────────────────────────────────────

    /** 1초 미만이거나 이미 저장 중이면 건너뛴다. 반환값은 새 세션 id. */
    const saveSession = async (withEval = false): Promise<number | null> => {
        const duration = timer.elapsedNow()
        if (duration < 1000 || savingRef.current) return null
        savingRef.current = true
        if (withEval) setIsEnding(true)
        try {
            const drowsyCount = consumeSessionDrowsyCount()
            const session: StudySession = {
                // 날짜는 시작 시각에 귀속시킨다 — 자정을 넘겨도 하루가 쪼개지지 않는다.
                date: getDateFromTimestamp(timer.startedAt.current),
                subject, subItem, type,
                startTime: timer.startedAt.current,
                endTime: timer.endedAt(),
                duration,
                ...(drowsyCount > 0 ? { drowsyCount } : {}),
            }
            const id = (await db.sessions.add(session)) as number
            timer.clear()
            if (withEval) {
                setLastSession({ id, duration })
                timer.finish()
            } else {
                // 평가를 받을 때는 평가 저장 시점에 force sync 가 따로 돈다.
                maybeSyncToday(false)
            }
            return id
        } finally {
            savingRef.current = false
        }
    }

    /** 저장 → 새 세션 시작 → 누적치 갱신. 모든 전환이 이 한 경로를 탄다. */
    const switchTo = async (next: Partial<typeof timer.session>) => {
        await saveSession()
        timer.restart(next)
        await refreshTotals(next.subject ?? subject, next.type ?? type)
    }

    const handleEnd = async () => {
        // 상태가 아니라 ref 로 막는다 — 리렌더 전에 두 번 눌려도 한 번만 통과해야 한다.
        if (endingRef.current) return
        endingRef.current = true
        setIsEnding(true)
        NativeBridge.stopNowBar()
        sendSessionEvent('end', { subject, type, subItem, countdownMs: countdownMs ?? 0, elapsedMs: timer.elapsed })
        if (await saveSession(true)) setShowEvalModal(true)
        else navigate('/') // 저장할 게 없으면(1초 미만) 모달 없이 이탈
    }
    endRef.current = handleEnd

    const closeEval = async (evaluation?: SessionEvaluation) => {
        if (evaluation && lastSession) await db.sessions.update(lastSession.id, { evaluation })
        maybeSyncToday(true) // 평가를 건너뛰어도 세션 기록은 동기화한다
        setShowEvalModal(false)
        navigate('/')
    }

    const saveSubjectPreset = useCallback(async (name: string, colorTempK: number) => {
        if (settings.id == null) return
        await db.settings.update(settings.id, {
            subjects: settings.subjects.map((s) =>
                s.name === name ? { ...s, lightPreset: { ...s.lightPreset, colorTempK } } : s,
            ),
        })
    }, [settings.id, settings.subjects])

    const elapsed = timer.elapsed

    return (
        <div className="sm-study true-black h-[100dvh] min-h-[100dvh] bg-black text-white flex flex-col justify-between safe-area-bottom p-6 md:p-12 overflow-y-auto">
            {/* 아이패드 가로모드(4:3 ≈ 1.33)에서도 스톱워치·재생/일시정지 버튼이 절대 잘리지 않도록
                하는 컴팩트 레이아웃. 갤럭시탭 16:10(1.6)은 대상에서 확실히 제외해 기존(넓은) 모습을
                유지한다 — 임계값을 11/8(1.375)로 두어, 브라우저 크롬으로 가로폭이 줄어 비율이 다소
                낮아지는 갤럭시탭(≈1.475)까지도 제외되게 한다. overflow-y-auto는 어떤 경우에도(고급
                모드 등으로 콘텐츠가 늘어나도) 콘텐츠가 화면 밖으로 사라지지 않게 하는 안전망이다. */}
            <style>{`
                @media (orientation: landscape) and (max-height: 900px) and (max-aspect-ratio: 11/8) {
                    .sm-study { padding: 0.75rem 1.25rem !important; }
                    .sm-header { gap: 0.5rem !important; }
                    .sm-selectors { padding-bottom: 0.5rem !important; }
                    .sm-subitem { padding: 0.5rem !important; }
                    .sm-main { justify-content: flex-start !important; }
                    .sm-timer-block { gap: 0.35rem !important; }
                    .sm-subject-label { font-size: 0.7rem !important; }
                    .sm-timer-num { font-size: clamp(2.5rem, 11vh, 6rem) !important; }
                    .sm-metric-grid { margin-top: 0.5rem !important; gap: 0.375rem !important; }
                    .sm-metric-card { padding: 0.375rem !important; }
                    .sm-metric-value { font-size: 0.95rem !important; }
                    .sm-goal { margin-top: 0.375rem !important; }
                    .sm-focus-wrap { margin-top: 0.5rem !important; }
                    .sm-controls { margin-top: 0.5rem !important; gap: 1.5rem !important; }
                    .sm-play-btn { width: 4.5rem !important; height: 4.5rem !important; }
                    .sm-parking-btn { width: 2.75rem !important; height: 2.75rem !important; }
                    .sm-spacer { width: 2.75rem !important; height: 2.75rem !important; }
                    .sm-footer { height: 3rem !important; padding: 0 1rem !important; gap: 0.75rem !important; border-radius: 1.25rem !important; }
                    .sm-footer-chips { display: none !important; }
                }
            `}</style>

            <header className="sm-header flex flex-col gap-6 animate-fade-in">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.6)]"></div>
                        <span className="text-sm font-black uppercase tracking-widest opacity-60">Focusing Now</span>
                    </div>
                    <Pressable onClick={handleEnd} pressScale={0.95} className="px-5 py-2 rounded-full bg-white/10 font-bold text-sm">Exit Session</Pressable>
                </div>

                <div className="sm-selectors flex gap-4 overflow-x-auto pb-6 no-scrollbar">
                    <SlidingSelector
                        items={settings.subjects.map((s) => s.name)}
                        currentValue={subject}
                        onChange={(next) => switchTo({ subject: next, subItem: undefined })}
                        activeColor="bg-white/40"
                        activeTextColor="text-white"
                        layoutId="subject-pill"
                    />
                    <SlidingSelector
                        items={settings.types}
                        currentValue={type}
                        onChange={(next) =>
                            // 테스트는 시간을 먼저 정해야 하므로 모달을 거친다.
                            next === '테스트' ? setShowTestTimer(true) : switchTo({ type: next, countdownMs: undefined })
                        }
                        activeColor="bg-indigo-500/50"
                        activeTextColor="text-white"
                        layoutId="type-pill"
                    />
                </div>

                {children.length > 0 && (
                    <div className="sm-subitem flex flex-col gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 animate-fade-in shadow-inner">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Select Sub-Item</p>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {[undefined, ...children].map((child) => (
                                <Chip
                                    key={child ?? '전체'}
                                    tone="purple"
                                    active={subItem === child}
                                    onClick={() => child !== subItem && switchTo({ subItem: child })}
                                >
                                    {child ?? '전체'}
                                </Chip>
                            ))}
                        </div>
                    </div>
                )}
            </header>

            <main className="sm-main flex-1 flex flex-col items-center justify-center relative z-0">
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 via-transparent to-transparent blur-[120px] pointer-events-none -z-10"></div>

                <motion.div className="sm-timer-block relative text-center flex flex-col gap-4" variants={fadeRise} initial="initial" animate="animate">
                    <div className="flex items-center justify-center gap-2">
                        <h2 className="sm-subject-label text-xl font-bold opacity-40 uppercase tracking-[0.3em]">
                            {subject}{subItem ? ` › ${subItem}` : ''} · {type}
                        </h2>
                        <HelpButton dark title="타이머 표시 안내" items={[
                            { description: '큰 숫자는 오늘 총 공부 시간 + 현재 세션 시간을 합산하여 실시간으로 표시합니다.' },
                            { title: '과목·타입 전환', description: '상단 버튼으로 과목이나 학습 유형을 바꾸면 현재 세션이 저장되고 새 세션이 시작됩니다.' },
                            { title: '일시정지', description: '아래 일시정지 버튼을 누르면 타이머가 멈추고 공부 시간에 포함되지 않습니다.' },
                            { title: '테스트 타입 선택 시', description: '시간을 설정하면 카운트다운 타이머로 전환됩니다. 시간이 끝나면 알림이 표시됩니다.' },
                        ]} />
                    </div>

                    {countdownMs ? (
                        <div className="flex flex-col items-center gap-2">
                            <span className="sm-timer-num text-display text-8xl md:text-[10rem] font-black tabular-nums text-red-500 drop-shadow-[0_0_50px_rgba(239,68,68,0.3)]">
                                {hms(Math.max(0, countdownMs - elapsed))}
                            </span>
                            <div className="flex items-center gap-2 opacity-40">
                                <span className="text-xs font-bold uppercase tracking-widest">Total: {hmsDecimal(totals.all + elapsed)}</span>
                            </div>
                        </div>
                    ) : (
                        <span className="sm-timer-num text-display text-8xl md:text-[10rem] font-black tabular-nums gradient-text drop-shadow-2xl">
                            {hmsDecimal(totals.all + elapsed)}
                        </span>
                    )}

                    <div className="sm-metric-grid grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 w-full max-w-3xl mx-auto">
                        <Stat
                            label={`${subject} 누적`}
                            value={hms(totals.subject + elapsed)}
                            help={<HelpButton dark title={`${subject} 오늘 누적`} items={`오늘 "${subject}" 과목에서 모든 타입(강의·자습·테스트 등)으로 공부한 총 시간입니다. 과목을 전환해도 이전 세션 시간이 합산됩니다.`} />}
                        />
                        <Stat
                            label={`${subject}+${type}`}
                            value={hms(totals.subjectType + elapsed)}
                            color="text-indigo-300"
                            help={<HelpButton dark title="과목+타입 누적" items={`오늘 "${subject}" 과목에서 "${type}" 타입으로만 공부한 시간입니다. 예: 수학 강의만, 영어 자습만 따로 보고 싶을 때 유용합니다.`} />}
                        />
                        <Stat
                            label="현재 세션"
                            value={hms(elapsed)}
                            color="text-cyan-400"
                            help={<HelpButton dark title="현재 세션 시간" items="이번 공부 시작 버튼을 누른 순간부터 지금까지의 경과 시간입니다. 타입이나 과목을 전환하면 세션이 분리되어 다시 0부터 시작합니다." />}
                        />
                        <Stat
                            label="순공 (자습)"
                            value={hms(totals.selfStudy + (isSelfStudy(type) ? elapsed : 0))}
                            color="text-purple-400"
                            help={<HelpButton dark title="순공 시간이란?" items={[
                                { description: '자습·테스트 타입 세션만 합산한 시간입니다. 강의 수강 시간은 포함되지 않습니다.' },
                                { title: '왜 따로 보나요?', description: '수동적인 강의 시청과 능동적인 자습·문제풀이를 구분하여, 실제 스스로 공부한 시간을 파악하기 위함입니다.' },
                            ]} />}
                        />
                    </div>
                </motion.div>

                {settings.dailyGoalMs != null && settings.dailyGoalMs > 0 && (
                    <DailyGoalBar done={totals.all + elapsed} goal={settings.dailyGoalMs} />
                )}

                {/* 집(로컬 HA 도달)일 때만 마운트된다 */}
                <RoomPanel
                    config={settings.haConfig}
                    currentSubject={subject}
                    subjects={settings.subjects}
                    onSaveSubjectPreset={saveSubjectPreset}
                    focusOpen={focusOpen}
                    onToggleFocus={() => setFocusOpen((v) => !v)}
                    onAvailabilityChange={setRoomAvailable}
                />

                {/* 방 패널이 없을 때(집 밖)에도 집중력 모니터를 펼칠 수단은 남겨둔다 */}
                {!roomAvailable && (
                    <button
                        onClick={() => setFocusOpen((v) => !v)}
                        aria-expanded={focusOpen}
                        className="mt-6 w-full max-w-3xl mx-auto flex items-center justify-between px-5 py-3 rounded-2xl border border-white/10 bg-white/[0.04]"
                    >
                        <span className="flex items-center gap-2">
                            <Icon icon="mdi:eye-outline" className="text-[16px] opacity-40" />
                            <span className="text-[12px] font-bold opacity-50">집중력 모니터</span>
                        </span>
                        <span className="flex items-center gap-1 text-[12px] font-bold opacity-40">
                            {focusOpen ? '접기' : '펼치기'}
                            <motion.span animate={{ rotate: focusOpen ? 180 : 0 }} transition={spring.snappy} className="flex">
                                <Icon icon="mdi:chevron-down" className="text-[15px]" />
                            </motion.span>
                        </span>
                    </button>
                )}

                {focusOpen && (
                    <div className="sm-focus-wrap">
                        <FocusPanel drowsinessThresholdSec={settings.drowsinessThresholdSec ?? 15} />
                    </div>
                )}

                <div className="sm-controls mt-16 flex items-center justify-center gap-10">
                    <div className="sm-parking flex flex-col items-center gap-1">
                        <Pressable onClick={() => setShowParking(true)} pressScale={0.9} className="flex flex-col items-center gap-0.5 group">
                            <div className="sm-parking-btn w-16 h-16 rounded-2xl bg-white/[0.08] hover:bg-blue-500/20 border border-white/10 hover:border-blue-400/40 flex flex-col items-center justify-center gap-0.5 transition-colors">
                                <span className="text-xl font-black text-blue-400 leading-none">P</span>
                                {parkedNotes.length > 0 && (
                                    <span className="text-[10px] font-black text-blue-300 leading-none">{parkedNotes.length}</span>
                                )}
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-wider opacity-30 group-hover:opacity-50">주차장</span>
                        </Pressable>
                        <HelpButton dark title="생각 주차장 (P)" items={[
                            { description: '공부 중 갑자기 떠오른 관련 없는 생각(할 일, 아이디어 등)을 빠르게 기록해 두는 공간입니다.' },
                            { title: '왜 쓰나요?', description: '생각을 직접 메모 앱으로 전환하면 집중이 깨집니다. 주차장에 버려두면 잊어버릴 걱정 없이 공부에 바로 복귀할 수 있습니다.' },
                            { title: '나중에 확인', description: '세션 평가 화면에서 주차된 생각을 한꺼번에 확인하고 처리할 수 있습니다.' },
                        ]} />
                    </div>

                    <Pressable
                        onClick={timer.toggle}
                        pressScale={0.9}
                        hoverLift
                        aria-label={timer.isRunning ? '일시정지' : '재개'}
                        className={`sm-play-btn w-28 h-28 rounded-full flex items-center justify-center shadow-2xl cursor-pointer transition-colors ${timer.isRunning ? 'bg-yellow-400' : 'bg-green-500'}`}
                    >
                        {timer.isRunning ? (
                            <div className="flex gap-2 pointer-events-none">
                                <div className="w-3 h-10 bg-black rounded-sm"></div>
                                <div className="w-3 h-10 bg-black rounded-sm"></div>
                            </div>
                        ) : (
                            <div className="w-0 h-0 border-l-[24px] border-l-white border-t-[16px] border-t-transparent border-b-[16px] border-b-transparent ml-2 pointer-events-none"></div>
                        )}
                    </Pressable>

                    {/* 재생 버튼을 가운데 두기 위한 균형추 */}
                    <div className="sm-spacer w-16 h-16" />
                </div>
            </main>

            <footer className="sm-footer h-24 bg-white/[0.06] rounded-[2.5rem] border border-white/10 flex items-center px-10 gap-8 animate-slide-up">
                <div className="flex-1 flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1">Weekly progress</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black">{hm(weekly.total + elapsed, { always: true })}</span>
                        <span className={`text-xs font-bold ${weekly.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {hm(weekly.change, { always: true, sign: true })}
                        </span>
                    </div>
                </div>
                <div className="sm-footer-chips flex gap-4">
                    {weekly.bySubject.slice(0, 3).map((stat) => (
                        <div key={stat.subject} className="px-4 py-2 bg-white/5 rounded-xl border border-white/5 flex flex-col items-center">
                            <span className="text-[8px] font-black uppercase opacity-40">{stat.subject}</span>
                            <span className="text-xs font-bold">{hm(stat.total, { always: true })}</span>
                        </div>
                    ))}
                </div>
            </footer>

            <AnimatePresence>
                {showCountdownDone && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            className="absolute inset-0"
                            style={{ background: 'var(--scrim)' }}
                            onClick={() => setShowCountdownDone(false)}
                        />
                        <motion.div
                            variants={materialize} initial="initial" animate="animate" exit="exit"
                            className="relative liquid-modal p-10 flex flex-col items-center gap-6 max-w-sm w-full text-center shadow-2xl"
                        >
                            <Icon icon="mdi:alarm" className="text-6xl mb-2 text-indigo-400" />
                            <h3 className="text-3xl font-black tracking-tight text-display">테스트 종료!</h3>
                            <p className="font-bold opacity-60">지정한 시간이 모두 지났습니다.<br />수고하셨습니다!</p>
                            <div className="flex flex-col gap-3 w-full mt-4">
                                <Pressable onClick={() => setShowCountdownDone(false)} pressScale={0.97}
                                    className="w-full py-4 bg-indigo-500 text-white rounded-2xl font-black text-lg shadow-xl">
                                    확인
                                </Pressable>
                                <Pressable
                                    onClick={() => {
                                        setShowCountdownDone(false)
                                        timer.setSession((s) => ({ ...s, countdownMs: undefined }))
                                    }}
                                    pressScale={0.97}
                                    className="w-full py-4 glass-card-elevated text-[var(--color-text-secondary)] rounded-2xl font-bold text-sm"
                                >
                                    타이머 끄기
                                </Pressable>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {showTestTimer && (
                <TestTimerModal
                    onClose={() => setShowTestTimer(false)}
                    onConfirm={async (minutes) => {
                        setShowTestTimer(false)
                        setShowCountdownDone(false)
                        await switchTo({ type: '테스트', countdownMs: minutes * 60_000 })
                    }}
                    settings={settings}
                />
            )}

            <SessionEvalModal
                isOpen={showEvalModal}
                onClose={() => closeEval()}
                onSave={closeEval}
                sessionDuration={lastSession?.duration ?? 0}
                subject={subject}
                subItem={subItem}
                parkedNotes={parkedNotes}
            />

            <ThoughtParkingDrawer
                isOpen={showParking}
                onClose={() => setShowParking(false)}
                parkedNotes={parkedNotes}
                onPark={async (content) => {
                    const note: ThoughtNote = {
                        date: getTodayDate(),
                        sessionStartTime: timer.startedAt.current,
                        createdAt: Date.now(),
                        content,
                        reviewed: false,
                    }
                    const id = await addThoughtNote(note)
                    setParkedNotes((prev) => [...prev, { ...note, id }])
                }}
            />
        </div>
    )
}

/** 일일 목표 진행 바 — 100% 를 넘기면 초록으로 바뀐다. */
function DailyGoalBar({ done, goal }: { done: number; goal: number }) {
    const pct = Math.min(100, Math.round((done / goal) * 100))
    const reached = pct >= 100
    const h = Math.floor(goal / 3_600_000)
    const m = Math.floor((goal % 3_600_000) / 60_000)
    return (
        <div className="sm-goal w-full max-w-3xl mx-auto mt-4 px-1">
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest opacity-40 mb-1.5">
                <span>일일 목표 {h > 0 ? `${h}h` : ''}{m > 0 ? ` ${m}m` : ''}</span>
                <span style={{ color: reached ? '#22c55e' : 'inherit' }}>{pct}%{reached ? ' ✓' : ''}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                    className="h-full w-full rounded-full"
                    style={{
                        transformOrigin: 'left',
                        background: reached
                            ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                            : 'linear-gradient(90deg, #6366f1, #a855f7)',
                        boxShadow: reached ? '0 0 8px rgba(34,197,94,0.5)' : '0 0 8px rgba(168,85,247,0.3)',
                    }}
                    initial={false}
                    animate={{ scaleX: pct / 100 }}
                    transition={spring.default}
                />
            </div>
        </div>
    )
}
