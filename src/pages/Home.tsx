import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import {
    isFirstVisitToday,
    getTodayTotalStudyTime,
    getTodayStudyTimeBySubject,
    autoFinalizeMissedDiaries
} from '../lib/db'
import type { Totals } from '../lib/sessions'
import { hm, hms } from '../lib/format'
import StartStudyModal from '../components/StartStudyModal'
import MorningReportCard from '../components/MorningReportCard'
import DiaryCard from '../components/DiaryCard'
import DdayWidget from '../components/DdayWidget'
import ChecklistCard from '../components/ChecklistCard'
import WeeklyDiaryCard from '../components/WeeklyDiaryCard'
import LearningNotesCard from '../components/LearningNotesCard'
import HomeSection from '../components/HomeSection'
import PWAInstallPrompt, {
    IOSInstallGuide,
    getCapturedPrompt,
    clearCapturedPrompt,
    isStandaloneMode,
    isIOSDevice,
    type BeforeInstallPromptEvent,
} from '../components/PWAInstallPrompt'
import { HelpButton } from '../components/HelpButton'
import { HOME_PHRASES, getRandomPhrase } from '../lib/phrases'
import { NativeBridge } from '../lib/NativeBridge'
import { spring, staggerContainer, staggerItem } from '../lib/motion'
import Pressable from '../components/ui/Pressable'
import MeterScale from '../components/ui/MeterScale'
import { meterSpan, SEGMENT_TONE_PCT } from '../lib/meter'

interface HomeProps {
    settings: Settings
}

