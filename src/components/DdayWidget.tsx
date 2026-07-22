/**
 * DdayWidget.tsx — 홈 화면 상단 D-day 위젯.
 *
 * settings.ddays (없으면 기본 프리셋)를 가까운 미래 순으로 정렬해 보여준다.
 * 지난 D-day는 흐리게 처리하고 뒤로 보낸다. 항상 보이는 컴팩트 카드 형태.
 */
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, Dday } from '../lib/db'
import { getDefaultDdays, getDdayDiff, formatDday } from '../lib/db'
import { staggerContainer, staggerItem } from '../lib/motion'

interface DdayWidgetProps {
    settings: Settings
}

// 카드 하나의 강조 색 — 당일/임박/일반/지남 순으로 구분
function accentFor(diff: number): { text: string; bg: string; border: string } {
    if (diff === 0) return { text: 'text-white', bg: 'bg-gradient-to-br from-rose-500 to-orange-500', border: 'border-transparent' }
    if (diff > 0 && diff <= 7) return { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-400/25' }
    if (diff > 0) return { text: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-400/20' }
    return { text: 'text-[var(--color-text-secondary)]', bg: 'bg-black/[0.03] dark:bg-white/5', border: 'border-white/10' }
}

function formatTargetDate(date: string): string {
    const d = new Date(date + 'T00:00:00')
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function DdayWidget({ settings }: DdayWidgetProps) {
    const ddays: Dday[] = settings.ddays ?? getDefaultDdays()

    // 미래(0 포함) 오름차순 우선, 지난 것은 뒤로(최근 지남이 먼저)
    const sorted = [...ddays].sort((a, b) => {
        const da = getDdayDiff(a.date)
        const db = getDdayDiff(b.date)
        const aPast = da < 0
        const bPast = db < 0
        if (aPast !== bPast) return aPast ? 1 : -1
        if (aPast) return db - da // 지남: 최근 지난 것 먼저
        return da - db // 미래: 가까운 것 먼저
    })

    if (sorted.length === 0) return null

    return (
        <motion.section variants={staggerItem} className="space-y-2.5">
            <div className="flex items-center gap-2 px-1.5">
                <Icon icon="mdi:calendar-star" className="text-base text-[var(--color-primary)]" />
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-text-secondary)] opacity-70">D-day</h2>
            </div>
            <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1"
            >
                {sorted.map((d) => {
                    const diff = getDdayDiff(d.date)
                    const isPast = diff < 0
                    const accent = accentFor(diff)
                    return (
                        <motion.div
                            key={d.id}
                            variants={staggerItem}
                            className={`glass-card-elevated flex-shrink-0 min-w-[9.5rem] px-4 py-3.5 rounded-2xl border ${accent.border} ${isPast ? 'opacity-50' : ''}`}
                        >
                            <div className="flex items-center gap-1.5 mb-2">
                                <span className="text-base leading-none">{d.emoji || '📌'}</span>
                                <span className="text-xs font-bold text-[var(--color-text)] truncate">{d.label}</span>
                            </div>
                            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-black tabular-nums ${accent.bg} ${accent.text}`}>
                                {formatDday(diff)}
                            </div>
                            <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60 mt-1.5 font-medium">
                                {formatTargetDate(d.date)}
                            </p>
                        </motion.div>
                    )
                })}
            </motion.div>
        </motion.section>
    )
}
