import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import Pressable from '../components/ui/Pressable'
import SlidingSelector from '../components/ui/SlidingSelector'
import Chip from '../components/ui/Chip'
import { Stat } from '../components/ui/Stat'
import MeterScale from '../components/ui/MeterScale'
import { meterSpan } from '../lib/meter'
import { spring, fadeRise, materialize } from '../lib/motion'
import { hm, hms, hmsDecimal, ymd, toDate, addDays } from '../lib/format'
import { groupTotals, sumDuration, sumTotals, isSelfStudy } from '../lib/sessions'
import { useStudyTimer, MAX_PLAUSIBLE_SESSION_MS } from '../lib/useStudyTimer'
import { useModal } from '../lib/ModalContext'
import AmbientClock from '../components/AmbientClock'
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

/** 카운트다운 종료를 이미 알린 세션(시작 시각). 리마운트·재실행해도 다시 울리지 않게 저장한다. */
const COUNTDOWN_FIRED_KEY = 'studymeter_countdown_fired'

function readCountdownFired(): number | null {
    try {
        const v = Number(localStorage.getItem(COUNTDOWN_FIRED_KEY))
        return Number.isFinite(v) && v > 0 ? v : null
    } catch {
        return null
    }
}

const ZERO_TOTALS: TodayTotals = { all: 0, subject: 0, subjectType: 0, selfStudy: 0 }
const ZERO_WEEK: WeeklyStats = { bySubject: [], total: 0, change: 0 }

