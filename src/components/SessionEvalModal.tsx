import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { SessionEvaluation, ThoughtNote, Settings, EvalTag } from '../lib/db'
import { db, markThoughtsReviewed, getTodayDate } from '../lib/db'
import { getTopTags, getTagsForScope, recordTagUsage, TAG_CATEGORY_LABELS } from '../lib/tags'
import { isAmbientAiEnabled, generateSessionComment } from '../lib/ai/aiService'
import AiMarkdown from './AiMarkdown'

interface SessionEvalModalProps {
    isOpen: boolean
    onClose: () => void
    onSave: (evaluation: SessionEvaluation) => void
    sessionDuration: number
    subject: string
    subItem?: string
    parkedNotes?: ThoughtNote[]
}

export default function SessionEvalModal({
    isOpen,
    onClose,
    onSave,
    sessionDuration,
    subject,
    subItem,
    parkedNotes = []
}: SessionEvalModalProps) {
    const [settings, setSettings] = useState<Settings | null>(null)
    const [score, setScore] = useState<number | null>(null)
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [showAllTags, setShowAllTags] = useState(false)
    const [showMore, setShowMore] = useState(false)
    const [correct, setCorrect] = useState('')
    const [total, setTotal] = useState('')
    const [memo, setMemo] = useState('')
    const [saving, setSaving] = useState(false)
    const [aiComment, setAiComment] = useState<string | null>(null)
    const dismissRef = useRef<(() => void) | null>(null)

    // 모달 열릴 때 상태 초기화 + 설정 로드 + 졸음 자동 프리필
    useEffect(() => {
        if (!isOpen) return
        // 열림 전환 시 1회 리셋 — cascading 없음. (의도적 예외)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setScore(null)
        setSelectedTags([])
        setShowAllTags(false)
        setShowMore(false)
        setCorrect('')
        setTotal('')
        setMemo('')
        setSaving(false)
        setAiComment(null)

        let cancelled = false
        ;(async () => {
            const s = await db.settings.toCollection().first()
            if (!cancelled) setSettings(s ?? null)

            // 오늘 가장 최근 세션에 졸음이 있었으면 '졸음' 태그 프리필
            const today = getTodayDate()
            const todaySessions = await db.sessions.where('date').equals(today).toArray()
            if (todaySessions.length > 0) {
                const latest = todaySessions.reduce((a, b) => (b.endTime > a.endTime ? b : a))
                if ((latest.drowsyCount ?? 0) > 0 && !cancelled) {
                    setSelectedTags(prev => (prev.includes('졸음') ? prev : [...prev, '졸음']))
                }
            }
        })()
        return () => { cancelled = true }
    }, [isOpen])

    const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / 3600000)
        const minutes = Math.floor((ms % 3600000) / 60000)
        if (hours > 0) return `${hours}시간 ${minutes}분`
        return `${minutes}분`
    }

    const toggleTag = (name: string) => {
        setSelectedTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
    }

    // 표시할 태그 목록: 기본 상위 8개(선택된 것 우선), 더보기 시 카테고리별 전체
    const topTags: EvalTag[] = settings ? getTopTags(settings, 'session', 8, selectedTags) : []
    const allTagsByCategory: Array<[EvalTag['category'], EvalTag[]]> = settings
        ? (Object.keys(TAG_CATEGORY_LABELS) as EvalTag['category'][])
            .map(cat => [cat, getTagsForScope(settings, 'session').filter(t => t.category === cat)] as [EvalTag['category'], EvalTag[]])
            .filter(([, tags]) => tags.length > 0)
        : []

    const handleSave = async () => {
        if (saving) return
        setSaving(true)

        if (parkedNotes.length > 0) {
            const ids = parkedNotes.map(n => n.id!).filter(Boolean)
            await markThoughtsReviewed(ids)
        }

        const finalScore = score ?? 7
        const evaluation: SessionEvaluation = {
            score: finalScore,
            tags: selectedTags,
            ...(showMore && correct && total ? {
                problemSolving: {
                    correct: parseInt(correct) || 0,
                    total: parseInt(total) || 0
                }
            } : {}),
            ...(memo.trim() ? { memo: memo.trim() } : {})
        }

        recordTagUsage(selectedTags)

        // AI 한 줄 코멘트: 최대 3.5초 대기 → 오면 잠깐 보여준 뒤 저장. 절대 저장을 막지 않음.
        if (settings && isAmbientAiEnabled(settings)) {
            const comment = await Promise.race<string | null>([
                generateSessionComment(settings, {
                    subject,
                    durationMs: sessionDuration,
                    score: finalScore,
                    tags: selectedTags,
                }).catch(() => null),
                new Promise<null>(resolve => setTimeout(() => resolve(null), 3500)),
            ])
            if (comment) {
                setAiComment(comment)
                await new Promise<void>(resolve => {
                    const t = setTimeout(resolve, 2500)
                    dismissRef.current = () => { clearTimeout(t); resolve() }
                })
            }
        }

        onSave(evaluation)
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
                        onClick={saving ? undefined : onClose}
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 30 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        className="relative w-full max-w-lg liquid-modal shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />

                        <div className="relative p-8 space-y-7 max-h-[85vh] overflow-y-auto no-scrollbar">

                            {/* Header */}
                            <header className="text-center space-y-2 pt-1">
                                <div className="flex items-center justify-center gap-2 text-white/40 font-bold text-sm">
                                    <span className="text-indigo-400">{subject}</span>
                                    {subItem && <span>› {subItem}</span>}
                                    <span className="w-1 h-1 rounded-full bg-white/20" />
                                    <span>{formatDuration(sessionDuration)}</span>
                                </div>
                                <h2 className="text-2xl font-black tracking-tight text-white">이번 세션 어땠어?</h2>
                            </header>

                            {/* Score 1-10 (기본 선택 없음) */}
                            <div className="space-y-3">
                                <div className="flex gap-1.5 h-12">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                                        const active = score !== null && n <= score
                                        return (
                                            <button
                                                key={n}
                                                type="button"
                                                onClick={() => setScore(n)}
                                                className={`flex-1 rounded-xl text-xs font-black transition-all duration-300 relative overflow-hidden ${active
                                                    ? 'bg-indigo-400 shadow-[0_0_15px_rgba(255,255,255,0.1)] scale-[1.05] z-10 text-white'
                                                    : 'bg-white/5 text-white/25 hover:bg-white/10'
                                                    }`}
                                            >
                                                {n}
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="text-center text-xs font-bold text-white/30">
                                    {score === null ? '점수를 탭해 주세요 (건너뛰면 7점)' : (
                                        <span className="text-indigo-300 text-base font-black">{score}<span className="opacity-40"> / 10</span></span>
                                    )}
                                </p>
                            </div>

                            {/* Tag Chips */}
                            <div className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {topTags.map(tag => (
                                        <button
                                            key={tag.name}
                                            type="button"
                                            onClick={() => toggleTag(tag.name)}
                                            className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all active:scale-95 ${selectedTags.includes(tag.name)
                                                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                                : 'bg-white/5 text-white/50 hover:bg-white/10'
                                                }`}
                                        >
                                            {tag.name}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setShowAllTags(v => !v)}
                                        className="px-3.5 py-2 rounded-full text-xs font-bold bg-white/5 text-white/40 hover:bg-white/10 transition-all"
                                    >
                                        {showAllTags ? '접기' : '더보기'}
                                    </button>
                                </div>

                                <AnimatePresence>
                                    {showAllTags && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="space-y-3 overflow-hidden pt-1"
                                        >
                                            {allTagsByCategory.map(([cat, tags]) => (
                                                <div key={cat} className="space-y-1.5">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-white/30">{TAG_CATEGORY_LABELS[cat]}</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {tags.map(tag => (
                                                            <button
                                                                key={tag.name}
                                                                type="button"
                                                                onClick={() => toggleTag(tag.name)}
                                                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${selectedTags.includes(tag.name)
                                                                    ? 'bg-indigo-500 text-white'
                                                                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                                                                    }`}
                                                            >
                                                                {tag.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Parked Thoughts */}
                            {parkedNotes.length > 0 && (
                                <div className="pt-1 border-t border-white/5">
                                    <div className="flex items-center gap-2 mb-3 mt-4">
                                        <span className="text-lg font-black text-blue-400">🅿</span>
                                        <span className="text-xs font-black uppercase tracking-widest text-white/50">주차된 생각 {parkedNotes.length}개</span>
                                    </div>
                                    <div className="space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                                        {parkedNotes.map((note, i) => (
                                            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                                <span className="text-blue-400 text-xs mt-0.5 font-black flex-shrink-0">P</span>
                                                <p className="text-xs text-white/70 leading-relaxed">{note.content}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-white/25 mt-2 text-center">저장 시 검토 완료로 표시됩니다</p>
                                </div>
                            )}

                            {/* 더 기록하기 (접힘) */}
                            <div className="pt-1 border-t border-white/5">
                                <button
                                    type="button"
                                    onClick={() => setShowMore(v => !v)}
                                    className="flex items-center justify-between w-full group pt-4"
                                >
                                    <span className="font-bold text-white/50 group-hover:text-white/80 transition-colors text-sm">더 기록하기</span>
                                    <Icon icon={showMore ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="text-xl text-white/40" />
                                </button>

                                <AnimatePresence>
                                    {showMore && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="space-y-4 overflow-hidden pt-4"
                                        >
                                            {/* 문제 풀이 */}
                                            <div className="flex items-center gap-4">
                                                <span className="text-xs font-black text-white/40 uppercase tracking-widest w-16 flex-shrink-0">문제</span>
                                                <div className="flex-1 flex items-center gap-3 bg-white/5 p-2 rounded-2xl border border-white/5 focus-within:border-amber-500/30 transition-all">
                                                    <input
                                                        type="number"
                                                        value={correct}
                                                        onChange={(e) => setCorrect(e.target.value)}
                                                        placeholder="맞힌 수"
                                                        className="w-full bg-transparent text-center font-black text-white placeholder:text-white/10 outline-none"
                                                    />
                                                    <span className="text-white/20 font-black">/</span>
                                                    <input
                                                        type="number"
                                                        value={total}
                                                        onChange={(e) => setTotal(e.target.value)}
                                                        placeholder="전체"
                                                        className="w-full bg-transparent text-center font-black text-white placeholder:text-white/10 outline-none"
                                                    />
                                                </div>
                                            </div>

                                            {/* 메모 */}
                                            <textarea
                                                value={memo}
                                                onChange={(e) => setMemo(e.target.value)}
                                                placeholder="한 줄 메모 (선택)"
                                                rows={2}
                                                className="w-full px-5 py-4 rounded-[1.5rem] bg-white/5 border border-white/5 text-white placeholder:text-white/10 resize-none outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all font-medium"
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* AI 코멘트 (저장 직전 잠깐 노출) */}
                            <AnimatePresence>
                                {aiComment && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        onClick={() => dismissRef.current?.()}
                                        className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/15 to-purple-500/10 border border-indigo-500/20 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <Icon icon="mdi:sparkles" className="text-sm text-amber-300" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">AI 코멘트</span>
                                        </div>
                                        <div className="text-sm text-white/85 leading-relaxed">
                                            <AiMarkdown>{aiComment}</AiMarkdown>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Actions */}
                            {!aiComment && (
                                <footer className="flex gap-4 pt-2">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        disabled={saving}
                                        className="flex-1 py-5 rounded-[2rem] bg-white/5 hover:bg-white/10 text-white/40 font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-40"
                                    >
                                        건너뛰기
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="flex-[1.5] py-5 rounded-[2rem] bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black uppercase tracking-widest text-xs shadow-2xl shadow-indigo-500/30 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70"
                                    >
                                        {saving ? (
                                            <><Icon icon="mdi:loading" className="text-lg animate-spin" /> 저장 중</>
                                        ) : (
                                            <>완료 <Icon icon="mdi:check" className="text-lg" /></>
                                        )}
                                    </button>
                                </footer>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
