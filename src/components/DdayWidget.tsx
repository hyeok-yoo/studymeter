/**
 * DdayWidget.tsx — 홈 화면 상단 D-day 위젯.
 *
 * settings.ddays (없으면 기본 프리셋)를 가까운 미래 순으로 정렬해 보여준다.
 * 지난 D-day는 흐리게 처리하고 뒤로 보낸다. 항상 보이는 컴팩트 카드 형태.
 */
import { motion } from 'framer-motion'
import type { Settings, Dday } from '../lib/db'
import { getDefaultDdays, getDdayDiff, formatDday } from '../lib/db'
import { toDate } from '../lib/format'
import { staggerContainer, staggerItem } from '../lib/motion'

interface DdayWidgetProps {
    settings: Settings
}

// 수치 색 — 당일·임박만 액센트, 나머지는 본문색, 지난 것은 흐리게
function toneFor(diff: number): string {
    if (diff >= 0 && diff <= 7) return 'text-[var(--color-primary)]'
    if (diff > 0) return 'text-[var(--color-text)]'
    return 'text-[var(--color-text-muted)]'
}

// 목표일은 "2026.08.02" 점 구분 표기 — lib/format 의 ymd 는 하이픈이라 대체 불가.
// 파싱(로컬 자정 고정)만 toDate 로 맞춘다.
function formatTargetDate(date: string): string {
    const d = toDate(date)
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
        <motion.section variants={staggerItem} className="flex flex-col gap-2">
            <h2 className="px-0.5 text-[14px] font-medium text-[var(--color-text-secondary)]">D-day</h2>
            <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 md:mx-0 md:px-0 xl:grid xl:grid-cols-2 xl:overflow-visible"
            >
                {sorted.map((d) => {
                    const diff = getDdayDiff(d.date)
                    const isPast = diff < 0
                    return (
                        <motion.div
                            key={d.id}
                            variants={staggerItem}
                            className={`glass-card flex-shrink-0 min-w-[152px] px-5 py-4 rounded-[22px] ${isPast ? 'opacity-60' : ''}`}
                        >
                            <div className="flex items-center gap-1.5 h-5">
                                {d.emoji && <span className="text-[13px] leading-none grayscale opacity-70">{d.emoji}</span>}
                                <span className="text-[13px] text-[var(--color-text-secondary)] truncate">{d.label}</span>
                            </div>
                            <div className={`mt-1.5 text-[24px] leading-none font-medium tabular-nums ${toneFor(diff)}`}>
                                {formatDday(diff)}
                            </div>
                            <p className="meta mt-2">
                                {formatTargetDate(d.date)}
                            </p>
                        </motion.div>
                    )
                })}
            </motion.div>
        </motion.section>
    )
}
