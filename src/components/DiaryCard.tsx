/**
 * DiaryCard.tsx — 홈 화면 "3초 일기" 카드.
 *
 * 오늘(getTodayDate) 일기의 상태를 보여준다.
 *  - 미확정: 자동 통계 + 프리셋 점수 + 승계 태그 + AI 초안을 담은 편집 폼(DiaryEditor).
 *  - 확정됨: 컴팩트 뷰(DiaryEntryView), [수정] 탭 시 편집 폼 재진입.
 * 공부 0분인 날도 통계 0으로 표시하며 작성 가능하다.
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { DiaryEntry, DiaryStats, Settings } from '../lib/db'
import {
    getTodayDate,
    getDiaryEntry,
    computeDiaryStats,
    collectSessionTags,
    getDiaryStreak,
} from '../lib/db'
import { generateDiaryDraft } from '../lib/ai/aiService'
import { DiaryEditor, DiaryEntryView } from './DiaryEditModal'
import { fadeRise } from '../lib/motion'

interface DiaryCardProps {
    settings: Settings
}

export default function DiaryCard({ settings }: DiaryCardProps) {
    const today = getTodayDate()
    const [loading, setLoading] = useState(true)
    const [entry, setEntry] = useState<DiaryEntry | undefined>(undefined)
    const [stats, setStats] = useState<DiaryStats | null>(null)
    const [inheritedTags, setInheritedTags] = useState<string[]>([])
    const [draft, setDraft] = useState('')
    const [editing, setEditing] = useState(false)
    const [streak, setStreak] = useState(0)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const [e, s, tags, st] = await Promise.all([
                getDiaryEntry(today),
                computeDiaryStats(today, settings.dailyGoalMs),
                collectSessionTags(today),
                getDiaryStreak(today),
            ])
            if (cancelled) return
            setEntry(e)
            setStats(s)
            setInheritedTags(tags)
            setStreak(st)
            setLoading(false)
            // 초안은 항상 성공(규칙 기반 폴백). 편집 진입 대비 미리 확보.
            const d = await generateDiaryDraft(settings, today, s)
            if (!cancelled) setDraft(d)
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [today])

    const reload = async () => {
        const [e, st] = await Promise.all([getDiaryEntry(today), getDiaryStreak(today)])
        setEntry(e)
        setStreak(st)
        setEditing(false)
    }

    return (
        <section className="glass-card p-5 md:p-6">
            <div className="flex items-center gap-2 mb-5 h-6">
                <Icon icon="mdi:notebook-heart-outline" className="text-[18px] text-[var(--color-text-muted)] flex-shrink-0" />
                <h2 className="text-[16px] font-medium text-[var(--color-text)]">오늘의 일기</h2>
                {streak > 0 && (
                    <span className="meta">{streak}일 연속</span>
                )}
                {entry && !editing && (
                    <span className="ml-auto text-[12px] text-[var(--color-text-muted)] flex items-center gap-1">
                        <Icon icon="mdi:check" className="text-[14px]" /> 확정됨
                    </span>
                )}
            </div>

            <AnimatePresence mode="wait">
                {loading || !stats ? (
                    <motion.div key="skeleton" variants={fadeRise} initial="initial" animate="animate" exit="exit" className="space-y-3 animate-pulse">
                        <div className="grid grid-cols-4 gap-2">
                            {[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-[var(--surface-raised)]" />)}
                        </div>
                        <div className="h-11 rounded-lg bg-[var(--surface-raised)]" />
                        <div className="h-12 rounded-2xl bg-[var(--surface-raised)]" />
                    </motion.div>
                ) : entry && !editing ? (
                    <motion.div key="entry" variants={fadeRise} initial="initial" animate="animate" exit="exit">
                        <DiaryEntryView entry={entry} onEdit={() => setEditing(true)} settings={settings} onChanged={reload} />
                    </motion.div>
                ) : (
                    <motion.div key="editor" variants={fadeRise} initial="initial" animate="animate" exit="exit">
                        <DiaryEditor
                            date={today}
                            settings={settings}
                            stats={stats}
                            existing={entry}
                            initialDraft={draft}
                            inheritedTags={inheritedTags}
                            onSaved={reload}
                            onCancel={entry ? () => setEditing(false) : undefined}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    )
}
