/**
 * MorningReportCard.tsx — 홈 상단 아침 브리핑 카드.
 *
 * isAmbientAiEnabled 일 때만 노출. 마운트 시 캐시(getAiArtifact) 우선 확인 →
 * 있으면 즉시 표시, 없으면 스켈레톤을 띄우며 generateMorningReport 비동기 호출.
 * 결과 null 이면 카드 자체를 숨긴다. 평일 "오늘의 브리핑", 월요일 "주간 리뷰".
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { getTodayDate, getAiArtifact } from '../lib/db'
import { isAmbientAiEnabled, generateMorningReport, morningReportKindFor } from '../lib/ai/aiService'
import AiMarkdown from './AiMarkdown'

interface MorningReportCardProps {
    settings: Settings
}

export default function MorningReportCard({ settings }: MorningReportCardProps) {
    const [content, setContent] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [hidden, setHidden] = useState(false)
    const [expanded, setExpanded] = useState(false)

    const today = getTodayDate()
    const kind = morningReportKindFor(today)
    const title = kind === 'weekly-report' ? '주간 리뷰' : '오늘의 브리핑'

    useEffect(() => {
        if (!isAmbientAiEnabled(settings) || settings.morningReportEnabled === false) {
            setHidden(true)
            setLoading(false)
            return
        }
        let cancelled = false
        ;(async () => {
            // 오늘 처음 보는 경우 펼침
            const seenKey = `studymeter_morning_seen_${today}`
            const firstView = !localStorage.getItem(seenKey)
            if (firstView) {
                setExpanded(true)
                try { localStorage.setItem(seenKey, '1') } catch { /* ignore */ }
            }

            const cached = await getAiArtifact(kind, today)
            if (cancelled) return
            if (cached) {
                setContent(cached.content)
                setLoading(false)
                return
            }
            // 캐시 없음 → 스켈레톤 유지하며 생성
            const generated = await generateMorningReport(settings)
            if (cancelled) return
            if (generated) {
                setContent(generated)
                setLoading(false)
            } else {
                setHidden(true)
                setLoading(false)
            }
        })()
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [today])

    if (hidden) return null

    return (
        <section className="glass-card p-6 border-none dark:bg-white/5 bg-white/40 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/10 blur-[80px] rounded-full -mr-10 -mt-10" />
            <button
                type="button"
                onClick={() => !loading && setExpanded(v => !v)}
                className="flex items-center gap-2 w-full relative z-10"
            >
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <Icon icon={kind === 'weekly-report' ? 'mdi:chart-timeline-variant' : 'mdi:weather-sunset-up'} className="text-lg text-white" />
                </div>
                <h2 className="text-base font-black text-[var(--color-text)]">{title}</h2>
                {!loading && (
                    <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="ml-auto text-xl text-white/40" />
                )}
            </button>

            {loading ? (
                <div className="space-y-2 animate-pulse mt-4">
                    <div className="h-3.5 rounded bg-white/5 w-3/4" />
                    <div className="h-3.5 rounded bg-white/5 w-full" />
                    <div className="h-3.5 rounded bg-white/5 w-5/6" />
                </div>
            ) : (
                <AnimatePresence initial={false}>
                    {expanded && content && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden relative z-10"
                        >
                            <div className="pt-4 text-sm text-[var(--color-text)] opacity-90">
                                <AiMarkdown>{content}</AiMarkdown>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}
        </section>
    )
}