export default function Home({ settings }: HomeProps) {
    const navigate = useNavigate()
    const [isFirstVisit, setIsFirstVisit] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [todayTotal, setTodayTotal] = useState(0)
    const [subjectTimes, setSubjectTimes] = useState<Map<string, Totals>>(new Map())
    const randomPhrase = useMemo(() => getRandomPhrase(HOME_PHRASES), [])

    // ── 홈 화면 추가 버튼 상태 ─────────────────────────────────────────────
    const [showAddBtn, setShowAddBtn] = useState(false)
    const [addBtnIOS, setAddBtnIOS] = useState(false)
    const [showIOSGuide, setShowIOSGuide] = useState(false)
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

    useEffect(() => {
        // 이미 PWA로 실행 중이거나 네이티브 앱이면 버튼 숨김
        if (isStandaloneMode() || NativeBridge.isNative()) return

        setShowAddBtn(true)
        setAddBtnIOS(isIOSDevice())

        // 모듈 레벨에서 이미 캡처된 프롬프트 사용
        const captured = getCapturedPrompt()
        if (captured) setInstallPrompt(captured)

        // 이후 발생하는 이벤트도 수신
        const handler = (e: Event) => {
            e.preventDefault()
            setInstallPrompt(e as BeforeInstallPromptEvent)
        }
        window.addEventListener('beforeinstallprompt', handler)
        window.addEventListener('appinstalled', () => setShowAddBtn(false))

        return () => window.removeEventListener('beforeinstallprompt', handler)
    }, [])

    const handleAddToHome = async () => {
        if (addBtnIOS) { setShowIOSGuide(true); return }
        if (!installPrompt) return
        await installPrompt.prompt()
        const { outcome } = await installPrompt.userChoice
        if (outcome === 'accepted') setShowAddBtn(false)
        clearCapturedPrompt()
        setInstallPrompt(null)
    }
    // ─────────────────────────────────────────────────────────────────────

    useEffect(() => {
        // 세 조회는 서로 의존하지 않지만, 기존과 같은 순서로 상태를 채운다.
        async function loadData() {
            setIsFirstVisit(await isFirstVisitToday())
            setTodayTotal(await getTodayTotalStudyTime())
            setSubjectTimes(await getTodayStudyTimeBySubject())
        }
        loadData()
    }, [])

    // 지난 날짜 일기 자동 확정 (마운트 1회). 아침 리포트는 홈 진입 시
    // MorningReportCard 가 캐시 우선으로 생성하므로 별도 백그라운드 예약이 없다.
    useEffect(() => {
        autoFinalizeMissedDiaries(settings.dailyGoalMs).catch(() => { /* ignore */ })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const goalMs = settings.dailyGoalMs && settings.dailyGoalMs > 0 ? settings.dailyGoalMs : undefined
    const goalPct = goalMs ? Math.round((todayTotal / goalMs) * 100) : null
    const ranked = Array.from(subjectTimes, ([subject, times]) => ({ subject, ms: times.total }))
        .sort((a, b) => b.ms - a.ms)
    const dateTitle = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })

    return (
        <motion.div
            className="flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
        >
            {/* 넓은 화면: 왼쪽은 오늘의 측정값과 기록, 오른쪽 레일은 D-day·체크리스트·회고.
                좁은 화면에서는 두 단이 풀려(contents) order 순서대로 한 줄이 된다 — 원래 순서 그대로. */}
            <div className="contents xl:flex xl:flex-col xl:gap-8 xl:min-w-0">
                <div className="order-1 xl:order-none empty:hidden">
                <motion.header variants={staggerItem} className="flex flex-col gap-1.5 pt-1">
                    <h1 className="text-[28px] md:text-[34px] leading-tight font-medium text-[var(--color-text)]">
                        {dateTitle}
                    </h1>
                    <p className="text-[15px] md:text-[16px] text-[var(--color-text-secondary)]">
                        {randomPhrase}
                    </p>
                </motion.header>
                </div>
                <div className="order-2 xl:order-none empty:hidden">
                {/* PWA 설치 권유 배너 */}
                <PWAInstallPrompt />
                </div>
                <div className="order-3 xl:order-none empty:hidden">
                {/* 아침 브리핑 / 주간 리뷰 */}
                <MorningReportCard settings={settings} />
                </div>
                <div className="order-5 xl:order-none empty:hidden">
                {/* 오늘 측정값 — 이 화면의 모먼트: 큰 수치 + 과목별로 쌓인 계측 눈금 */}
                <motion.section variants={staggerItem} className="glass-card p-6 md:p-8 @container">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1.5">
                            <h2 className="text-[14px] font-medium text-[var(--color-text-secondary)]">오늘 공부 시간</h2>
                            <HelpButton
                                title="오늘의 집중 시간"
                                items={[
                                    { description: '오늘 완료하거나 진행 중인 모든 공부 세션의 합산 시간입니다.' },
                                    { title: '자정 초기화', description: '매일 자정을 기준으로 새로운 날의 집계가 시작됩니다.' },
                                    { title: '과목별 분류', description: '눈금과 아래 목록에서 오늘 공부한 과목별 누적 시간을 확인할 수 있습니다.' },
                                    { title: '총합 vs 순공', description: '총합은 강의·자습·테스트 등 모든 세션을 포함하고, 순공(자습)은 자습·테스트 타입 세션만 집계합니다.' },
                                    { title: '세부 항목', description: '공부 타이머 화면에서 세부 항목을 선택하면 더 세밀하게 분류됩니다.' },
                                ]}
                            />
                        </div>
                        {goalMs && (
                            <span className="meta">
                                목표 {hm(goalMs, { always: true })} · {goalPct}%
                            </span>
                        )}
                    </div>

                    <div className="figure text-[min(19cqw,136px)] text-[var(--color-text)] mt-4 md:mt-6 -ml-1">
                        {hms(todayTotal)}
                    </div>

                    <MeterScale
                        className="mt-6 md:mt-8"
                        value={todayTotal}
                        span={meterSpan(todayTotal, goalMs)}
                        goal={goalMs}
                        segments={ranked.map((r) => ({ key: r.subject, ms: r.ms }))}
                    />

                    {ranked.length > 0 ? (
                        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                            {ranked.map((r, i) => (
                                <div key={r.subject} className="flex items-center gap-2.5 h-9 border-t border-[var(--color-border)]">
                                    <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0"
                                        style={{ background: `color-mix(in srgb, var(--lamp) ${SEGMENT_TONE_PCT[Math.min(i, SEGMENT_TONE_PCT.length - 1)]}%, transparent)` }}
                                    />
                                    <span className="text-[14px] text-[var(--color-text)] truncate">{r.subject}</span>
                                    <span className="ml-auto font-mono text-[13px] tabular-nums text-[var(--color-text-secondary)]">{hms(r.ms)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-5 text-[14px] text-[var(--color-text-muted)]">
                            {isFirstVisit ? '오늘의 첫 공부를 시작해 보세요' : '기록을 시작하면 여기에 과목별 시간이 쌓입니다'}
                        </p>
                    )}
                </motion.section>
                </div>
                <div className="order-6 xl:order-none empty:hidden">
                {/* Main Actions — 공부 시작하기가 주된 CTA, 필요 시 설치 버튼이 옆에 붙는다 */}
                <motion.div
                    variants={staggerItem}
                    className={`grid gap-3 ${showAddBtn ? 'grid-cols-1 sm:grid-cols-[2fr_1fr]' : 'grid-cols-1'}`}
                >
                    <Pressable
                        pressScale={0.98}
                        onClick={() => setShowModal(true)}
                        className="btn btn-primary h-16 text-[17px] justify-between px-7"
                    >
                        <span className="flex items-center gap-2.5">
                            <Icon icon="mdi:play" className="text-[20px]" />
                            공부 시작하기
                        </span>
                        <Icon icon="mdi:arrow-right" className="text-[18px] opacity-60" />
                    </Pressable>

                    {/* 홈 화면 추가 버튼 — 웹 브라우저에서만 표시 */}
                    <AnimatePresence>
                        {showAddBtn && (
                            <motion.button
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                whileTap={{ scale: 0.98 }}
                                transition={spring.snappy}
                                onClick={handleAddToHome}
                                className="btn btn-glass h-16 text-[15px] justify-start px-6"
                            >
                                <Icon
                                    icon={addBtnIOS ? 'mdi:export-variant' : 'mdi:cellphone-arrow-down'}
                                    className="text-[18px] text-[var(--color-text-muted)]"
                                />
                                <span className="flex flex-col items-start leading-tight">
                                    <span>홈 화면에 추가</span>
                                    <span className="text-[12px] text-[var(--color-text-muted)] font-normal">
                                        {addBtnIOS ? 'Safari → 공유 → 홈 화면에 추가' : '앱처럼 설치하기'}
                                    </span>
                                </span>
                            </motion.button>
                        )}
                    </AnimatePresence>
                </motion.div>
                </div>
                <div className="order-8 xl:order-none empty:hidden">
                {/* 오늘의 일기 (3초 일기) */}
                <DiaryCard settings={settings} />
                </div>
            </div>

            <div className="contents xl:flex xl:flex-col xl:gap-8 xl:sticky xl:top-10">
                <div className="order-4 xl:order-none empty:hidden">
                {/* D-day */}
                <DdayWidget settings={settings} />
                </div>
                <div className="order-7 xl:order-none empty:hidden">
                {/* 체크리스트 (오늘/이번 주/이번 달) */}
                <ChecklistCard />
                </div>
                <div className="order-9 xl:order-none empty:hidden">
                {/* 매일 필수는 아니지만 항상 접근 가능한 기능들 — 접힌 상태로 시작 */}
                <HomeSection
                    title="이번 주 회고"
                    icon="mdi:notebook-outline"
                    storageKey="home_section_weekly"
                >
                    <WeeklyDiaryCard settings={settings} bare />
                </HomeSection>
                </div>
                <div className="order-10 xl:order-none empty:hidden">
                <HomeSection
                    title="학습 복기"
                    icon="mdi:head-lightbulb-outline"
                    storageKey="home_section_notes"
                >
                    <LearningNotesCard settings={settings} bare />
                </HomeSection>
                </div>
                <div className="order-11 xl:order-none empty:hidden">
                {/* 개발자 크레딧 */}
                <motion.div variants={staggerItem}>
                    <Pressable
                        pressScale={0.98}
                        onClick={() => navigate('/developer')}
                        className="w-full flex items-center justify-between px-4 h-14 rounded-xl border border-[var(--color-border)] hover:bg-[var(--surface-raised)] transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-[var(--surface-raised)] border border-[var(--color-border)] flex items-center justify-center text-[13px] font-medium text-[var(--color-text-secondary)] flex-shrink-0">
                                Y
                            </div>
                            <div className="text-left">
                                <p className="text-[12px] text-[var(--color-text-muted)] leading-tight">개발자</p>
                                <p className="text-[14px] font-medium text-[var(--color-text)] leading-tight">Yoo Seung Hyeok</p>
                            </div>
                        </div>
                        <Icon icon="mdi:chevron-right" className="text-[18px] text-[var(--color-text-muted)]" />
                    </Pressable>
                </motion.div>
                </div>
            </div>

            {/* iOS 설치 가이드 모달 */}
            <IOSInstallGuide isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />

            {showModal && (
                <StartStudyModal
                    settings={settings}
                    isFirstVisit={isFirstVisit}
                    onClose={() => setShowModal(false)}
                    onConfirm={(subject, type, countdownDuration, subItem) => {
                        setShowModal(false)
                        navigate('/study', { state: { subject, type, countdownDuration, subItem } })
                    }}
                />
            )}
        </motion.div>
    )
}
