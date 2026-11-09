import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { SessionEvaluation, ThoughtNote, Settings, EvalTag } from '../lib/db'
import { db, markThoughtsReviewed, getTodayDate, addLearningNote } from '../lib/db'
import { attachEmbedding } from '../lib/ai/rag'
import { getTopTags, getTagsForScope, recordTagUsage, TAG_CATEGORY_LABELS } from '../lib/tags'
import { isAmbientAiEnabled, generateSessionComment } from '../lib/ai/aiService'
import AiMarkdown from './AiMarkdown'
import Sheet from './ui/Sheet'
import Pressable from './ui/Pressable'
import { spring, fadeRise } from '../lib/motion'

// 선택되지 않은 태그·버튼의 공통 표면. 같은 조합이 네 번 복사돼 있었다.
const IDLE =
    'bg-[var(--surface-raised)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:text-[var(--color-text)] transition-colors'
const CHIP = 'h-8 px-3 rounded-lg text-[13px] font-medium inline-flex items-center'

// 메모·복기 노트 입력란. 포커스 테두리 색만 다르고 나머지는 동일하다.
const NOTE_AREA =
    'w-full px-4 py-3 rounded-xl bg-[var(--surface-raised)] border border-[var(--color-border)] text-[var(--color-text)] resize-none outline-none transition-colors text-[15px]'

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
    const [learned, setLearned] = useState('')
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
        setLearned('')
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

    // 한국어 "3시간 5분" 표기 — lib/format 의 hm() 은 "3h 5m" 이라 여기선 쓸 수 없다.
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

        // 학습 복기 노트: 입력이 있으면 저장. 임베딩 생성은 fire-and-forget (저장을 막지 않음, 실패 무시).
        const learnedTrimmed = learned.trim()
        if (learnedTrimmed) {
            addLearningNote({
                date: getTodayDate(),
                subject,
                subItem,
                content: learnedTrimmed,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }).then((id) => {
                if (settings) attachEmbedding(settings, id).catch(() => { /* ignore */ })
            }).catch(() => { /* ignore */ })
        }

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
        <Sheet
            open={isOpen}
            onClose={() => { if (!saving) onClose() }}
            dismissOnScrim={!saving}
            ariaLabel="이번 세션 평가"
        >
            <div className="space-y-7 pt-1">

                {/* Header */}
                <header className="text-center space-y-2 pt-1">
                    <div className="flex items-center justify-center gap-2 text-[var(--color-text-secondary)] text-[14px]">
                        <span className="text-[var(--color-text)]">{subject}</span>
                        {subItem && <span>› {subItem}</span>}
                        <span className="w-1 h-1 rounded-full bg-[var(--color-text-secondary)]/40" />
                        <span>{formatDuration(sessionDuration)}</span>
                    </div>
                    <h2 className="text-[22px] font-medium text-[var(--color-text)]">이번 세션 어땠어?</h2>
                </header>

                {/* Score 1-10 (기본 선택 없음) */}
                <div className="space-y-3">
                    <div className="flex gap-1.5 h-12">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                            const active = score !== null && n <= score
                            const chosen = score === n
                            return (
                                <motion.button
                                    key={n}
                                    type="button"
                                    onClick={() => setScore(n)}
                                    whileTap={{ scale: 0.97 }}
                                    transition={spring.snappy}
                                    className={`flex-1 rounded-md text-[14px] font-medium tabular-nums relative overflow-hidden transition-colors ${chosen
                                        ? 'fill-accent'
                                        : active
                                            ? 'bg-[var(--hairline-strong)] text-[var(--color-text)]'
                                            : 'bg-[var(--surface-raised)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                                        }`}
                                >
                                    {n}
                                </motion.button>
                            )
                        })}
                    </div>
                    <p className="text-center text-[13px] text-[var(--color-text-muted)]">
                        {score === null ? '점수를 탭해 주세요 (건너뛰면 7점)' : (
                            <span className="font-mono text-[14px] text-[var(--color-text)] tabular-nums">{score}<span className="text-[var(--color-text-muted)]"> / 10</span></span>
                        )}
                    </p>
                </div>

                {/* Tag Chips */}
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {topTags.map(tag => {
                            const selected = selectedTags.includes(tag.name)
                            return (
                                <motion.button
                                    key={tag.name}
                                    type="button"
                                    onClick={() => toggleTag(tag.name)}
                                    whileTap={{ scale: 0.97 }}
                                    transition={spring.snappy}
                                    className={`${CHIP} ${selected
                                        ? 'fill-ink'
                                        : IDLE
                                        }`}
                                >
                                    {tag.name}
                                </motion.button>
                            )
                        })}
                        <Pressable
                            type="button"
                            onClick={() => setShowAllTags(v => !v)}
                            className={`${CHIP} ${IDLE}`}
                        >
                            {showAllTags ? '접기' : '더보기'}
                        </Pressable>
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
                                        <p className="text-[13px] font-medium text-[var(--color-text-secondary)]/70">{TAG_CATEGORY_LABELS[cat]}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {tags.map(tag => {
                                                const selected = selectedTags.includes(tag.name)
                                                return (
                                                    <motion.button
                                                        key={tag.name}
                                                        type="button"
                                                        onClick={() => toggleTag(tag.name)}
                                                        whileTap={{ scale: 0.97 }}
                                                        transition={spring.snappy}
                                                        className={`${CHIP} ${selected
                                                            ? 'fill-ink'
                                                            : IDLE
                                                            }`}
                                                    >
                                                        {tag.name}
                                                    </motion.button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Parked Thoughts */}
                {parkedNotes.length > 0 && (
                    <div className="pt-1 border-t border-[var(--color-border)]">
                        <div className="flex items-center gap-2 mb-3 mt-4">
                            <span className="w-5 h-5 rounded-[4px] border border-[var(--hairline-strong)] text-[12px] font-medium text-[var(--color-text-secondary)] flex items-center justify-center">P</span>
                            <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">주차된 생각 {parkedNotes.length}개</span>
                        </div>
                        <div className="space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                            {parkedNotes.map((note, i) => (
                                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--color-border)]">
                                    <span className="text-[var(--color-text-muted)] text-[12px] mt-0.5 flex-shrink-0">P</span>
                                    <p className="text-[14px] text-[var(--color-text)] leading-relaxed">{note.content}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-[11px] text-[var(--color-text-secondary)]/70 mt-2 text-center">저장 시 검토 완료로 표시됩니다</p>
                    </div>
                )}

                {/* 더 기록하기 (접힘) */}
                <div className="pt-1 border-t border-[var(--color-border)]">
                    <Pressable
                        type="button"
                        onClick={() => setShowMore(v => !v)}
                        className="flex items-center justify-between w-full group pt-4"
                    >
                        <span className="font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-colors text-[14px]">더 기록하기</span>
                        <Icon icon={showMore ? 'mdi:chevron-up' : 'mdi:chevron-down'} className="text-xl text-[var(--color-text-secondary)]" />
                    </Pressable>

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
                                    <span className="text-[13px] font-medium text-[var(--color-text-secondary)] w-16 flex-shrink-0">문제</span>
                                    <div className="flex-1 flex items-center gap-3 bg-[var(--surface-raised)] p-2 rounded-2xl border border-[var(--color-border)] focus-within:border-[var(--color-primary)] transition-[color,background-color,border-color,opacity,transform]">
                                        <input
                                            type="number"
                                            value={correct}
                                            onChange={(e) => setCorrect(e.target.value)}
                                            placeholder="맞힌 수"
                                            className="w-full bg-transparent text-center font-medium tabular-nums text-[var(--color-text)] outline-none"
                                        />
                                        <span className="text-[var(--color-text-secondary)]/40 font-black">/</span>
                                        <input
                                            type="number"
                                            value={total}
                                            onChange={(e) => setTotal(e.target.value)}
                                            placeholder="전체"
                                            className="w-full bg-transparent text-center font-medium tabular-nums text-[var(--color-text)] outline-none"
                                        />
                                    </div>
                                </div>

                                {/* 메모 */}
                                <textarea
                                    value={memo}
                                    onChange={(e) => setMemo(e.target.value)}
                                    placeholder="한 줄 메모 (선택)"
                                    rows={2}
                                    className={`${NOTE_AREA} focus:border-[var(--color-primary)]`}
                                />

                                {/* 학습 복기용 노트 — 나중에 검색·복기하거나 AI가 참고할 수 있음 */}
                                <div className="space-y-1.5">
                                    <p className="text-[13px] font-medium text-[var(--color-text-secondary)] px-1">
                                        이 세션에서 배운 것 (복기용, 선택)
                                    </p>
                                    <textarea
                                        value={learned}
                                        onChange={(e) => setLearned(e.target.value)}
                                        placeholder="예: 이차함수 최댓값 구하는 법을 완전꼴로 정리했다"
                                        rows={2}
                                        className={`${NOTE_AREA} focus:border-[var(--color-primary)]`}
                                    />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* AI 코멘트 (저장 직전 잠깐 노출) */}
                <AnimatePresence>
                    {aiComment && (
                        <motion.div
                            variants={fadeRise}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            onClick={() => dismissRef.current?.()}
                            className="p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--color-border)] cursor-pointer"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <Icon icon="mdi:message-reply-text-outline" className="text-[14px] text-[var(--color-text-muted)]" />
                                <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">AI 코멘트</span>
                            </div>
                            <div className="text-sm text-[var(--color-text)]/90 leading-relaxed">
                                <AiMarkdown>{aiComment}</AiMarkdown>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Actions */}
                {!aiComment && (
                    <footer className="flex gap-3 pt-2">
                        <Pressable
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            className={`flex-1 h-12 rounded-xl font-medium text-[15px] disabled:opacity-40 ${IDLE}`}
                        >
                            건너뛰기
                        </Pressable>
                        <Pressable
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="flex-[1.5] h-12 rounded-xl fill-ink font-medium text-[15px] flex items-center justify-center gap-2 disabled:opacity-70"
                        >
                            {saving ? (
                                <><Icon icon="mdi:loading" className="text-lg animate-spin" /> 저장 중</>
                            ) : (
                                <>완료 <Icon icon="mdi:check" className="text-lg" /></>
                            )}
                        </Pressable>
                    </footer>
                )}
            </div>
        </Sheet>
    )
}
