import { useState, useEffect, useMemo } from 'react'
import { db, formatDuration, formatDateYYYYMMDD, formatDurationHourMinute, getMonday, getSunday, getStudyToday } from '../lib/db'
import type { StudySession, DailyRecord } from '../lib/db'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts'
import { Icon } from '@iconify/react'

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
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day')
    const [offset, setOffset] = useState(0) // 0 = current, -1 = previous, 1 = next
    const [chartData, setChartData] = useState<{ name: string; 총합: number; 순공: number }[]>([])
    const [pieData, setPieData] = useState<{ name: string; value: number }[]>([])
    const [calendarData, setCalendarData] = useState<Map<string, { total: number; selfStudy: number }>>(new Map())
    const [dailyRecord, setDailyRecord] = useState<DailyRecord | null>(null)

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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex flex-col gap-1">
                    <h1 className="text-3xl font-bold gradient-text">기록</h1>
                    <div className="flex items-center gap-2">
                        <button onClick={handlePrev} className="p-2 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] transition-all flex items-center justify-center">
                            <Icon icon="mdi:chevron-left" className="text-xl" />
                        </button>
                        <p className="text-sm text-[var(--color-text-secondary)] min-w-[150px] text-center flex items-center justify-center gap-1">
                            <Icon icon="mdi:calendar" className="text-lg" /> {dateRange.label}
                        </p>
                        <button onClick={handleNext} className="p-2 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] transition-all flex items-center justify-center">
                            <Icon icon="mdi:chevron-right" className="text-xl" />
                        </button>
                        {offset !== 0 && (
                            <button onClick={handleToday} className="px-3 py-1 rounded-lg bg-[var(--color-primary)] text-white text-xs font-bold">
                                오늘
                            </button>
                        )}
                    </div>
                </div>

                {/* View Mode Toggle */}
                <div className="flex gap-2">
                    <button
                        onClick={() => { setViewMode('day'); setOffset(0) }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${viewMode === 'day'
                            ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                            : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                            }`}
                    >
                        일별
                    </button>
                    <button
                        onClick={() => { setViewMode('week'); setOffset(0) }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${viewMode === 'week'
                            ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                            : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                            }`}
                    >
                        주별
                    </button>
                    <button
                        onClick={() => { setViewMode('month'); setOffset(0) }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${viewMode === 'month'
                            ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                            : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                            }`}
                    >
                        월별
                    </button>
                </div>
            </div>

            {/* Summary Cards with Comparison */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">총 공부 시간</p>
                    <p className="text-2xl font-bold gradient-text">{formatDuration(totalTime)}</p>
                    {prevTotalTime > 0 && (
                        <p className={`text-xs mt-1 ${totalChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatDurationChange(totalChange)} vs 이전
                        </p>
                    )}
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">순공 시간</p>
                    <p className="text-2xl font-bold">{formatDuration(selfStudyTime)}</p>
                    {prevSelfStudyTime > 0 && (
                        <p className={`text-xs mt-1 ${selfStudyChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatDurationChange(selfStudyChange)} vs 이전
                        </p>
                    )}
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">세션 수</p>
                    <p className="text-2xl font-bold">{sessions.length}회</p>
                </div>
                <div className="glass-card p-4">
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">순공 비율</p>
                    <p className="text-2xl font-bold">
                        {totalTime > 0 ? Math.round((selfStudyTime / totalTime) * 100) : 0}%
                    </p>
                </div>
            </div>

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

            {/* Charts (hide bar for month view) */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
                {/* Bar Chart */}
                <div className="glass-card p-6">
                    <h3 className="text-lg font-semibold mb-4">과목별 공부 시간</h3>
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
            </div>

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
            <div className="glass-card p-6">
                <h3 className="text-lg font-semibold mb-4">최근 기록</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto stagger-children">
                    {[...sessions].sort((a, b) => b.startTime - a.startTime).slice(0, 20).map((session) => (
                        <div key={session.id} className="p-4 bg-[var(--color-surface)] rounded-xl space-y-2">
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
                            {/* Evaluation Badges */}
                            {session.evaluation && (
                                <div className="flex items-center gap-3 pt-1 border-t border-white/5">
                                    <div className="flex items-center gap-1.5">
                                        <Icon icon="mdi:fire" className="text-md text-orange-400" />
                                        <span className="text-[10px] text-[var(--color-text-secondary)]">집중</span>
                                        <span className="text-xs font-bold text-indigo-400">{session.evaluation.focus}/10</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <Icon icon="mdi:diamond-stone" className="text-md text-cyan-400" />
                                        <span className="text-[10px] text-[var(--color-text-secondary)]">만족</span>
                                        <span className="text-xs font-bold text-emerald-400">{session.evaluation.satisfaction}/10</span>
                                    </div>
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
                        </div>
                    ))}
                    {sessions.length === 0 && (
                        <p className="text-center text-[var(--color-text-secondary)] py-8 flex items-center justify-center gap-2">
                            아직 기록이 없습니다. 공부를 시작해보세요! <Icon icon="mdi:bookshelf" className="text-xl text-indigo-400" />
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
