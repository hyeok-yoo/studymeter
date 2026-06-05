import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import {
    isFirstVisitToday,
    getTodayTotalStudyTime,
    getTodayStudyTimeBySubject,
    formatDuration
} from '../lib/db'
import StartStudyModal from '../components/StartStudyModal'
import PWAInstallPrompt from '../components/PWAInstallPrompt'
import { HelpButton } from '../components/HelpButton'
import { HOME_PHRASES, getRandomPhrase } from '../lib/phrases'

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

            {/* Main Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <motion.button
                    whileHover={{ scale: 1.02, translateY: -4 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowModal(true)}
                    className="btn btn-primary text-xl font-black py-8 flex flex-col gap-2 group overflow-hidden relative"
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
            </div>

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