export default function Study({ settings }: StudyProps) {
    const navigate = useNavigate()
    const { state } = useLocation()
    const { showConfirm } = useModal()

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
    /** 화면 보호(번인 방지) 모드 — 한동안 손대지 않으면 시계만 남긴다 */
    const [ambient, setAmbient] = useState(false)

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
    // 래치는 localStorage 에도 둔다 — 앱을 다시 열거나 화면이 다시 마운트돼도 끝난
    // 테스트의 팝업이 또 뜨지 않는다. 복원이 끝나기 전(ready 전)에는 판단하지 않는다.
    const countdownFiredAt = useRef<number | null>(readCountdownFired())
    useEffect(() => {
        if (!timer.ready || isEnding || !countdownMs || timer.elapsed < countdownMs) return
        if (countdownFiredAt.current === timer.startedAt.current) return
        countdownFiredAt.current = timer.startedAt.current
        try {
            localStorage.setItem(COUNTDOWN_FIRED_KEY, String(timer.startedAt.current))
        } catch {
            /* 무시 */
        }
        setShowCountdownDone(true)
        setAmbient(false)
        // 미디어 볼륨으로 재생되어 벨소리/진동 모드와 무관하게 들리고, 이어폰이 있으면 그쪽으로 간다.
        playTimerEndSound()
    }, [countdownMs, timer.elapsed, timer.startedAt, timer.ready, isEnding])

    // ── Now Bar (Android 알림) ──────────────────────────────────────────────
    const nowBarStarted = useRef(false)
    useEffect(() => {
        if (!timer.ready || !NativeBridge.isNative()) return
        if (isEnding || endingRef.current) {
            NativeBridge.stopNowBar()
            nowBarStarted.current = false
            return
        }
        // 아래 비동기 작업이 끝나기 전에 세션이 끝나거나 값이 또 바뀌면 이 호출은 버린다.
        // (예전엔 종료 직후 늦게 도착한 START 가 끝난 세션의 나우바를 되살렸다.)
        let stale = false
        ;(async () => {
            // Java 쪽에서 더할 필요가 없도록 현재 세션까지 포함한 합산값을 넘긴다.
            const sessions = await getSessionsOn()
            if (stale || endingRef.current) return
            const elapsed = timer.elapsedNow()
            const total = sumDuration(sessions) + elapsed
            const bySubject = (groupTotals(sessions, (s) => s.subject).get(subject)?.total ?? 0) + elapsed
            const base = Date.now() - elapsed
            if (nowBarStarted.current) {
                NativeBridge.updateNowBar(subject, base, timer.isRunning, total, bySubject, countdownMs ?? 0)
            } else if (await NativeBridge.requestNotificationPermission()) {
                if (stale || endingRef.current) return
                NativeBridge.startNowBar(subject, base, timer.isRunning, total, bySubject, countdownMs ?? 0)
                nowBarStarted.current = true
            }
        })()
        return () => { stale = true }
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
        // 사람이 한 번에 공부할 수 없는 길이 — 앱이 죽은 채로 시계만 흐른 흔적일 가능성이 높다.
        if (duration > MAX_PLAUSIBLE_SESSION_MS) {
            const keep = await showConfirm(
                '비정상적으로 긴 세션',
                `이 세션이 ${hm(duration, { always: true })}로 기록됩니다. 앱이 꺼진 사이 시계만 흐른 것 같다면 버려 주세요.`,
                { confirmText: '그대로 기록', cancelText: '버리기' },
            )
            if (!keep) {
                timer.clear()
                if (withEval) timer.finish()
                savingRef.current = false
                return null
            }
        }
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
        NativeBridge.haptic('tick')
        await saveSession()
        timer.restart(next)
        await refreshTotals(next.subject ?? subject, next.type ?? type)
    }

    const handleEnd = async () => {
        // 상태가 아니라 ref 로 막는다 — 리렌더 전에 두 번 눌려도 한 번만 통과해야 한다.
        if (endingRef.current) return
        endingRef.current = true
        setIsEnding(true)
        setAmbient(false)
        NativeBridge.haptic('confirm')
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

    // ── 화면 보호 (번인 방지) ───────────────────────────────────────────────
    // "앱을 보고 있는데 손을 안 대는 상태"가 설정한 시간(기본 1분) 이어질 때만 켠다.
    //  · 다른 앱으로 가 있거나(화면 가려짐) 분할 화면에서 다른 앱을 쓰는 중(창 포커스 잃음)
    //    에는 시간을 세지 않는다. 예전엔 뒤에 가 있는 동안에도 카운트가 흘러서, 돌아오자마자
    //    검은 화면으로 떨어졌다.
    //  · 앱으로 돌아온 것 자체를 조작으로 본다 — 원래 화면을 보여주고 처음부터 다시 센다.
    //  · 무언가를 물어보는 창이 떠 있는 동안에는 켜지 않는다.
    const ambientDelayMs = (settings.ambientDelaySec ?? 60) * 1000
    const ambientBlocked =
        !timer.ready || isEnding || showEvalModal || showTestTimer || showParking || showCountdownDone || !!timer.recovery
    useEffect(() => {
        if (!ambientDelayMs || ambientBlocked) return
        let t = 0
        /** 창 포커스를 잃은 상태 (분할 화면의 다른 앱, 알림창 내림 등) */
        let away = false
        const stop = () => {
            clearTimeout(t)
            t = 0
        }
        const arm = () => {
            stop()
            if (ambient || away || document.visibilityState !== 'visible') return
            t = window.setTimeout(() => setAmbient(true), ambientDelayMs)
        }
        const leave = () => {
            away = true
            stop()
        }
        const comeBack = () => {
            away = false
            setAmbient(false)
            arm()
        }
        const onVisibility = () => (document.visibilityState === 'visible' ? comeBack() : leave())

        const opts = { capture: true, passive: true }
        arm()
        window.addEventListener('pointerdown', arm, opts)
        window.addEventListener('keydown', arm, opts)
        window.addEventListener('wheel', arm, opts)
        window.addEventListener('blur', leave)
        window.addEventListener('focus', comeBack)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
            stop()
            window.removeEventListener('pointerdown', arm, opts)
            window.removeEventListener('keydown', arm, opts)
            window.removeEventListener('wheel', arm, opts)
            window.removeEventListener('blur', leave)
            window.removeEventListener('focus', comeBack)
            document.removeEventListener('visibilitychange', onVisibility)
        }
    }, [ambientDelayMs, ambientBlocked, ambient])

    // 막는 창이 뜨면(테스트 종료 팝업 등) 검은 화면은 바로 걷힌다.
    const ambientOn = ambient && !!ambientDelayMs && !ambientBlocked

    // 화면 보호 중에는 하단 내비게이션 바까지 숨긴다.
    useEffect(() => {
        NativeBridge.setImmersive(ambientOn)
    }, [ambientOn])
    useEffect(() => () => NativeBridge.setImmersive(false), [])

    return (
        <div className="sm-study true-black h-[100dvh] min-h-[100dvh] bg-black text-white flex flex-col justify-between safe-area-bottom px-4 py-4 md:px-12 md:py-8 overflow-y-auto pt-[calc(1rem+env(safe-area-inset-top))]">
            {/* 아이패드 가로모드(4:3 ≈ 1.33)에서도 스톱워치·재생/일시정지 버튼이 절대 잘리지 않도록
                하는 컴팩트 레이아웃. 갤럭시탭 16:10(1.6)은 대상에서 확실히 제외해 기존(넓은) 모습을
                유지한다 — 임계값을 11/8(1.375)로 두어, 브라우저 크롬으로 가로폭이 줄어 비율이 다소
                낮아지는 갤럭시탭(≈1.475)까지도 제외되게 한다. overflow-y-auto는 어떤 경우에도(고급
                모드 등으로 콘텐츠가 늘어나도) 콘텐츠가 화면 밖으로 사라지지 않게 하는 안전망이다.
                폭 1024px 이상은 2열(타이머 | 조작·패널) 레이아웃이라 세로 여유가 생겨 컴팩트 규칙을 적용하지 않는다. */}
            <style>{`
                @media (orientation: landscape) and (max-height: 900px) and (max-aspect-ratio: 11/8) and (max-width: 1023px) {
                    .sm-study { padding: 0.75rem 1.25rem !important; }
                    .sm-header { gap: 0.5rem !important; }
                    .sm-selectors { padding-bottom: 0.5rem !important; }
                    .sm-subitem { padding: 0.5rem !important; }
                    .sm-main { justify-content: flex-start !important; }
                    .sm-timer-block { gap: 0.35rem !important; }
                    .sm-subject-label { font-size: 0.7rem !important; }
                    .sm-timer-num { font-size: clamp(2.5rem, 11vh, 6rem) !important; }
                    .sm-metric-grid { margin-top: 0.5rem !important; gap: 0.375rem !important; }
                    .sm-metric-card { padding: 0.5rem 0.75rem !important; border-radius: 14px !important; }
                    .sm-metric-value { font-size: 0.95rem !important; }
                    .sm-goal { margin-top: 0.375rem !important; }
                    .sm-focus-wrap { margin-top: 0.5rem !important; }
                    .sm-controls { margin-top: 0.5rem !important; gap: 1.5rem !important; }
                    .sm-play-btn { width: 4.5rem !important; height: 4.5rem !important; }
                    .sm-parking-btn { width: 2.75rem !important; height: 2.75rem !important; }
                    .sm-spacer { width: 2.75rem !important; height: 2.75rem !important; }
                    .sm-footer { padding-top: 0.5rem !important; gap: 0.75rem !important; }
                    .sm-footer-chips { display: none !important; }
                }
            `}</style>

            <header className="sm-header w-full max-w-3xl lg:max-w-[1440px] mx-auto flex flex-col gap-4 animate-fade-in">
                <div className="flex justify-between items-center h-10">
                    <div className="flex items-center gap-2.5">
                        <span
                            className="w-2 h-2 rounded-full transition-colors duration-200"
                            style={{ background: timer.isRunning ? '#5b94ff' : 'rgba(237,237,237,0.3)' }}
                        />
                        <span className="text-[14px] text-white/60">{timer.isRunning ? '측정 중' : '일시정지'}</span>
                    </div>
                    <Pressable
                        onClick={handleEnd}
                        pressScale={0.97}
                        className="h-10 px-5 rounded-full bg-white/[0.08] border border-white/10 text-[15px] font-medium text-white/90 hover:bg-white/[0.12] transition-colors"
                    >
                        세션 종료
                    </Pressable>
                </div>

                <div className="sm-selectors flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-1 px-1">
                    <SlidingSelector
                        items={settings.subjects.map((s) => s.name)}
                        currentValue={subject}
                        onChange={(next) => switchTo({ subject: next, subItem: undefined })}
                        activeColor="bg-[#2f6fed]"
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
                        activeColor="bg-white/[0.14]"
                        activeTextColor="text-white"
                        layoutId="type-pill"
                    />
                </div>

                {children.length > 0 && (
                    <div className="sm-subitem flex items-center gap-3 animate-fade-in">
                        <p className="text-[13px] text-white/40 shrink-0">세부 항목</p>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
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

            {/* 태블릿 가로·데스크톱: 왼쪽은 타이머·눈금·지표, 오른쪽은 조작 버튼과 방·집중도 패널 */}
            <main className="sm-main flex-1 flex flex-col justify-center relative z-0 w-full max-w-3xl lg:max-w-[1440px] mx-auto py-4 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)] lg:gap-x-14 lg:content-center">

                <motion.div className="sm-timer-block relative flex flex-col @container min-w-0" variants={fadeRise} initial="initial" animate="animate">
                    <div className="flex items-center gap-1.5">
                        <h2 className="sm-subject-label text-[15px] text-white/55">
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
                        <div className="flex flex-col gap-2 mt-2">
                            <span className="sm-timer-num figure text-[min(23cqw,240px)] text-[#ff6b6f] -ml-1">
                                {hms(Math.max(0, countdownMs - elapsed))}
                            </span>
                            <span className="font-mono text-[13px] tabular-nums text-white/45">오늘 합계 {hmsDecimal(totals.all + elapsed)}</span>
                        </div>
                    ) : (
                        <span className="sm-timer-num figure text-[min(19.5cqw,220px)] text-[#eef2f8] mt-2 -ml-1">
                            {hmsDecimal(totals.all + elapsed)}
                        </span>
                    )}

                    <DailyGoalBar done={totals.all + elapsed} goal={settings.dailyGoalMs ?? 0} />

                    <div className="sm-metric-grid grid grid-cols-2 @2xl:grid-cols-4 gap-3 mt-6 w-full">
                        <Stat
                            label={`${subject} 누적`}
                            value={hms(totals.subject + elapsed)}
                            help={<HelpButton dark title={`${subject} 오늘 누적`} items={`오늘 "${subject}" 과목에서 모든 타입(강의·자습·테스트 등)으로 공부한 총 시간입니다. 과목을 전환해도 이전 세션 시간이 합산됩니다.`} />}
                        />
                        <Stat
                            label={`${subject}+${type}`}
                            value={hms(totals.subjectType + elapsed)}
                            help={<HelpButton dark title="과목+타입 누적" items={`오늘 "${subject}" 과목에서 "${type}" 타입으로만 공부한 시간입니다. 예: 수학 강의만, 영어 자습만 따로 보고 싶을 때 유용합니다.`} />}
                        />
                        <Stat
                            label="현재 세션"
                            value={hms(elapsed)}
                            color="text-[#6ea0ff]"
                            help={<HelpButton dark title="현재 세션 시간" items="이번 공부 시작 버튼을 누른 순간부터 지금까지의 경과 시간입니다. 타입이나 과목을 전환하면 세션이 분리되어 다시 0부터 시작합니다." />}
                        />
                        <Stat
                            label="순공 (자습)"
                            value={hms(totals.selfStudy + (isSelfStudy(type) ? elapsed : 0))}
                            help={<HelpButton dark title="순공 시간이란?" items={[
                                { description: '자습·테스트 타입 세션만 합산한 시간입니다. 강의 수강 시간은 포함되지 않습니다.' },
                                { title: '왜 따로 보나요?', description: '수동적인 강의 시청과 능동적인 자습·문제풀이를 구분하여, 실제 스스로 공부한 시간을 파악하기 위함입니다.' },
                            ]} />}
                        />
                    </div>
                </motion.div>

                <div className="sm-side flex flex-col min-w-0 lg:justify-center">
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
                        className="mt-4 w-full flex items-center justify-between px-5 h-14 rounded-[20px] border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition-colors"
                    >
                        <span className="flex items-center gap-2.5">
                            <Icon icon="mdi:eye-outline" className="text-[18px] text-white/40" />
                            <span className="text-[14px] text-white/70">집중력 모니터</span>
                        </span>
                        <span className="flex items-center gap-1 text-[13px] text-white/40">
                            {focusOpen ? '접기' : '펼치기'}
                            <motion.span animate={{ rotate: focusOpen ? 180 : 0 }} transition={spring.snappy} className="flex">
                                <Icon icon="mdi:chevron-down" className="text-[16px]" />
                            </motion.span>
                        </span>
                    </button>
                )}

                {focusOpen && (
                    <div className="sm-focus-wrap w-full">
                        <FocusPanel drowsinessThresholdSec={settings.drowsinessThresholdSec ?? 15} />
                    </div>
                )}

                <div className="sm-controls mt-8 flex items-center justify-center gap-10 lg:order-first lg:mt-0 lg:mb-2 lg:py-6">
                    <div className="sm-parking flex flex-col items-center gap-1">
                        <Pressable onClick={() => setShowParking(true)} pressScale={0.96} className="flex flex-col items-center gap-1.5">
                            <div className="sm-parking-btn w-14 h-14 lg:w-16 lg:h-16 rounded-[20px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 flex flex-col items-center justify-center gap-0.5 transition-colors">
                                <span className="text-[20px] font-medium text-white/85 leading-none">P</span>
                                {parkedNotes.length > 0 && (
                                    <span className="font-mono text-[11px] text-[#6ea0ff] leading-none">{parkedNotes.length}</span>
                                )}
                            </div>
                            <span className="text-[12px] text-white/40">주차장</span>
                        </Pressable>
                        <HelpButton dark title="생각 주차장 (P)" items={[
                            { description: '공부 중 갑자기 떠오른 관련 없는 생각(할 일, 아이디어 등)을 빠르게 기록해 두는 공간입니다.' },
                            { title: '왜 쓰나요?', description: '생각을 직접 메모 앱으로 전환하면 집중이 깨집니다. 주차장에 버려두면 잊어버릴 걱정 없이 공부에 바로 복귀할 수 있습니다.' },
                            { title: '나중에 확인', description: '세션 평가 화면에서 주차된 생각을 한꺼번에 확인하고 처리할 수 있습니다.' },
                        ]} />
                    </div>

                    <Pressable
                        onClick={() => {
                            NativeBridge.haptic('press')
                            timer.toggle()
                        }}
                        pressScale={0.96}
                        aria-label={timer.isRunning ? '일시정지' : '재개'}
                        className="sm-play-btn w-24 h-24 md:w-28 md:h-28 lg:w-32 lg:h-32 rounded-full flex items-center justify-center cursor-pointer transition-colors duration-200"
                        style={{ background: timer.isRunning ? '#eef2f8' : '#2f6fed' }}
                    >
                        {timer.isRunning ? (
                            <div className="flex gap-2 pointer-events-none">
                                <div className="w-2.5 h-9 bg-[#141415] rounded-[2px]"></div>
                                <div className="w-2.5 h-9 bg-[#141415] rounded-[2px]"></div>
                            </div>
                        ) : (
                            <div className="w-0 h-0 border-l-[22px] border-l-white border-t-[14px] border-t-transparent border-b-[14px] border-b-transparent ml-1.5 pointer-events-none"></div>
                        )}
                    </Pressable>

                    {/* 재생 버튼을 가운데 두기 위한 균형추 */}
                    <div className="sm-spacer w-14 h-14 lg:w-16 lg:h-16" />
                </div>
                </div>
            </main>

            <footer className="sm-footer w-full max-w-3xl lg:max-w-[1440px] mx-auto border-t border-white/10 pt-4 flex items-end gap-6 animate-fade-in">
                <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[12px] text-white/45">이번 주</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[22px] font-light tabular-nums text-white/90">{hm(weekly.total + elapsed, { always: true })}</span>
                        <span className={`font-mono text-[12px] tabular-nums ${weekly.change >= 0 ? 'text-[#4cc38a]' : 'text-[#ec6a6e]'}`}>
                            {hm(weekly.change, { always: true, sign: true })} vs 지난주
                        </span>
                    </div>
                </div>
                <div className="sm-footer-chips hidden sm:flex gap-6">
                    {weekly.bySubject.slice(0, 3).map((stat) => (
                        <div key={stat.subject} className="flex flex-col items-end gap-1">
                            <span className="text-[12px] text-white/45">{stat.subject}</span>
                            <span className="font-mono text-[13px] tabular-nums text-white/80">{hm(stat.total, { always: true })}</span>
                        </div>
                    ))}
                </div>
            </footer>

            <AmbientClock
                active={ambientOn}
                time={countdownMs ? hms(Math.max(0, countdownMs - elapsed)) : hms(totals.all + elapsed)}
                label={`${subject}${subItem ? ` › ${subItem}` : ''} · ${type}`}
                running={timer.isRunning}
                countdown={!!countdownMs}
                onWake={() => setAmbient(false)}
            />

            <AnimatePresence>
                {timer.recovery && !isEnding && (
                    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-6">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            className="absolute inset-0"
                            style={{ background: 'var(--scrim)' }}
                        />
                        <motion.div
                            variants={materialize} initial="initial" animate="animate" exit="exit"
                            className="relative liquid-modal p-8 flex flex-col gap-4 max-w-sm w-full"
                        >
                            <Icon icon="mdi:timer-alert-outline" className="text-5xl text-amber-400" />
                            <h3 className="text-2xl font-black tracking-tight text-display">타이머를 멈춰 두었어요</h3>
                            <p className="text-sm font-medium opacity-70 leading-relaxed">
                                {new Date(timer.recovery.stoppedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {NativeBridge.isNative()
                                    ? '에 앱이 시스템에 의해 종료되어 알림 타이머도 함께 꺼졌습니다. 그 이후'
                                    : '이후로 앱이 한참 닫혀 있어 그때 멈춘 것으로 봤습니다. 그 이후'}
                                {' '}{hm(timer.recovery.cutMs, { always: true })}는 기록에서 뺐어요.
                            </p>
                            <div className="flex flex-col gap-2 mt-2">
                                <Pressable
                                    onClick={timer.dismissRecovery}
                                    pressScale={0.97}
                                    className="btn btn-primary w-full h-12 text-[15px]"
                                >
                                    확인 (멈춘 채로 두기)
                                </Pressable>
                                <Pressable
                                    onClick={timer.undoRecovery}
                                    pressScale={0.97}
                                    className="w-full py-3 glass-card-elevated text-[var(--color-text-secondary)] rounded-2xl font-bold text-sm"
                                >
                                    그동안도 계속 공부 중이었어요
                                </Pressable>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

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
                            className="relative liquid-modal p-10 flex flex-col items-center gap-6 max-w-sm w-full text-center"
                        >
                            <Icon icon="mdi:alarm" className="text-6xl mb-2 text-indigo-400" />
                            <h3 className="text-3xl font-black tracking-tight text-display">테스트 종료</h3>
                            <p className="font-bold opacity-60">지정한 시간이 모두 지났습니다.<br />수고하셨습니다.</p>
                            <div className="flex flex-col gap-3 w-full mt-4">
                                <Pressable onClick={() => setShowCountdownDone(false)} pressScale={0.97}
                                    className="btn btn-primary w-full h-12 text-[15px]">
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

/** 일일 목표 계측 눈금 — 목표가 있으면 목표까지, 없으면 다음 정시까지 잰다. 달성하면 채움이 초록. */
function DailyGoalBar({ done, goal }: { done: number; goal: number }) {
    const hasGoal = goal > 0
    const pct = hasGoal ? Math.min(100, Math.round((done / goal) * 100)) : 0
    const reached = hasGoal && pct >= 100
    return (
        <div className="sm-goal w-full mt-4">
            <MeterScale value={done} span={meterSpan(done, hasGoal ? goal : undefined)} goal={hasGoal ? goal : undefined} reached={reached} tone="dark" />
            {hasGoal && (
                <div className="flex justify-between font-mono text-[12px] tabular-nums text-white/45 mt-1">
                    <span>목표 {hm(goal, { always: true })}</span>
                    <span className={reached ? 'text-[#3ccf91]' : 'text-[#6ea0ff]'}>{pct}%</span>
                </div>
            )}
        </div>
    )
}
