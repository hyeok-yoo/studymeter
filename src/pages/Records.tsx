import { useState, useEffect, useMemo, useRef } from 'react'
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
    const [viewMode, setViewMode] = useState<'day' | 'week' | 'month' | 'year'>('day')
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex flex-col gap-1">
                    <h1 className="text-3xl font-bold gradient-text">기록</h1>
                    {viewMode !== 'year' && (
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
                    )}
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
                    <button
                        onClick={() => { setViewMode('year'); setOffset(0) }}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${viewMode === 'year'
                            ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                            : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                            }`}
                    >
                        연간
                    </button>
                </div>
            </div>

            {/* Annual Contribution Graph */}
            {viewMode === 'year' && <AnnualContributionGraph />}

            {/* Summary Cards with Comparison */}
            {viewMode !== 'year' && <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
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
            </div>}
        </div>
    )
}

// ── Annual Contribution Graph ────────────────────────────────────────────────

function getContributionColor(ms: number): string {
    if (ms === 0) return 'rgba(255,255,255,0.06)'
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
                    <p className="text-3xl font-black gradient-text">{stats.totalDays}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">최장 연속</p>
                    <p className="text-3xl font-black" style={{ color: '#a855f7' }}>{stats.bestStreak}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">현재 연속</p>
                    <p className="text-3xl font-black" style={{ color: stats.currentStreak > 0 ? '#22c55e' : 'rgba(255,255,255,0.3)' }}>{stats.currentStreak}<span className="text-base font-bold opacity-60">일</span></p>
                </div>
                <div className="glass-card p-4 text-center">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1 uppercase tracking-widest font-bold">연간 총합</p>
                    <p className="text-2xl font-black text-indigo-400">{Math.floor(stats.totalMs / 3600000)}<span className="text-base font-bold opacity-60">h</span></p>
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
                                    fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                                    whiteSpace: 'nowrap'
                                }}>{label}</span>
                            ))}
                        </div>

                        {/* Grid */}
                        <div style={{ display: 'flex', gap: `${GAP}px` }}>
                            {/* Day labels */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: `${GAP}px`, marginTop: '1px' }}>
                                {DAY_LABELS.map((label, i) => (
                                    <div key={i} style={{ width: '16px', height: `${CELL}px`, fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
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
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginRight: '4px' }}>적음</span>
                    {[0, 3600000, 7200000 * 2, 3600000 * 6, 3600000 * 9].map((ms, i) => (
                        <div key={i} style={{
                            width: `${CELL}px`, height: `${CELL}px`, borderRadius: '3px',
                            background: getContributionColor(ms),
                            boxShadow: getContributionGlow(ms)
                        }} />
                    ))}
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>많음</span>
                </div>
            </div>
        </div>
    )
}
