import { useState, useEffect, useMemo, useRef } from 'react'
import { db, formatDuration, formatDateYYYYMMDD, formatDurationHourMinute, formatTimeHHMM, getMonday, getSunday, getStudyToday, getTodayDate, getDiaryRange, computeDiaryStats, collectSessionTags, getEvalScore } from '../lib/db'
import type { StudySession, DailyRecord, DiaryEntry, Settings } from '../lib/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts'
import { Icon } from '@iconify/react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpButton } from '../components/HelpButton'
import { generateDiaryDraft } from '../lib/ai/aiService'
import DiaryEditModal, { DiaryEntryView } from '../components/DiaryEditModal'
import { spring, fadeRise } from '../lib/motion'
import Pressable from '../components/ui/Pressable'

const COLORS = ['#6366f1', '#a855f7', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

// Helper: Format date in Korean
function formatDateKorean(date: Date): string {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${days[date.getDay()]}요일`
}

// Helper: Format date short
function formatDateShort(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}`
}

// Helper: Format duration change
function formatDurationChange(ms: number): string {
    const isPositive = ms >= 0
    const absMs = Math.abs(ms)
    const hours = Math.floor(absMs / 3600000)
    const minutes = Math.floor((absMs % 3600000) / 60000)

    if (hours > 0) {
        return `${isPositive ? '+' : '-'}${hours}h ${minutes}m`
    }
    return `${isPositive ? '+' : '-'}${minutes}m`
}

export default function Records() {
    const [sessions, setSessions] = useState<StudySession[]>([])
    const [prevSessions, setPrevSessions] = useState<StudySession[]>([])
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'year'>('day')
    const [offset, setOffset] = useState(0) // 0 = current, -1 = previous, 1 = next
    const [chartData, setChartData] = useState<{ name: string; 총합: number; 순공: number }[]>([])
    const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])
    const [calendarData, setCalendarData] = useState<Map<string, { total: number; selfStudy: number }>>(new Map())
    const [dailyRecord, setDailyRecord] = useState<DailyRecord | null>(null)
    const [mainTab, setMainTab] = useState<'stats' | 'diary'>('stats')

    // Calculate date range based on viewMode and offset
    const dateRange = useMemo(() => {
        const today = getStudyToday()

        if (viewMode === 'day') {
            const targetDate = new Date(today)
            targetDate.setDate(targetDate.getDate() + offset)
            const endOfDay = new Date(targetDate)
            endOfDay.setHours(23, 59, 59, 999)
            return {
                start: targetDate,
                end: endOfDay,
                startStr: formatDateYYYYMMDD(targetDate),
                endStr: formatDateYYYYMMDD(targetDate),
                label: formatDateKorean(targetDate),
                prevStartStr: formatDateYYYYMMDD(new Date(targetDate.getTime() - 86400000)),
                prevEndStr: formatDateYYYYMMDD(new Date(targetDate.getTime() - 86400000))
            }
        } else if (viewMode === 'week') {
            const monday = getMonday(today)
            monday.setDate(monday.getDate() + (offset * 7))
            const sunday = getSunday(monday)
            const prevMonday = new Date(monday)
            prevMonday.setDate(prevMonday.getDate() - 7)
            const prevSunday = getSunday(prevMonday)
            return {
                start: monday,
                end: sunday,
                startStr: formatDateYYYYMMDD(monday),
                endStr: formatDateYYYYMMDD(sunday),
                label: `${formatDateShort(monday)} ~ ${formatDateShort(sunday)}`,
                prevStartStr: formatDateYYYYMMDD(prevMonday),
                prevEndStr: formatDateYYYYMMDD(prevSunday)
            }
        } else if (viewMode === 'year') {
            return {
                start: today, end: today,
                startStr: formatDateYYYYMMDD(today), endStr: formatDateYYYYMMDD(today),
                label: '연간 기록', prevStartStr: '', prevEndStr: ''
            }
        } else {
            // Month: First day of month + offset
            const targetMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1)
            const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0)
            lastDay.setHours(23, 59, 59, 999)
            const prevMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() - 1, 1)
            const prevLastDay = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0)
            return {
                start: targetMonth,
                end: lastDay,
                startStr: formatDateYYYYMMDD(targetMonth),
                endStr: formatDateYYYYMMDD(lastDay),
                label: `${targetMonth.getFullYear()}년 ${targetMonth.getMonth() + 1}월`,
                prevStartStr: formatDateYYYYMMDD(prevMonth),
                prevEndStr: formatDateYYYYMMDD(prevLastDay)
            }
        }
    }, [viewMode, offset])

    useEffect(() => {
        async function loadData() {
            // Load current period data
            const allSessions = await db.sessions
                .where('date')
                .between(dateRange.startStr, dateRange.endStr, true, true)
                .toArray()
            setSessions(allSessions)

            // Load previous period data for comparison
            const prevData = await db.sessions
                .where('date')
                .between(dateRange.prevStartStr, dateRange.prevEndStr, true, true)
                .toArray()
            setPrevSessions(prevData)

            // Load daily record for day view
            if (viewMode === 'day') {
                const record = await db.dailyRecords.get(dateRange.startStr)
                setDailyRecord(record || null)
            } else {
                setDailyRecord(null)
            }

            // Process chart data
            const bySubject = new Map<string, { total: number; selfStudy: number }>()
            allSessions.forEach((session) => {
                const existing = bySubject.get(session.subject) || { total: 0, selfStudy: 0 }
                existing.total += session.duration
                if (session.type === '자습' || session.type === '테스트') {
                    existing.selfStudy += session.duration
                }
                bySubject.set(session.subject, existing)
            })

            const barData = Array.from(bySubject.entries()).map(([name, data]) => ({
                name,
                총합: data.total,
                순공: data.selfStudy,
                총합Label: formatDurationHourMinute(data.total),
                순공Label: formatDurationHourMinute(data.selfStudy)
            }))

            const pieDataArray = Array.from(bySubject.entries()).map(([name, data]) => ({
                name,
                value: data.total
            }))

            setChartData(barData)
            setPieData(pieDataArray)

            // Build calendar data for month view
            if (viewMode === 'month') {
                const dailyMap = new Map<string, { total: number; selfStudy: number }>()
                allSessions.forEach((session) => {
                    const existing = dailyMap.get(session.date) || { total: 0, selfStudy: 0 }
                    existing.total += session.duration
                    if (session.type === '자습' || session.type === '테스트') {
                        existing.selfStudy += session.duration
                    }
                    dailyMap.set(session.date, existing)
                })
                setCalendarData(dailyMap)
            }
        }

        loadData()
    }, [dateRange])

    // Calculate totals
    const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0)
    const selfStudyTime = sessions.filter(s => s.type === '자습' || s.type === '테스트').reduce((sum, s) => sum + s.duration, 0)

    // Previous period totals for comparison
    const prevTotalTime = prevSessions.reduce((sum, s) => sum + s.duration, 0)
    const prevSelfStudyTime = prevSessions.filter(s => s.type === '자습' || s.type === '테스트').reduce((sum, s) => sum + s.duration, 0)

    // Changes
    const totalChange = totalTime - prevTotalTime
    const selfStudyChange = selfStudyTime - prevSelfStudyTime

    const handlePrev = () => setOffset(offset - 1)
    const handleNext = () => setOffset(offset + 1)
    const handleToday = () => setOffset(0)

    return (
        <div className="animate-fade-in max-w-6xl mx-auto">
            {/* 통계 / 일기 전환 — Segmented control */}
            <div className="relative inline-flex gap-1 p-1 rounded-2xl glass-card-elevated mb-6">
                {([
                    { key: 'stats' as const, icon: 'mdi:chart-bar', label: '통계' },
                    { key: 'diary' as const, icon: 'mdi:notebook-heart-outline', label: '일기' },
                ]).map(t => {
                    const active = mainTab === t.key
                    return (
                        <button
                            key={t.key}
                            onClick={() => setMainTab(t.key)}
                            className={`relative px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${active ? 'text-white' : 'text-[var(--color-text-secondary)]'}`}
                        >
                            {active && (
                                <motion.div
                                    layoutId="mainTabIndicator"
                                    transition={spring.default}
                                    className="absolute inset-0 z-0 rounded-xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] shadow-lg shadow-indigo-500/20"
                                />
                            )}
                            <span className="relative z-10 flex items-center gap-2">
                                <Icon icon={t.icon} className="text-lg" /> {t.label}
                            </span>
                        </button>
                    )
                })}
            </div>

            <AnimatePresence mode="wait">
            {mainTab === 'diary' ? (
              <motion.div key="diary" variants={fadeRise} initial="initial" animate="animate" exit="exit">
                <DiaryTab />
              </motion.div>
            ) : (
              <motion.div key="stats" variants={fadeRise} initial="initial" animate="animate" exit="exit">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-3xl font-bold gradient-text">기록</h1>
                        <HelpButton title="학습 기록 안내" items={[
                            { description: '공부 세션 데이터를 일·주·월·연간 단위로 분석합니다.' },
                            { title: '총합 vs 순공', description: '총합은 강의·자습·테스트 모든 타입의 합계이고, 순공은 자습+테스트 타입만 집계한 실질 자기주도 학습 시간입니다.' },
                            { title: '기간 이동', description: '좌우 화살표 버튼으로 이전/다음 기간으로 이동할 수 있습니다.' },
                            { title: '월별 달력', description: '월별 보기에서는 날짜별 공부 시간을 한눈에 확인하고, 날짜를 탭하면 해당 날의 상세 기록으로 이동합니다.' },
                        ]} />
                    </div>
                    {viewMode !== 'year' && (
                        <div className="flex items-center gap-2">
                            <Pressable onClick={handlePrev} pressScale={0.9} className="p-2 rounded-xl glass-card-elevated flex items-center justify-center">
                                <Icon icon="mdi:chevron-left" className="text-xl" />
                            </Pressable>
                            <p className="text-sm text-[var(--color-text-secondary)] min-w-[150px] text-center flex items-center justify-center gap-1 tabular-nums">
                                <Icon icon="mdi:calendar" className="text-lg" /> {dateRange.label}
                            </p>
                            <Pressable onClick={handleNext} pressScale={0.9} className="p-2 rounded-xl glass-card-elevated flex items-center justify-center">
                                <Icon icon="mdi:chevron-right" className="text-xl" />
                            </Pressable>
                            <AnimatePresence>
                                {offset !== 0 && (
                                    <Pressable
                                        onClick={handleToday}
                                        pressScale={0.94}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        className="px-3 py-1.5 rounded-xl bg-[var(--color-primary)] text-white text-xs font-bold"
                                    >
                                        오늘
                                    </Pressable>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>

                {/* View Mode Toggle — Segmented control */}
                <div className="relative inline-flex gap-1 p-1 rounded-2xl glass-card-elevated self-start">
                    {([
                        { key: 'day' as const, label: '일별' },
                        { key: 'week' as const, label: '주별' },
                        { key: 'month' as const, label: '월별' },
                        { key: 'year' as const, label: '연간' },
                    ]).map(v => {
                        const active = viewMode === v.key
                        return (
                            <button
                                key={v.key}
                                onClick={() => { setViewMode(v.key); setOffset(0) }}
                                className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-colors ${active ? 'text-white' : 'text-[var(--color-text-secondary)]'}`}
                            >
                                {active && (
                                    <motion.div
                                        layoutId="viewModeIndicator"
                                        transition={spring.default}
                                        className="absolute inset-0 z-0 rounded-xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] shadow-lg shadow-indigo-500/20"
                                    />
                                )}
                                <span className="relative z-10">{v.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Annual Contribution Graph */}
            {viewMode === 'year' && <AnnualContributionGraph />}

            {/* Summary Cards with Comparison */}
            {viewMode !== 'year' && <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="glass-card p-5">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)] mb-2">총 공부 시간</p>
                    <p className="text-display text-2xl font-black tabular-nums gradient-text">{formatDuration(totalTime)}</p>
                    {prevTotalTime > 0 && (
                        <p className={`text-xs mt-1.5 font-semibold tabular-nums ${totalChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatDurationChange(totalChange)} vs 이전
                        </p>
                    )}
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-1.5 mb-2">
                        <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)]">순공 시간</p>
                        <HelpButton title="순공 시간이란?" items={[
                            { description: '자습·테스트 타입으로 공부한 시간만 합산한 값입니다.' },
                            { title: '총합과의 차이', description: '총합에는 강의 시청 시간도 포함되지만, 순공은 스스로 학습한 시간만 측정합니다. 수험생이 실질 학습 시간을 파악할 때 주로 활용합니다.' },
                        ]} />
                    </div>
                    <p className="text-display text-2xl font-black tabular-nums text-[var(--color-text)]">{formatDuration(selfStudyTime)}</p>
                    {prevSelfStudyTime > 0 && (
                        <p className={`text-xs mt-1.5 font-semibold tabular-nums ${selfStudyChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatDurationChange(selfStudyChange)} vs 이전
                        </p>
                    )}
                </div>
                <div className="glass-card p-5">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)] mb-2">세션 수</p>
                    <p className="text-display text-2xl font-black tabular-nums text-[var(--color-text)]">{sessions.length}회</p>
                </div>
                <div className="glass-card p-5">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)] mb-2">순공 비율</p>
                    <p className="text-display text-2xl font-black tabular-nums text-[var(--color-text)]">
                        {totalTime > 0 ? Math.round((selfStudyTime / totalTime) * 100) : 0}%
                    </p>
                </div>
            </div>}

            {/* Monthly Calendar View */}
            {viewMode === 'month' && (
                <div className="glass-card p-6 mb-8">
                    <h3 className="text-lg font-semibold mb-4">한 달 간벏 기록</h3>
                    <div className="grid grid-cols-7 gap-2 text-center">
                        {/* Weekday headers */}
                        {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
                            <div key={day} className={`text-xs font-bold py-2 ${day === '일' ? 'text-red-400' : day === '토' ? 'text-blue-400' : 'opacity-60'}`}>
                                {day}
                            </div>
                        ))}
                        {/* Calendar cells */}
                        {(() => {
                            const cells = []
                            const firstDay = new Date(dateRange.start)
                            const lastDay = new Date(dateRange.end)

                            // Add empty cells for days before the 1st
                            const startDayOfWeek = firstDay.getDay()
                            for (let i = 0; i < startDayOfWeek; i++) {
                                cells.push(<div key={`empty-${i}`} className="h-20"></div>)
                            }

                            // Add cells for each day of the month
                            const currentDate = new Date(firstDay)
                            while (currentDate <= lastDay) {
                                const dateStr = formatDateYYYYMMDD(currentDate)
                                const dayNum = currentDate.getDate()
                                const dayOfWeek = currentDate.getDay()
                                const data = calendarData.get(dateStr)
                                const hasData = data && data.total > 0

                                const formatShortDuration = (ms: number) => {
                                    const hours = Math.floor(ms / 3600000)
                                    const minutes = Math.floor((ms % 3600000) / 60000)
                                    if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
                                    return `${minutes}m`
                                }

                                cells.push(
                                    <div
                                        key={dateStr}
                                        onClick={() => {
                                            setViewMode('day')
                                            const today = new Date()
                                            today.setHours(0, 0, 0, 0)
                                            const diff = Math.floor((currentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                                            setOffset(diff)
                                        }}
                                        className={`h-20 rounded-xl p-1 flex flex-col items-center justify-start cursor-pointer transition-all hover:scale-105 ${hasData
                                            ? 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 hover:to-purple-500/30'
                                            : 'bg-white/5 hover:bg-white/10'
                                            } ${dayOfWeek === 0 ? 'text-red-400' : dayOfWeek === 6 ? 'text-blue-400' : ''}`}
                                    >
                                        <span className={`text-sm font-bold ${hasData ? '' : 'opacity-40'}`}>{dayNum}</span>
                                        {hasData && (
                                            <div className="mt-1 text-center">
                                                <p className="text-[10px] font-bold text-indigo-400">{formatShortDuration(data.total)}</p>
                                                <p className="text-[9px] opacity-60">{formatShortDuration(data.selfStudy)}</p>
                                            </div>
                                        )}
                                    </div>
                                )

                                currentDate.setDate(currentDate.getDate() + 1)
                            }
                            return cells
                        })()}
                    </div>
                    <div className="flex justify-center gap-6 mt-4 text-xs">
                        <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded bg-indigo-400"></div>
                            <span>총 공부</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded bg-white/40"></div>
                            <span>순공</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Charts (hide for year view) */}
            {viewMode !== 'year' && <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* Bar Chart */}
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <h3 className="text-lg font-semibold">과목별 공부 시간</h3>
                        <HelpButton title="과목별 공부 시간 차트" items={[
                            { description: '선택한 기간 동안 각 과목별 총합(파란색)과 순공(분홍색) 시간을 막대그래프로 비교합니다.' },
                            { title: '총합 (파란색)', description: '강의·자습·테스트 등 모든 학습 타입을 포함한 합계입니다.' },
                            { title: '순공 (분홍색)', description: '자습·테스트 타입만 합산한 자기주도 학습 시간입니다.' },
                        ]} />
                    </div>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} barGap={8}>
                                <XAxis dataKey="name" tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} />
                                <YAxis tick={{ fill: 'var(--color-text-secondary)', fontSize: 12 }} tickFormatter={(v) => formatDurationHourMinute(v)} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: 'var(--color-surface-elevated)',
                                        border: 'none',
                                        borderRadius: '12px',
                                        color: 'var(--color-text)'
                                    }}
                                    formatter={(value: any, name: any) => [formatDurationHourMinute(value), name === '총합' ? '합계' : '순공'] as [string, string]}
                                />
                                <Bar dataKey="총합" fill="#3b82f6" radius={[6, 6, 0, 0]}>
                                    <LabelList dataKey="총합Label" position="top" fill="#3b82f6" fontSize={10} />
                                </Bar>
                                <Bar dataKey="순공" fill="#ec4899" radius={[6, 6, 0, 0]}>
                                    <LabelList dataKey="순공Label" position="top" fill="#ec4899" fontSize={10} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex justify-center gap-6 mt-4 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-blue-500"></div>
                            <span>총합</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded bg-pink-500"></div>
                            <span>순공 (자습+테스트)</span>
                        </div>
                    </div>
                </div>

                {/* Pie Chart */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-semibold mb-4">과목별 비율</h3>
                    <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={2}
                                    dataKey="value"
                                    label={({ name }) => name}
                                >
                                    {pieData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: any) => formatDuration(value)}
                                    contentStyle={{
                                        backgroundColor: 'var(--color-surface-elevated)',
                                        border: 'none',
                                        borderRadius: '12px',
                                        color: 'var(--color-text)'
                                    }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>}

            {/* Daily Schedule (Day View Only) */}
            {viewMode === 'day' && dailyRecord && (dailyRecord.wakeUpTime || dailyRecord.arrivalTime || dailyRecord.leaveTime || dailyRecord.bedTime) && (
                <div className="glass-card p-4 mb-6">
                    <h3 className="text-sm font-bold text-[var(--color-text-secondary)] mb-3">하루 일정</h3>
                    <div className="flex flex-wrap gap-4 text-sm">
                        {dailyRecord.wakeUpTime && (
                            <div className="flex items-center gap-2">
                                <Icon icon="mdi:weather-sunset-up" className="text-xl text-orange-400" />
                                <span className="text-[var(--color-text-secondary)]">기상</span>
                                <span className="font-bold">{dailyRecord.wakeUpTime}</span>
                            </div>
                        )}
                        {dailyRecord.arrivalTime && (
                            <div className="flex items-center gap-2">
                                <Icon icon="mdi:school-outline" className="text-xl text-blue-400" />
                                <span className="text-[var(--color-text-secondary)]">등원</span>
                                <span className="font-bold">{dailyRecord.arrivalTime}</span>
                            </div>
                        )}
                        {dailyRecord.leaveTime && (
                            <div className="flex items-center gap-2">
                                <Icon icon="mdi:home-outline" className="text-xl text-green-400" />
                                <span className="text-[var(--color-text-secondary)]">하원</span>
                                <span className="font-bold">{dailyRecord.leaveTime}</span>
                            </div>
                        )}
                        {dailyRecord.bedTime && (
                            <div className="flex items-center gap-2">
                                <Icon icon="mdi:weather-night" className="text-xl text-indigo-400" />
                                <span className="text-[var(--color-text-secondary)]">취침</span>
                                <span className="font-bold">{dailyRecord.bedTime}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Recent Sessions */}
            {viewMode !== 'year' && <div className="glass-card p-6">
                <h3 className="text-lg font-semibold mb-4">최근 기록</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                    {[...sessions].sort((a, b) => b.startTime - a.startTime).slice(0, 20).map((session, i) => (
                        <motion.div
                            key={session.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ ...spring.default, delay: Math.min(i, 5) * 0.05 }}
                            className="p-4 glass-card-elevated space-y-2"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">{session.subject}</span>
                                    {session.subItem && <span className="text-[var(--color-primary)] text-sm">› {session.subItem}</span>}
                                    <span className="text-[var(--color-text-secondary)] text-xs px-2 py-0.5 rounded-full bg-white/5">{session.type}</span>
                                </div>
                                <div className="text-right">
                                    <p className="font-bold">{formatDuration(session.duration)}</p>
                                    <p className="text-[10px] text-[var(--color-text-secondary)]">{session.date}</p>
                                </div>
                            </div>
                            {/* Evaluation Badges — 신형(단일 score+tags)·구형(focus/satisfaction) 모두 지원 */}
                            {session.evaluation && (
                                <div className="flex items-center gap-3 pt-1 border-t border-white/5 flex-wrap">
                                    {getEvalScore(session.evaluation) !== null && (
                                        <div className="flex items-center gap-1.5">
                                            <Icon icon="mdi:fire" className="text-md text-orange-400" />
                                            <span className="text-[10px] text-[var(--color-text-secondary)]">점수</span>
                                            <span className="text-xs font-bold text-indigo-400">{getEvalScore(session.evaluation)}/10</span>
                                        </div>
                                    )}
                                    {(session.evaluation.tags?.length ?? 0) > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap">
                                            {session.evaluation.tags!.map(tag => (
                                                <span key={tag} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/5 text-[var(--color-text-secondary)]">{tag}</span>
                                            ))}
                                        </div>
                                    )}
                                    {session.evaluation.problemSolving && (
                                        <div className="flex items-center gap-1.5">
                                            <Icon icon="mdi:check-circle-outline" className="text-md text-green-400" />
                                            <span className="text-[10px] text-[var(--color-text-secondary)]">문제</span>
                                            <span className="text-xs font-bold text-amber-400">{session.evaluation.problemSolving.correct}/{session.evaluation.problemSolving.total}</span>
                                        </div>
                                    )}
                                    {session.evaluation.memo && (
                                        <div className="flex-1 text-xs text-[var(--color-text-secondary)] italic truncate">
                                            "{session.evaluation.memo}"
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    ))}
                    {sessions.length === 0 && (
                        <p className="text-center text-[var(--color-text-secondary)] py-8 flex items-center justify-center gap-2">
                            아직 기록이 없습니다. 공부를 시작해보세요! <Icon icon="mdi:bookshelf" className="text-xl text-indigo-400" />
                        </p>
                    )}
                </div>
            </div>}
              </motion.div>
            )}
            </AnimatePresence>
        </div>
    )
}

// ── Annual Contribution Graph ────────────────────────────────────────────────

function getContributionColor(ms: number): string {
    if (ms === 0) return 'rgba(128,128,140,0.12)'
    const h = ms / 3600000
    if (h < 2) return 'rgba(79,70,229,0.35)'
    if (h < 4) return '#312e81'
    if (h < 6) return '#4338ca'
    if (h < 9) return '#6d28d9'
    return '#a855f7'
}

function getContributionGlow(ms: number): string {
    const h = ms / 3600000
    if (h >= 9) return '0 0 8px 1px rgba(168,85,247,0.5)'
    if (h >= 6) return '0 0 5px 1px rgba(109,40,217,0.4)'
    return 'none'
}

function AnnualContributionGraph() {
    const [studyData, setStudyData] = useState<Map<string, number>>(new Map())
    const [tooltip, setTooltip] = useState<{ date: string; ms: number; col: number; row: number } | null>(null)
    const [stats, setStats] = useState({ totalDays: 0, bestStreak: 0, bestDay: { date: '', ms: 0 }, totalMs: 0, currentStreak: 0 })
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        async function load() {
            const today = getStudyToday()
            const start = new Date(today)
            start.setDate(start.getDate() - 364)
            const startStr = formatDateYYYYMMDD(start)
            const todayStr = formatDateYYYYMMDD(today)

            const allSessions = await db.sessions
                .where('date').between(startStr, todayStr, true, true).toArray()

            const data = new Map<string, number>()
            allSessions.forEach(s => data.set(s.date, (data.get(s.date) || 0) + s.duration))
            setStudyData(data)

            let totalDays = 0, bestStreak = 0, currentStreak = 0, curCurrent = 0, totalMs = 0
            let bestDay = { date: '', ms: 0 }
            const cur = new Date(start)
            while (cur <= today) {
                const dateStr = formatDateYYYYMMDD(new Date(cur))
                const ms = data.get(dateStr) || 0
                totalMs += ms
                if (ms > 0) {
                    totalDays++
                    currentStreak++
                    curCurrent++
                    if (currentStreak > bestStreak) bestStreak = currentStreak
                    if (ms > bestDay.ms) bestDay = { date: dateStr, ms }
                } else {
                    currentStreak = 0
                    if (cur < today) curCurrent = 0
                }
                cur.setDate(cur.getDate() + 1)
            }
            setStats({ totalDays, bestStreak, bestDay, totalMs, currentStreak: curCurrent })
        }
        load()
    }, [])

    const today = getStudyToday()
    const gridStart = new Date(today)
    gridStart.setDate(gridStart.getDate() - 364)
    const monday = getMonday(gridStart)

    // Build week columns
    const weeks: Array<Array<{ date: string; ms: number; valid: boolean }>> = []
    const monthLabels: Array<{ label: string; colIdx: number }> = []
    let lastMonth = -1
    const cur2 = new Date(monday)

    while (cur2 <= today) {
        const col: { date: string; ms: number; valid: boolean }[] = []
        for (let d = 0; d < 7; d++) {
            const dateStr = formatDateYYYYMMDD(new Date(cur2))
            const valid = cur2 >= gridStart && cur2 <= today
            if (valid && cur2.getMonth() !== lastMonth) {
                monthLabels.push({ label: `${cur2.getMonth() + 1}월`, colIdx: weeks.length })
                lastMonth = cur2.getMonth()
            }
            col.push({ date: dateStr, ms: studyData.get(dateStr) || 0, valid })
            cur2.setDate(cur2.getDate() + 1)
        }
        weeks.push(col)
    }

    const CELL = 13, GAP = 3, STEP = CELL + GAP
    const DAY_LABELS = ['월', '', '수', '', '금', '', '일']
    const formatDateKo = (dateStr: string) => {
        const d = new Date(dateStr + 'T00:00:00')
        return `${d.getMonth() + 1}월 ${d.getDate()}일`
    }
    const formatHourMin = (ms: number) => {
        const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
        if (h > 0) return `${h}h ${m}m`
        return `${m}m`
    }

    return (
        <div className="space-y-6">
            {/* Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">공부한 날</p>
                    <p className="text-display text-3xl font-black tabular-nums gradient-text">{stats.totalDays}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">최장 연속</p>
                    <p className="text-display text-3xl font-black tabular-nums" style={{ color: '#a855f7' }}>{stats.bestStreak}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">현재 연속</p>
                    <p className="text-display text-3xl font-black tabular-nums" style={{ color: stats.currentStreak > 0 ? '#22c55e' : 'var(--color-text-secondary)' }}>{stats.currentStreak}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">연간 총합</p>
                    <p className="text-display text-2xl font-black tabular-nums text-indigo-400">{Math.floor(stats.totalMs / 3600000)}<span className="text-base font-bold opacity-60">h</span></p>
                </div>
            </div>

            {/* Contribution Grid */}
            <div className="glass-card p-6 relative overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">연간 공부 기록</h3>
                    {stats.bestDay.date && (
                        <span className="text-xs text-[var(--color-text-secondary)]">
                            최고 <span className="text-purple-400 font-bold">{formatDateKo(stats.bestDay.date)}</span> · {formatHourMin(stats.bestDay.ms)}
                        </span>
                    )}
                </div>

                <div className="overflow-x-auto pb-2" ref={containerRef}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                        {/* Month labels */}
                        <div style={{ display: 'flex', marginLeft: '24px', marginBottom: '4px', height: '16px', position: 'relative', width: `${weeks.length * STEP}px` }}>
                            {monthLabels.map(({ label, colIdx }) => (
                                <span key={label + colIdx} style={{
                                    position: 'absolute', left: `${colIdx * STEP}px`,
                                    fontSize: '10px', fontWeight: 700, color: 'var(--color-text-secondary)',
                                    whiteSpace: 'nowrap'
                                }}>{label}</span>
                            ))}
                        </div>

                        {/* Grid */}
                        <div style={{ display: 'flex', gap: `${GAP}px` }}>
                            {/* Day labels */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px`, marginTop: '1px' }}>
                                {DAY_LABELS.map((label, i) => (
                                    <div key={i} style={{ width: '16px', height: `${CELL}px`, fontSize: '9px', fontWeight: 700, color: 'var(--color-text-secondary)', opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                                        {label}
                                    </div>
                                ))}
                            </div>

                            {/* Week columns */}
                            {weeks.map((week, wi) => (
                                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px` }}>
                                    {week.map((cell, di) => (
                                        <div
                                            key={di}
                                            onMouseEnter={() => cell.valid ? setTooltip({ date: cell.date, ms: cell.ms, col: wi, row: di }) : null}
                                            onMouseLeave={() => setTooltip(null)}
                                            onClick={() => cell.valid ? setTooltip(tooltip?.date === cell.date ? null : { date: cell.date, ms: cell.ms, col: wi, row: di }) : null}
                                            style={{
                                                width: `${CELL}px`, height: `${CELL}px`,
                                                borderRadius: '3px',
                                                background: cell.valid ? getContributionColor(cell.ms) : 'transparent',
                                                boxShadow: cell.valid ? getContributionGlow(cell.ms) : 'none',
                                                cursor: cell.valid ? 'pointer' : 'default',
                                                transition: 'transform 0.1s, box-shadow 0.1s',
                                            }}
                                            onMouseOver={e => { if (cell.valid && cell.ms > 0) (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.3)' }}
                                            onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>

                        {/* Tooltip */}
                        {tooltip && (
                            <div style={{
                                position: 'absolute',
                                left: `${24 + tooltip.col * STEP + STEP / 2}px`,
                                top: `${tooltip.row * STEP + 16}px`,
                                transform: 'translate(-50%, -110%)',
                                background: 'rgba(0,0,0,0.85)',
                                backdropFilter: 'blur(12px)',
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: '10px',
                                padding: '8px 12px',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: 'white',
                                whiteSpace: 'nowrap',
                                zIndex: 10,
                                pointerEvents: 'none',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            }}>
                                <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '2px' }}>{formatDateKo(tooltip.date)}</div>
                                <div style={{ color: tooltip.ms > 0 ? '#a855f7' : 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
                                    {tooltip.ms > 0 ? formatHourMin(tooltip.ms) : '공부 없음'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', opacity: 0.7, marginRight: '4px' }}>적음</span>
                    {[0, 3600000, 7200000 * 2, 3600000 * 6, 3600000 * 9].map((ms, i) => (
                        <div key={i} style={{
                            width: `${CELL}px`, height: `${CELL}px`, borderRadius: '3px',
                            background: getContributionColor(ms),
                            boxShadow: getContributionGlow(ms)
                        }} />
                    ))}
                    <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)', opacity: 0.7, marginLeft: '4px' }}>많음</span>
                </div>
            </div>
        </div>
    )
}

// ── 일기 탭 ───────────────────────────────────────────────────────────────────

function diaryMonthLabel(date: string): string {
    const [y, m] = date.split('-')
    return `${y}년 ${parseInt(m)}월`
}

function DiaryTab() {
    const [settings, setSettings] = useState<Settings | null>(null)
    const [diaries, setDiaries] = useState<DiaryEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState<string | null>(null)

    const reload = async () => {
        const today = getStudyToday()
        const start = new Date(today)
        start.setDate(start.getDate() - 365)
        const list = await getDiaryRange(formatDateYYYYMMDD(start), getTodayDate())
        list.sort((a, b) => b.date.localeCompare(a.date))
        setDiaries(list)
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const s = await db.settings.toCollection().first()
            if (!cancelled) setSettings(s ?? null)
            await reload()
            if (!cancelled) setLoading(false)
        })()
        return () => { cancelled = true }
    }, [])

    // 월 구분 헤더용 그룹핑
    const grouped: Array<{ month: string; items: DiaryEntry[] }> = []
    for (const d of diaries) {
        const month = diaryMonthLabel(d.date)
        const last = grouped[grouped.length - 1]
        if (last && last.month === month) last.items.push(d)
        else grouped.push({ month, items: [d] })
    }

    const selected = diaries.find(d => d.date === selectedDate) ?? null
    let renderIndex = 0

    if (loading) {
        return (
            <div className="space-y-3 animate-pulse">
                {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl bg-white/5" />)}
            </div>
        )
    }

    if (diaries.length === 0) {
        return (
            <div className="glass-card p-10 text-center text-[var(--color-text-secondary)]">
                <Icon icon="mdi:notebook-outline" className="text-4xl mx-auto mb-3 opacity-40" />
                <p className="font-medium">아직 작성된 일기가 없습니다.</p>
                <p className="text-sm opacity-60 mt-1">홈 화면에서 오늘 일기를 확정해 보세요.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {grouped.map(group => (
                <div key={group.month} className="space-y-2">
                    <h3 className="text-sm font-black text-[var(--color-text-secondary)] px-1">{group.month}</h3>
                    <div className="space-y-2">
                        {group.items.map(entry => {
                          const idx = renderIndex++
                          return (
                            <motion.div
                                key={entry.date}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ ...spring.default, delay: Math.min(idx, 5) * 0.05 }}
                            >
                              <Pressable
                                onClick={() => setSelectedDate(entry.date)}
                                pressScale={0.99}
                                className="w-full text-left glass-card p-4 block"
                              >
                                <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-center justify-center w-12 flex-shrink-0">
                                        <span className="text-xl font-black gradient-text tabular-nums">{entry.score}</span>
                                        <span className="text-[9px] font-bold text-[var(--color-text-secondary)]/70">/ 10</span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-bold text-[var(--color-text-secondary)]">{entry.date}</span>
                                            {entry.auto && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/10 text-[9px] font-bold text-[var(--color-text-secondary)]">자동</span>
                                            )}
                                        </div>
                                        {entry.oneLiner && (
                                            <p className="text-sm font-semibold text-[var(--color-text)] truncate">"{entry.oneLiner}"</p>
                                        )}
                                        {entry.dayTags.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                {entry.dayTags.slice(0, 4).map(t => (
                                                    <span key={t} className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 text-[10px] font-bold">{t}</span>
                                                ))}
                                                {entry.dayTags.length > 4 && (
                                                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)]/70">+{entry.dayTags.length - 4}</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <Icon icon="mdi:chevron-right" className="text-lg text-[var(--color-text-secondary)]/50 flex-shrink-0" />
                                </div>
                              </Pressable>
                            </motion.div>
                          )
                        })}
                    </div>
                </div>
            ))}

            {selected && settings && (
                <DiaryDetailModal
                    entry={selected}
                    settings={settings}
                    onClose={() => setSelectedDate(null)}
                    onEdited={reload}
                />
            )}
        </div>
    )
}

function DiaryDetailModal({ entry, settings, onClose, onEdited }: {
    entry: DiaryEntry
    settings: Settings
    onClose: () => void
    onEdited: () => void | Promise<void>
}) {
    const [sessions, setSessions] = useState<StudySession[]>([])
    const [editing, setEditing] = useState(false)
    const [editData, setEditData] = useState<{ stats: DiaryEntry['stats']; draft: string; inheritedTags: string[] } | null>(null)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const list = await db.sessions.where('date').equals(entry.date).sortBy('startTime')
            if (!cancelled) setSessions(list)
        })()
        return () => { cancelled = true }
    }, [entry.date])

    const openEditor = async () => {
        const stats = await computeDiaryStats(entry.date, settings.dailyGoalMs)
        const [draft, inheritedTags] = await Promise.all([
            generateDiaryDraft(settings, entry.date, stats),
            collectSessionTags(entry.date),
        ])
        setEditData({ stats, draft, inheritedTags })
        setEditing(true)
    }

    return (
        <>
            <AnimatePresence>
                {!editing && (
                    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 sm:p-6">
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/70 backdrop-blur-xl"
                            onClick={onClose}
                        />
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 30 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 30 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                            className="relative w-full max-w-lg liquid-modal shadow-2xl overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent" />
                            <div className="relative p-8 space-y-6 max-h-[85vh] overflow-y-auto no-scrollbar">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xl font-black text-[var(--color-text)]">{entry.date}</h2>
                                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/10 transition-all">
                                        <Icon icon="mdi:close" className="text-xl text-[var(--color-text-secondary)]" />
                                    </button>
                                </div>

                                {entry.oneLiner && (
                                    <p className="text-lg font-bold text-[var(--color-text)] leading-relaxed">"{entry.oneLiner}"</p>
                                )}

                                <DiaryEntryView entry={entry} onEdit={openEditor} settings={settings} onChanged={onEdited} />

                                {/* 세션 타임라인 */}
                                {sessions.length > 0 && (
                                    <div className="space-y-2 pt-2 border-t border-white/10">
                                        <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)] pt-2">세션 타임라인</p>
                                        {sessions.map(s => {
                                            const sc = getEvalScore(s.evaluation)
                                            return (
                                                <div key={s.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/5">
                                                    <span className="text-xs font-bold text-[var(--color-text-secondary)] tabular-nums mt-0.5 flex-shrink-0">{formatTimeHHMM(s.startTime)}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="text-sm font-bold text-[var(--color-text)]">{s.subject}</span>
                                                            {s.subItem && <span className="text-xs text-[var(--color-primary)]">› {s.subItem}</span>}
                                                            <span className="text-[10px] text-[var(--color-text-secondary)]">{formatDurationHourMinute(s.duration)}</span>
                                                            {sc !== null && (
                                                                <span className="text-[10px] font-bold text-indigo-400">{sc}/10</span>
                                                            )}
                                                        </div>
                                                        {s.evaluation?.tags && s.evaluation.tags.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {s.evaluation.tags.map(t => (
                                                                    <span key={t} className="px-1.5 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/10 text-[9px] font-bold text-[var(--color-text-secondary)]">{t}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {s.evaluation?.memo && (
                                                            <p className="text-xs text-[var(--color-text-secondary)] italic mt-1 truncate">"{s.evaluation.memo}"</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {editing && editData && (
                <DiaryEditModal
                    isOpen={editing}
                    onClose={() => setEditing(false)}
                    date={entry.date}
                    settings={settings}
                    stats={editData.stats}
                    existing={entry}
                    initialDraft={editData.draft}
                    inheritedTags={editData.inheritedTags}
                    onSaved={async () => { await onEdited(); setEditing(false) }}
                />
            )}
        </>
    )
}
