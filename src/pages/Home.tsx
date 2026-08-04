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
import { hms } from '../lib/format'
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
import { spring, materialize, staggerContainer, staggerItem } from '../lib/motion'
import Pressable from '../components/ui/Pressable'

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

    return (
        <motion.div
            className="flex flex-col gap-10"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
        >
            {/* Header with High Contrast */}
            <motion.header variants={staggerItem} className="flex flex-col gap-2">
                <h1 className="text-display text-4xl md:text-5xl font-black text-[var(--color-text)]">
                    안녕하세요, <span className="gradient-text">{settings.userName}</span>님
                </h1>
                <p className="text-xl md:text-2xl font-semibold text-[var(--color-text-secondary)] opacity-80">
                    {randomPhrase}
                </p>
            </motion.header>

            {/* PWA 설치 권유 배너 */}
            <PWAInstallPrompt />

            {/* 아침 브리핑 / 주간 리뷰 */}
            <MorningReportCard settings={settings} />

            {/* D-day */}
            <DdayWidget settings={settings} />

            {/* Hero Stats Card */}
            <motion.section
                variants={materialize}
                className="glass-card p-8 md:p-14 flex flex-col items-center justify-center text-center relative overflow-hidden"
            >
                {/* 은은한 그라디언트 어시스트 — 히어로 숫자 뒤 소프트 글로우 하나만 */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full"
                    style={{ background: 'radial-gradient(closest-side, rgba(99,102,241,0.18), transparent)' }}
                />

                <div className="relative z-10 w-full">
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <h2 className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--color-text-secondary)]">Today's Focus Time</h2>
                        <HelpButton
                            title="오늘의 집중 시간"
                            items={[
                                { description: '오늘 완료하거나 진행 중인 모든 공부 세션의 합산 시간입니다.' },
                                { title: '자정 초기화', description: '매일 자정을 기준으로 새로운 날의 집계가 시작됩니다.' },
                                { title: '과목별 분류', description: '아래 태그에서 각 과목별 공부 시간을 한눈에 확인할 수 있습니다.' },
                            ]}
                        />
                    </div>

                    <div className="flex flex-col items-center gap-5">
                        <span className="text-display text-7xl md:text-[8.5rem] font-black tabular-nums gradient-text leading-none">
                            {hms(todayTotal)}
                        </span>
                        <div className="h-1.5 w-20 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] rounded-full"></div>
                    </div>

                    <motion.div
                        variants={staggerContainer}
                        initial="initial"
                        animate="animate"
                        className="flex flex-wrap justify-center gap-2.5 mt-10 items-center"
                    >
                        {Array.from(subjectTimes, ([subject, times]) => (
                            <motion.div
                                key={subject}
                                variants={staggerItem}
                                className="px-4 py-2 rounded-full glass-card-elevated text-xs font-bold text-[var(--color-text)]"
                            >
                                {subject} · {hms(times.total)}
                            </motion.div>
                        ))}
                        {subjectTimes.size === 0 && (
                            <div className="text-[var(--color-text-secondary)] font-medium opacity-60 italic">
                                {isFirstVisit ? '오늘의 첫 공부를 시작해 보세요!' : '기록을 시작하면 여기에 과목별 통계가 나타납니다.'}
                            </div>
                        )}
                        {subjectTimes.size > 0 && (
                            <HelpButton
                                title="과목별 공부 시간"
                                items={[
                                    { description: '오늘 공부한 과목별 누적 시간입니다.' },
                                    { title: '총합 vs 순공', description: '총합은 강의·자습·테스트 등 모든 세션을 포함하고, 순공(자습)은 자습·테스트 타입 세션만 집계합니다.' },
                                    { title: '세부 항목', description: '공부 타이머 화면에서 세부 항목을 선택하면 더 세밀하게 분류됩니다.' },
                                ]}
                            />
                        )}
                    </motion.div>
                </div>
            </motion.section>

            {/* Main Actions — 공부 시작하기가 주된 CTA, 필요 시 설치 버튼이 옆에 붙는다 */}
            <motion.div
                variants={staggerItem}
                className={`grid gap-4 ${showAddBtn ? 'grid-cols-1 sm:grid-cols-[2fr_1fr]' : 'grid-cols-1'}`}
            >
                <Pressable
                    pressScale={0.98}
                    hoverLift
                    onClick={() => setShowModal(true)}
                    className="btn btn-primary text-xl font-black py-8 flex flex-col gap-2 group overflow-hidden relative"
                >
                    <Icon icon="mdi:play-circle-outline" className="text-4xl group-hover:scale-110 transition-transform duration-500" />
                    <span>공부 시작하기</span>
                </Pressable>

                {/* 홈 화면 추가 버튼 — 웹 브라우저에서만 표시 */}
                <AnimatePresence>
                    {showAddBtn && (
                        <motion.button
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            whileTap={{ scale: 0.98 }}
                            whileHover={{ y: -2 }}
                            transition={spring.snappy}
                            onClick={handleAddToHome}
                            className="btn btn-glass text-lg font-bold py-8 flex flex-col items-center justify-center gap-2 border border-indigo-400/30 bg-indigo-500/10 hover:bg-indigo-500/20 relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 pointer-events-none" />
                            <Icon
                                icon={addBtnIOS ? 'mdi:export-variant' : 'mdi:cellphone-arrow-down'}
                                className="text-3xl text-indigo-400 relative z-10"
                            />
                            <span className="relative z-10 text-indigo-300">홈 화면에 추가</span>
                            <span className="text-[10px] font-medium text-indigo-400/60 relative z-10 -mt-1 text-center">
                                {addBtnIOS ? 'Safari → 공유 → 홈 화면에 추가' : '앱처럼 설치하기'}
                            </span>
                        </motion.button>
                    )}
                </AnimatePresence>
            </motion.div>

            {/* 체크리스트 (오늘/이번 주/이번 달) */}
            <ChecklistCard />

            {/* 오늘의 일기 (3초 일기) */}
            <DiaryCard settings={settings} />

            {/* 매일 필수는 아니지만 항상 접근 가능한 기능들 — 접힌 상태로 시작 */}
            <HomeSection
                title="이번 주 회고"
                icon="mdi:notebook-heart"
                storageKey="home_section_weekly"
                accent="from-sky-500 to-blue-600"
            >
                <WeeklyDiaryCard settings={settings} bare />
            </HomeSection>

            <HomeSection
                title="학습 복기"
                icon="mdi:brain"
                storageKey="home_section_notes"
                accent="from-amber-500 to-orange-600"
            >
                <LearningNotesCard settings={settings} bare />
            </HomeSection>

            {/* iOS 설치 가이드 모달 */}
            <IOSInstallGuide isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />

            {/* 개발자 크레딧 */}
            <motion.div variants={staggerItem}>
                <Pressable
                    pressScale={0.98}
                    onClick={() => navigate('/developer')}
                    className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl glass-card-elevated hover:border-[var(--color-primary)]/30 transition-colors group"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                            Y
                        </div>
                        <div className="text-left">
                            <p className="text-xs font-black text-[var(--color-text-secondary)] leading-tight">개발자</p>
                            <p className="text-sm font-bold text-[var(--color-text)] leading-tight">Yoo Seung Hyeok</p>
                        </div>
                    </div>
                    <Icon icon="mdi:chevron-right" className="text-lg text-[var(--color-text-secondary)] opacity-40 group-hover:opacity-70 group-hover:translate-x-0.5 transition-all" />
                </Pressable>
            </motion.div>

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
