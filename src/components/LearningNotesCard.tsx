/**
 * LearningNotesCard.tsx — 홈 화면 "학습 복기" 카드.
 *
 * 세션 평가 시 남긴 학습 노트를 검색·조회·삭제할 수 있다. 검색어가 없으면
 * 최근 노트를 보여준다. AI 채팅에서도 같은 노트를 검색해 활용할 수 있음을 안내한다.
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, LearningNote } from '../lib/db'
import { getAllLearningNotes, deleteLearningNote } from '../lib/db'
import { searchLearningNotes } from '../lib/ai/rag'
import Pressable from './ui/Pressable'
import { fadeRise, staggerItem } from '../lib/motion'

interface LearningNotesCardProps {
    settings: Settings
    /** true면 외곽 glass-card 래퍼와 헤더(아이콘+제목) 없이 내용만 렌더링 (HomeSection 안에서 사용) */
    bare?: boolean
}

function formatDateShort(date: string): string {
    const d = new Date(date + 'T00:00:00')
    return `${d.getMonth() + 1}.${d.getDate()}`
}

export default function LearningNotesCard({ settings, bare = false }: LearningNotesCardProps) {
    const [query, setQuery] = useState('')
    const [notes, setNotes] = useState<LearningNote[]>([])
    const [loading, setLoading] = useState(true)
    const [searching, setSearching] = useState(false)

    // 검색어에 따라 최근 노트 또는 검색 결과를 불러온다.
    // 디바운스 타이머 콜백 안에서만 setState 하여 effect 본문 내 동기 setState 를 피한다.
    useEffect(() => {
        let cancelled = false
        const trimmed = query.trim()

        if (!trimmed) {
            ;(async () => {
                const all = await getAllLearningNotes()
                if (cancelled) return
                setNotes(all.slice(0, 5))
                setLoading(false)
                setSearching(false)
            })()
            return () => { cancelled = true }
        }

        const timer = setTimeout(() => {
            if (cancelled) return
            setSearching(true)
            ;(async () => {
                const hits = await searchLearningNotes(settings, trimmed, 8)
                if (cancelled) return
                setNotes(hits.map(h => h.note))
                setLoading(false)
                setSearching(false)
            })()
        }, 350)

        return () => { cancelled = true; clearTimeout(timer) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

    const handleDelete = async (id?: number) => {
        if (!id) return
        await deleteLearningNote(id)
        setNotes(prev => prev.filter(n => n.id !== id))
    }

    const content = (
        <>
            {!bare && (
                <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20 flex-shrink-0">
                        <Icon icon="mdi:lightbulb-on-outline" className="text-lg text-white" />
                    </div>
                    <h2 className="text-lg font-black text-[var(--color-text)]">학습 복기</h2>
                </div>
            )}
            <p className="text-[11px] text-[var(--color-text-secondary)] opacity-50 mb-4 italic">
                세션을 마칠 때 남긴 "배운 것"을 검색하고 다시 떠올려 보세요. AI 채팅에서도 같은 기록을 찾아 활용할 수 있어요.
            </p>

            <div className="relative mb-4">
                <Icon icon="mdi:magnify" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-[var(--color-text-secondary)] opacity-50" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="배운 내용 검색 (예: 이차함수 그래프)"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-amber-400/60 text-[var(--color-text)] text-sm"
                />
                {searching && (
                    <Icon icon="mdi:loading" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-base text-amber-400 animate-spin" />
                )}
            </div>

            <div className="space-y-2">
                {!query.trim() && !loading && notes.length > 0 && (
                    <p className="text-[10px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider opacity-50 px-1">최근 기록</p>
                )}

                <AnimatePresence initial={false}>
                    {loading ? (
                        <div className="space-y-2 animate-pulse">
                            {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-black/[0.04] dark:bg-white/5" />)}
                        </div>
                    ) : notes.length === 0 ? (
                        <motion.p
                            variants={fadeRise}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="text-center text-xs text-[var(--color-text-secondary)] opacity-50 py-6 italic"
                        >
                            {query.trim() ? '검색 결과가 없습니다.' : '세션 종료 시 "배운 것"을 남기면 여기에 쌓여요.'}
                        </motion.p>
                    ) : (
                        notes.map((note) => (
                            <motion.div
                                key={note.id}
                                variants={fadeRise}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                layout
                                className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-black/[0.03] dark:bg-white/5 border border-white/10"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                            {formatDateShort(note.date)}
                                        </span>
                                        <span className="text-[10px] font-bold text-indigo-400">{note.subject}</span>
                                        {note.subItem && (
                                            <span className="text-[10px] text-[var(--color-text-secondary)] opacity-60">› {note.subItem}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-[var(--color-text)]/90 leading-relaxed line-clamp-3">{note.content}</p>
                                </div>
                                <Pressable
                                    type="button"
                                    onClick={() => handleDelete(note.id)}
                                    pressScale={0.85}
                                    className="opacity-40 hover:opacity-100 flex items-center justify-center p-1 flex-shrink-0"
                                    aria-label="삭제"
                                >
                                    <Icon icon="mdi:trash-can-outline" className="text-base text-[var(--color-text-secondary)]" />
                                </Pressable>
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>
        </>
    )

    if (bare) return content

    return (
        <motion.section variants={staggerItem} className="glass-card p-6 md:p-8">
            {content}
        </motion.section>
    )
}
