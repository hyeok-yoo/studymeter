/**
 * WeeklyDiaryCard.tsx — 홈 화면 "이번 주 회고" 카드. 항상 노출된다.
 *
 * 주로 일요일 밤/월요일 아침에 한 주를 돌아보라는 취지지만 언제든 작성·수정 가능.
 * AI 호출 없이 단순 텍스트 + 선택 점수만 저장한다.
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, WeeklyDiary } from '../lib/db'
import { getWeekKey, getWeeklyDiary, saveWeeklyDiary, getSunday } from '../lib/db'
import { toDate } from '../lib/format'
import Pressable from './ui/Pressable'
import { fadeRise, staggerItem, spring } from '../lib/motion'

interface WeeklyDiaryCardProps {
    settings: Settings
    /** true면 외곽 glass-card 래퍼와 헤더(아이콘+제목) 없이 내용만 렌더링 (HomeSection 안에서 사용) */
    bare?: boolean
}

// "8.3 (월) ~ 8.9 (일)" — lib/format 의 koDate 에 대응하는 표기가 없어 여기 남긴다.
// 파싱(로컬 자정 고정)만 toDate 로 맞춘다.
function formatRange(weekStart: string): string {
    const monday = toDate(weekStart)
    const sunday = getSunday(monday)
    const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`
    return `${fmt(monday)} (월) ~ ${fmt(sunday)} (일)`
}

export default function WeeklyDiaryCard({ settings, bare = false }: WeeklyDiaryCardProps) {
    const aiReady = !!settings.geminiApiKey
    const weekStart = getWeekKey()
    const [loading, setLoading] = useState(true)
    const [content, setContent] = useState('')
    const [score, setScore] = useState<number | undefined>(undefined)
    const [existing, setExisting] = useState<WeeklyDiary | undefined>(undefined)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const entry = await getWeeklyDiary(weekStart)
            if (cancelled) return
            setExisting(entry)
            setContent(entry?.content ?? '')
            setScore(entry?.score)
            setLoading(false)
        })()
        return () => { cancelled = true }
    }, [weekStart])

    const handleSave = async () => {
        if (saving) return
        setSaving(true)
        try {
            const now = Date.now()
            const entry: WeeklyDiary = {
                weekStart,
                content: content.trim() || undefined,
                score,
                aiReply: existing?.aiReply,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            }
            await saveWeeklyDiary(entry)
            setExisting(entry)
            setSaved(true)
            setTimeout(() => setSaved(false), 1800)
        } finally {
            setSaving(false)
        }
    }

    const content_ = (
        <>
            {!bare && (
                <div className="flex items-center gap-2 mb-1.5">
                    <Icon icon="mdi:book-open-variant-outline" className="text-[18px] text-[var(--color-text-muted)] flex-shrink-0" />
                    <h2 className="text-[16px] font-medium text-[var(--color-text)]">이번 주 회고</h2>
                    {existing?.content && (
                        <span className="ml-auto text-[12px] text-[var(--color-text-muted)] flex items-center gap-1">
                            <Icon icon="mdi:check-circle" className="text-sm" /> 작성됨
                        </span>
                    )}
                </div>
            )}
            {bare && existing?.content && (
                <div className="flex justify-end mb-1.5">
                    <span className="text-[12px] text-[var(--color-text-muted)] flex items-center gap-1">
                        <Icon icon="mdi:check-circle" className="text-sm" /> 작성됨
                    </span>
                </div>
            )}
            <p className="text-xs text-[var(--color-text-secondary)] opacity-70 mb-1">{formatRange(weekStart)}</p>
            <p className="text-[11px] text-[var(--color-text-secondary)] opacity-50 mb-4 not-italic">
                주로 일요일 밤이나 월요일 아침에 쓰지만, 언제든 자유롭게 남길 수 있어요.
                {aiReady && ' AI가 다음에 확인할 때 답장을 남길 수도 있어요.'}
            </p>

            {loading ? (
                <div className="space-y-3 animate-pulse">
                    <div className="h-24 rounded-2xl bg-[var(--surface-raised)]" />
                    <div className="h-10 rounded-xl bg-[var(--surface-raised)]" />
                </div>
            ) : (
                <div className="space-y-4">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="이번 주는 어땠나요? 잘한 점, 아쉬운 점, 다음 주 다짐 등 자유롭게 적어보세요."
                        rows={4}
                        className="w-full px-4 py-3.5 rounded-2xl bg-[var(--surface-raised)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/40 resize-none outline-none focus:border-[var(--color-primary)] focus:bg-black/[0.05] dark:focus:bg-white/[0.08] transition-[color,background-color,border-color,opacity,transform] text-sm leading-relaxed"
                    />

                    <div className="space-y-2">
                        <p className="text-[11px] font-bold text-[var(--color-text-secondary)] tracking-wider opacity-60">이번 주 점수 (선택)</p>
                        <div className="flex flex-wrap gap-1.5">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                                const active = score === n
                                return (
                                    <motion.button
                                        key={n}
                                        type="button"
                                        onClick={() => setScore(active ? undefined : n)}
                                        whileTap={{ scale: 0.97 }}
                                        transition={spring.snappy}
                                        className={`w-9 h-9 rounded-lg text-xs font-black flex-shrink-0 ${active
                                            ? 'fill-ink'
                                            : 'bg-[var(--surface-raised)] text-[var(--color-text-secondary)]/70 hover:bg-black/[0.08] dark:hover:bg-[var(--surface-raised)]'
                                            }`}
                                    >
                                        {n}
                                    </motion.button>
                                )
                            })}
                        </div>
                    </div>

                    {existing?.aiReply && (
                        <div className="p-4 rounded-2xl bg-[var(--surface-raised)] border border-[var(--color-border)]">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Icon icon="mdi:message-reply-text-outline" className="text-[14px] text-[var(--color-text-muted)]" />
                                <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">AI 답장</span>
                            </div>
                            <p className="text-sm text-[var(--color-text)]/90 leading-relaxed whitespace-pre-wrap">{existing.aiReply}</p>
                        </div>
                    )}

                    <div className="flex justify-end">
                        <Pressable
                            onClick={handleSave}
                            disabled={saving}
                            pressScale={0.96}
                            className="px-6 btn btn-primary h-12 text-[15px] disabled:opacity-60 flex items-center gap-2"
                        >
                            <AnimatePresence mode="wait" initial={false}>
                                {saved ? (
                                    <motion.span key="saved" variants={fadeRise} initial="initial" animate="animate" exit="exit" className="flex items-center gap-2">
                                        <Icon icon="mdi:check-bold" className="text-base" /> 저장됨
                                    </motion.span>
                                ) : (
                                    <motion.span key="save" variants={fadeRise} initial="initial" animate="animate" exit="exit" className="flex items-center gap-2">
                                        {saving ? <Icon icon="mdi:loading" className="text-base animate-spin" /> : <Icon icon="mdi:content-save-outline" className="text-base" />}
                                        저장
                                    </motion.span>
                                )}
                            </AnimatePresence>
                        </Pressable>
                    </div>
                </div>
            )}
        </>
    )

    if (bare) return content_

    return (
        <motion.section variants={staggerItem} className="glass-card p-5 md:p-6">
            {content_}
        </motion.section>
    )
}
