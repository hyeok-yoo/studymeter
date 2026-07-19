import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import {
    isFirstVisitToday,
    getTodayTotalStudyTime,
    getTodayStudyTimeBySubject,
    formatDuration,
    autoFinalizeMissedDiaries
} from '../lib/db'
import StartStudyModal from '../components/StartStudyModal'
import MorningReportCard from '../components/MorningReportCard'
import DiaryCard from '../components/DiaryCard'
import { scheduleMorningReportNotification } from '../lib/morningNotification'
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

interface HomeProps {
    settings: Settings
}

export default function Home({ settings }: HomeProps) {
    const navigate = useNavigate()
    const [isFirstVisit, setIsFirstVisit] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [todayTotal, setTodayTotal] = useState(0)
    const [subjectTimes, setSubjectTimes] = useState<Map<string, { total: number; selfStudy: number }>>(new Map())
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
        async function loadData() {
            const firstVisit = await isFirstVisitToday()
            setIsFirstVisit(firstVisit)

            const total = await getTodayTotalStudyTime()
            setTodayTotal(total)

            const bySubject = await getTodayStudyTimeBySubject()
            setSubjectTimes(bySubject)
        }
        loadData()
    }, [])

    // 지난 날짜 일기 자동 확정 + 아침 리포트 알림 예약 (마운트 1회, idempotent)
    useEffect(() => {
        autoFinalizeMissedDiaries(settings.dailyGoalMs).catch(() => { /* ignore */ })
        scheduleMorningReportNotification(settings).catch(() => { /* ignore */ })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="flex flex-col gap-10">
            {/* Header with High Contrast */}
            <header className="flex flex-col gap-2">
                <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[var(--color-text)]">
                    안녕하세요, <span className="gradient-text">{settings.userName}</span>님
                </h1>
                <p className="text-xl md:text-2xl font-semibold text-[var(--color-text-secondary)] opacity-80">
                    {randomPhrase}
                </p>
            </header>

            {/* PWA 설치 권유 배너 */}
            <PWAInstallPrompt />

            {/* 아침 브리핑 / 주간 리뷰 */}
            <MorningReportCard settings={settings} />

            {/* Hero Stats Card */}
            <section className="glass-card p-8 md:p-12 flex flex-col items-center justify-center text-center relative overflow-hidden group border-none dark:bg-white/5 bg-white/40">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full -mr-20 -mt-20"></div>

                <div className="relative z-10">
                    <div className="flex items-center justify-center gap-2 mb-6">
                        <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[var(--color-text-secondary)] opacity-60">Today's Focus Time</h2>
                        <HelpButton
                            title="오늘의 집중 시간"
                            items={[
                                { description: '오늘 완료하거나 진행 중인 모든 공부 세션의 합산 시간입니다.' },
                                { title: '자정 초기화', description: '매일 자정을 기준으로 새로운 날의 집계가 시작됩니다.' },
                                { title: '과목별 분류', description: '아래 태그에서 각 과목별 공부 시간을 한눈에 확인할 수 있습니다.' },
                            ]}
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="text-7xl md:text-9xl font-black tracking-tighter tabular-nums gradient-text">
                            {formatDuration(todayTotal)}
                        </span>
                        <div className="h-2 w-24 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] mx-auto rounded-full mt-4"></div>
                    </div>

                    <div className="flex flex-wrap justify-center gap-3 mt-10 items-center">
                        {Array.from(subjectTimes.entries()).map(([subject, times]) => (
                            <div
                                key={subject}
                                className="px-4 py-2 rounded-2xl glass-card-elevated text-xs font-bold border-none bg-white/10"
                            >
                                {subject} · {formatDuration(times.total)}
                            </div>
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
                    </div>
                </div>
            </section>

            {/* 오늘의 일기 (3초 일기) */}
            <DiaryCard settings={settings} />

            {/* Main Actions */}
            <div className={`grid gap-6 ${showAddBtn ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1 md:grid-cols-3'}`}>
                <motion.button
                    whileHover={{ scale: 1.02, translateY: -4 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowModal(true)}
                    className={`btn btn-primary text-xl font-black py-8 flex flex-col gap-2 group overflow-hidden relative ${showAddBtn ? 'col-span-2 md:col-span-1' : ''}`}
                >
                    <Icon icon="mdi:play-circle-outline" className="text-4xl group-hover:scale-125 transition-transform duration-500" />
                    <span>공부 시작하기</span>
                    <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.02, translateY: -4 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => navigate('/records')}
                    className="btn btn-glass text-lg font-bold py-8 flex flex-col gap-2 border-none bg-white/40 dark:bg-white/5 relative"
                >
                    <Icon icon="mdi:chart-bar" className="text-3xl text-indigo-400" />
                    <span>학습 기록 분석</span>
                </motion.button>

                <motion.button
                    whileHover={{ scale: 1.02, translateY: -4 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => navigate('/edit-records')}
                    className="btn btn-glass text-lg font-bold py-8 flex flex-col gap-2 border-none bg-white/40 dark:bg-white/5 relative"
                >
                    <Icon icon="mdi:pencil-outline" className="text-3xl text-purple-400" />
                    <span>학습 기록 편집</span>
                </motion.button>

                {/* 홈 화면 추가 버튼 — 웹 브라우저에서만 표시 */}
                <AnimatePresence>
                    {showAddBtn && (
                        <motion.button
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            whileHover={{ scale: 1.02, translateY: -4 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={handleAddToHome}
                            className="btn btn-glass text-lg font-bold py-8 flex flex-col gap-2 border border-indigo-400/30 bg-indigo-500/10 hover:bg-indigo-500/20 relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 pointer-events-none" />
                            <Icon
                                icon={addBtnIOS ? 'mdi:export-variant' : 'mdi:cellphone-arrow-down'}
                                className="text-3xl text-indigo-400 relative z-10"
                            />
                            <span className="relative z-10 text-indigo-300">홈 화면에 추가</span>
                            <span className="text-[10px] font-medium text-indigo-400/60 relative z-10 -mt-1">
                                {addBtnIOS ? 'Safari → 공유 → 홈 화면에 추가' : '앱처럼 설치하기'}
                            </span>
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            {/* iOS 설치 가이드 모달 */}
            <IOSInstallGuide isOpen={showIOSGuide} onClose={() => setShowIOSGuide(false)} />

            {/* 개발자 크레딧 */}
            <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigate('/developer')}
                className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 dark:bg-white/3 border border-white/10 hover:border-[var(--color-primary)]/30 transition-all group"
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
            </motion.button>

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
        </div>
    )
}
