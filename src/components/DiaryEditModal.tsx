/**
 * DiaryEditModal.tsx — 일기 편집 공용 컴포넌트.
 *
 * DiaryEditor: 점수·태그·나의 한마디(초안/직접/음성)·확정 로직을 담은 폼.
 *   DiaryCard(홈, 인라인)와 DiaryEditModal(기록장, 모달)에서 공유한다.
 * DiaryEntryView: 확정된 일기의 컴팩트 표시(점수·태그·한마디·AI 답장·통계).
 * DiaryStatsRow: 자동 통계 4종(순공·목표%·세션수·졸음) 한 줄.
 */
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { DiaryEntry, DiaryStats, Settings, EvalTag } from '../lib/db'
import { suggestDiaryScore, saveDiaryEntry, formatDurationHourMinute, computeDiaryStats, getDiaryEntry } from '../lib/db'
import { getTopTags, getTagsForScope, recordTagUsage, TAG_CATEGORY_LABELS } from '../lib/tags'
import { isAmbientAiEnabled, generateDiaryReply, regenerateDiaryDraft, regenerateDiaryReply } from '../lib/ai/aiService'
import { compressImages } from '../lib/image'
import AiMarkdown from './AiMarkdown'
import Sheet from './ui/Sheet'
import Pressable from './ui/Pressable'
import { spring } from '../lib/motion'

// 태그·보조 액션에 쓰이는 알약 버튼 클래스. 같은 조합이 열 번 넘게 복사돼 있었다.
const PILL = 'px-3.5 py-2 rounded-full text-xs font-bold'
const PILL_IDLE =
    'bg-black/[0.04] dark:bg-white/5 text-[var(--color-text-secondary)] hover:bg-black/[0.08] dark:hover:bg-white/10'

// ── 사진(종이 일기 스캔) ─────────────────────────────────────────────────────

/** 사진 전체 보기 라이트박스. */
function PhotoLightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
    useEffect(() => {
        if (!src) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [src, onClose])

    return createPortal(
        <AnimatePresence>
            {src && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[9300] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
                    onClick={onClose}
                >
                    <motion.img
                        src={src}
                        alt="일기 사진"
                        initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
                        transition={spring.snappy}
                        className="max-w-full max-h-full rounded-xl object-contain shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="닫기"
                        className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center backdrop-blur-md"
                    >
                        <Icon icon="mdi:close" className="text-2xl" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    )
}

/** 사진 썸네일 묶음. onRemove 를 주면 편집(삭제 가능) 모드. */
export function DiaryPhotoThumbs({ photos, onRemove, size = 'md' }: {
    photos: string[]
    onRemove?: (index: number) => void
    size?: 'sm' | 'md'
}) {
    const [lightbox, setLightbox] = useState<string | null>(null)
    if (!photos.length) return null
    const dim = size === 'sm' ? 'w-14 h-14' : 'w-20 h-20'
    return (
        <>
            <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                    <div key={i} className="relative">
                        <button
                            type="button"
                            onClick={() => setLightbox(p)}
                            className={`block ${dim} rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/5`}
                        >
                            <img src={p} alt={`일기 사진 ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                        </button>
                        {onRemove && (
                            <button
                                type="button"
                                onClick={() => onRemove(i)}
                                aria-label="사진 삭제"
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md"
                            >
                                <Icon icon="mdi:close" className="text-xs" />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
        </>
    )
}

// ── 음성 입력 (Web Speech API) ───────────────────────────────────────────────

/** 표준 타입 정의가 없는 webkitSpeechRecognition 을 위한 최소 타입 */
interface SpeechRecognitionEventLike {
    results?: ArrayLike<ArrayLike<{ transcript?: string }>>
}
interface SpeechRecognitionLike {
    lang: string
    interimResults: boolean
    maxAlternatives: number
    onresult: ((e: SpeechRecognitionEventLike) => void) | null
    onend: (() => void) | null
    onerror: (() => void) | null
    start(): void
    stop(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null
    const w = window as unknown as Record<string, SpeechRecognitionCtor | undefined>
    return w.webkitSpeechRecognition || w.SpeechRecognition || null
}
const isVoiceInputSupported = () => getSpeechRecognition() !== null

// ── 자동 통계 한 줄 ──────────────────────────────────────────────────────────

export function DiaryStatsRow({ stats }: { stats: DiaryStats }) {
    const items = [
        { label: '순공', value: formatDurationHourMinute(stats.selfStudyMs), icon: 'mdi:timer-outline', color: 'text-indigo-400' },
        { label: '목표', value: stats.goalPct !== null ? `${stats.goalPct}%` : '—', icon: 'mdi:target', color: 'text-emerald-400' },
        { label: '세션', value: `${stats.sessionCount}회`, icon: 'mdi:counter', color: 'text-purple-400' },
        { label: '졸음', value: `${stats.drowsyCount}회`, icon: 'mdi:sleep', color: stats.drowsyCount > 0 ? 'text-amber-400' : 'text-[var(--color-text-secondary)]' },
    ]
    return (
        <div className="grid grid-cols-4 gap-2">
            {items.map(it => (
                <div key={it.label} className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/5">
                    <Icon icon={it.icon} className={`text-lg ${it.color}`} />
                    <span className={`text-sm font-black ${it.color}`}>{it.value}</span>
                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)]/70">{it.label}</span>
                </div>
            ))}
        </div>
    )
}

// ── 확정 일기 컴팩트 뷰 ──────────────────────────────────────────────────────

export function DiaryEntryView({ entry, onEdit, settings, onChanged }: {
    entry: DiaryEntry
    onEdit?: () => void
    /** 전달 시 AI 답장 "다시 생성" 버튼 노출 */
    settings?: Settings
    onChanged?: () => void | Promise<void>
}) {
    const [replyLoading, setReplyLoading] = useState(false)

    const handleRegenerateReply = async () => {
        if (!settings || replyLoading) return
        setReplyLoading(true)
        try {
            const fresh = await regenerateDiaryReply(settings, entry)
            if (fresh) await onChanged?.()
        } finally {
            setReplyLoading(false)
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-display text-3xl font-black gradient-text tabular-nums">{entry.score}</span>
                    <span className="text-sm font-bold text-[var(--color-text-secondary)]/70">/ 10</span>
                    {entry.auto && (
                        <span className="ml-1 px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/10 text-[10px] font-bold text-[var(--color-text-secondary)]">자동 확정</span>
                    )}
                </div>
                {onEdit && (
                    <button
                        type="button"
                        onClick={onEdit}
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${PILL_IDLE}`}
                    >
                        <Icon icon="mdi:pencil-outline" className="text-sm" /> 수정
                    </button>
                )}
            </div>

            {entry.dayTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {entry.dayTags.map(t => (
                        <span key={t} className="px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-400 text-[11px] font-bold">{t}</span>
                    ))}
                </div>
            )}

            {entry.oneLiner && (
                <p className="text-[var(--color-text)] font-semibold leading-relaxed">"{entry.oneLiner}"</p>
            )}

            {entry.photos && entry.photos.length > 0 && (
                <DiaryPhotoThumbs photos={entry.photos} />
            )}

            {entry.aiReply && (
                <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-purple-500/5 border border-indigo-500/15">
                    <div className="flex items-center gap-2 mb-1.5">
                        <Icon icon="mdi:sparkles" className="text-sm text-amber-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-secondary)]">AI 답장</span>
                        {settings && isAmbientAiEnabled(settings) && (
                            <button
                                type="button"
                                onClick={handleRegenerateReply}
                                disabled={replyLoading}
                                className="ml-auto flex items-center gap-1 text-[10px] font-bold text-[var(--color-text-secondary)] opacity-70 hover:opacity-100 disabled:opacity-40 transition-opacity"
                                aria-label="AI 답장 다시 생성"
                            >
                                <Icon icon="mdi:refresh" className={`text-xs ${replyLoading ? 'animate-spin' : ''}`} />
                                {replyLoading ? '생성 중…' : '다시 생성'}
                            </button>
                        )}
                    </div>
                    <div className="text-sm text-[var(--color-text)] opacity-90">
                        <AiMarkdown>{entry.aiReply}</AiMarkdown>
                    </div>
                </div>
            )}

            <DiaryStatsRow stats={entry.stats} />
        </div>
    )
}

// ── 편집 폼 ──────────────────────────────────────────────────────────────────

interface DiaryEditorProps {
    date: string
    settings: Settings
    stats: DiaryStats
    existing?: DiaryEntry
    initialDraft: string
    inheritedTags: string[]
    onSaved: () => void | Promise<void>
    onCancel?: () => void
}

export function DiaryEditor({
    date, settings, stats, existing, initialDraft, inheritedTags, onSaved, onCancel,
}: DiaryEditorProps) {
    const [score, setScore] = useState<number>(existing?.score ?? suggestDiaryScore(stats))
    const [selectedTags, setSelectedTags] = useState<string[]>(() => {
        const merged = new Set<string>([...inheritedTags, ...(existing?.dayTags ?? [])])
        return Array.from(merged)
    })
    const [showAllTags, setShowAllTags] = useState(false)
    const [oneLiner, setOneLiner] = useState(existing?.oneLiner ?? initialDraft)
    const [source, setSource] = useState<DiaryEntry['oneLinerSource']>(existing?.oneLinerSource ?? 'ai')
    const [editingText, setEditingText] = useState(false)
    const [listening, setListening] = useState(false)
    const [saving, setSaving] = useState(false)
    // "다시 생성"으로 초안이 바뀔 수 있어 프롭과 별개의 로컬 초안을 유지한다
    const [draft, setDraft] = useState(initialDraft)
    const [draftLoading, setDraftLoading] = useState(false)
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
    // 종이 일기 스캔/사진 (압축된 base64 data URL)
    const [photos, setPhotos] = useState<string[]>(existing?.photos ?? [])
    const [uploading, setUploading] = useState(false)
    const pickRef = useRef<HTMLInputElement | null>(null)
    const cameraRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => () => { try { recognitionRef.current?.stop() } catch { /* ignore */ } }, [])

    // AI 초안이 폼 마운트 이후 늦게 도착한 경우: 사용자가 아직 아무것도 입력/수정하지
    // 않았을 때(빈 값 + source 'ai')만 초안을 채워 넣는다. 입력 중 덮어쓰기 방지.
    useEffect(() => {
        if (!initialDraft) return
        // 비동기 도착한 초안을 미입력 상태에서만 1회 채움 — cascading 없음. (의도적 예외)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft(initialDraft)
        setOneLiner(prev => (prev === '' && source === 'ai' && !editingText ? initialDraft : prev))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDraft])

    const handleRegenerateDraft = async () => {
        if (draftLoading) return
        setDraftLoading(true)
        try {
            const fresh = await regenerateDiaryDraft(settings, date, stats)
            if (fresh) {
                setDraft(fresh)
                setOneLiner(fresh)
                setSource('ai')
                setEditingText(false)
            }
        } finally {
            setDraftLoading(false)
        }
    }

    const toggleTag = (name: string) => {
        setSelectedTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
    }

    const handleAddPhotos = async (files: FileList | null) => {
        if (!files || files.length === 0) return
        setUploading(true)
        try {
            const compressed = await compressImages(Array.from(files))
            if (compressed.length) setPhotos(prev => [...prev, ...compressed])
        } finally {
            setUploading(false)
        }
    }
    const removePhoto = (i: number) => setPhotos(prev => prev.filter((_, idx) => idx !== i))

    const startVoice = () => {
        const SR = getSpeechRecognition()
        if (!SR) return
        try {
            const rec = new SR()
            rec.lang = 'ko-KR'
            rec.interimResults = false
            rec.maxAlternatives = 1
            rec.onresult = (e: SpeechRecognitionEventLike) => {
                const transcript = e.results?.[0]?.[0]?.transcript?.trim()
                if (transcript) {
                    setOneLiner(transcript)
                    setSource('voice')
                    setEditingText(false)
                }
            }
            rec.onend = () => setListening(false)
            rec.onerror = () => setListening(false)
            recognitionRef.current = rec
            setListening(true)
            rec.start()
        } catch {
            setListening(false)
        }
    }

    const useDraftAsIs = () => {
        setOneLiner(draft)
        setSource('ai')
        setEditingText(false)
    }

    const handleTextChange = (v: string) => {
        setOneLiner(v)
        setSource(draft.trim() ? 'ai-edited' : 'user')
    }

    const topTags: EvalTag[] = getTopTags(settings, 'day', 8, selectedTags)
    const allTagsByCategory: Array<[EvalTag['category'], EvalTag[]]> =
        (Object.keys(TAG_CATEGORY_LABELS) as EvalTag['category'][])
            .map(cat => [cat, getTagsForScope(settings, 'day').filter(t => t.category === cat)] as [EvalTag['category'], EvalTag[]])
            .filter(([, tags]) => tags.length > 0)

    const handleConfirm = async () => {
        if (saving) return
        setSaving(true)
        const trimmed = oneLiner.trim()
        const now = Date.now()
        // 확정 시점 기준으로 통계를 재계산 (카드 마운트 이후 세션이 추가됐을 수 있음)
        const freshStats = await computeDiaryStats(date, settings.dailyGoalMs).catch(() => stats)
        const entry: DiaryEntry = {
            date,
            score,
            dayTags: selectedTags,
            oneLiner: trimmed || undefined,
            oneLinerSource: trimmed ? source : undefined,
            photos: photos.length ? photos : undefined,
            aiReply: existing?.aiReply,
            auto: false,
            stats: freshStats,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        }
        await saveDiaryEntry(entry)
        recordTagUsage(selectedTags)
        await onSaved()

        // 확정 직후 AI 답장 비동기 생성 (없을 때만)
        if (isAmbientAiEnabled(settings) && !entry.aiReply) {
            generateDiaryReply(settings, entry).then(async reply => {
                if (!reply) return
                // 답장 도착 시점의 최신 일기에 aiReply 만 병합 —
                // 그 사이 사용자가 재수정했어도 내용을 되돌리지 않는다.
                const current = await getDiaryEntry(date)
                if (!current) return
                await saveDiaryEntry({ ...current, aiReply: reply, updatedAt: Date.now() })
                await onSaved()
            }).catch(() => { /* ignore */ })
        }
    }

    return (
        <div className="space-y-6">
            {/* 자동 통계 */}
            <DiaryStatsRow stats={stats} />

            {/* 점수 */}
            <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)]">오늘 점수</p>
                <div className="flex gap-1.5 h-11">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
                        const active = n <= score
                        return (
                            <motion.button
                                key={n}
                                type="button"
                                onClick={() => setScore(n)}
                                whileTap={{ scale: 0.9 }}
                                animate={{ scale: active ? 1.03 : 1 }}
                                transition={spring.snappy}
                                className={`flex-1 rounded-lg text-xs font-black ${active
                                    ? 'bg-indigo-500 text-white shadow-[0_4px_12px_rgba(99,102,241,0.35)]'
                                    : 'bg-black/[0.04] dark:bg-white/5 text-[var(--color-text-secondary)]/70 hover:bg-black/[0.08] dark:hover:bg-white/10 hover:text-[var(--color-text-secondary)]'
                                    }`}
                            >
                                {n}
                            </motion.button>
                        )
                    })}
                </div>
            </div>

            {/* 하루 태그 */}
            <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)]">하루 태그</p>
                <div className="flex flex-wrap gap-2">
                    {topTags.map(tag => {
                        const selected = selectedTags.includes(tag.name)
                        return (
                            <motion.button
                                key={tag.name}
                                type="button"
                                onClick={() => toggleTag(tag.name)}
                                whileTap={{ scale: 0.9 }}
                                animate={{ scale: selected ? 1.04 : 1 }}
                                transition={spring.snappy}
                                className={`${PILL} ${selected
                                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                    : PILL_IDLE
                                    }`}
                            >
                                {tag.name}
                            </motion.button>
                        )
                    })}
                    <Pressable
                        type="button"
                        onClick={() => setShowAllTags(v => !v)}
                        className={`${PILL} ${PILL_IDLE}`}
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
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--color-text-secondary)]/70">{TAG_CATEGORY_LABELS[cat]}</p>
                                    <div className="flex flex-wrap gap-2">
                                        {tags.map(tag => {
                                            const selected = selectedTags.includes(tag.name)
                                            return (
                                                <motion.button
                                                    key={tag.name}
                                                    type="button"
                                                    onClick={() => toggleTag(tag.name)}
                                                    whileTap={{ scale: 0.9 }}
                                                    animate={{ scale: selected ? 1.04 : 1 }}
                                                    transition={spring.snappy}
                                                    className={`px-3 py-1.5 rounded-full text-xs font-bold ${selected
                                                        ? 'bg-indigo-500 text-white'
                                                        : PILL_IDLE
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

            {/* 나의 한마디 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)]">나의 한마디</p>
                    {source === 'ai' && <span className="text-[10px] font-bold text-indigo-400/80">AI 초안</span>}
                    {source === 'voice' && <span className="text-[10px] font-bold text-emerald-400/80">음성 입력</span>}
                </div>

                {editingText ? (
                    <textarea
                        autoFocus
                        value={oneLiner}
                        onChange={(e) => handleTextChange(e.target.value)}
                        placeholder="오늘 하루를 한마디로 남겨보세요"
                        rows={2}
                        className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] dark:bg-white/5 border border-white/10 text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)]/40 resize-none outline-none focus:border-indigo-400/40 transition-all font-medium"
                    />
                ) : (
                    <div className="px-4 py-3 rounded-2xl bg-black/[0.03] dark:bg-white/5 border border-white/10 min-h-[3rem] flex items-center">
                        <p className="text-[var(--color-text)] font-medium leading-relaxed">
                            {oneLiner || <span className="text-[var(--color-text-secondary)]/50">한마디를 남겨보세요</span>}
                        </p>
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    {editingText ? (
                        <Pressable
                            type="button"
                            onClick={() => setEditingText(false)}
                            className={`${PILL} bg-indigo-500 text-white`}
                        >
                            <Icon icon="mdi:check" className="inline text-sm mr-1" />완료
                        </Pressable>
                    ) : (
                        <>
                            {draft.trim() && oneLiner !== draft && (
                                <Pressable
                                    type="button"
                                    onClick={useDraftAsIs}
                                    className={`${PILL} ${PILL_IDLE}`}
                                >
                                    초안 그대로
                                </Pressable>
                            )}
                            {isAmbientAiEnabled(settings) && (
                                <Pressable
                                    type="button"
                                    onClick={handleRegenerateDraft}
                                    disabled={draftLoading}
                                    className={`${PILL} ${PILL_IDLE} disabled:opacity-50`}
                                >
                                    <Icon icon="mdi:refresh" className={`inline text-sm mr-1 ${draftLoading ? 'animate-spin' : ''}`} />
                                    {draftLoading ? '생성 중…' : 'AI 초안 다시'}
                                </Pressable>
                            )}
                            <Pressable
                                type="button"
                                onClick={() => setEditingText(true)}
                                className={`${PILL} ${PILL_IDLE}`}
                            >
                                <Icon icon="mdi:pencil-outline" className="inline text-sm mr-1" />직접 고치기
                            </Pressable>
                            {isVoiceInputSupported() && (
                                <Pressable
                                    type="button"
                                    onClick={startVoice}
                                    disabled={listening}
                                    className={`${PILL} ${listening
                                        ? 'bg-red-500/80 text-white animate-pulse'
                                        : PILL_IDLE
                                        }`}
                                >
                                    <Icon icon="mdi:microphone" className="inline text-sm mr-1" />{listening ? '듣는 중…' : '음성'}
                                </Pressable>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* 종이 일기 / 사진 */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-widest text-[var(--color-text-secondary)]">종이 일기 · 사진</p>
                    {photos.length > 0 && (
                        <span className="text-[10px] font-bold text-[var(--color-text-secondary)]/70">{photos.length}장</span>
                    )}
                </div>

                {photos.length > 0 && <DiaryPhotoThumbs photos={photos} onRemove={removePhoto} />}

                {/* 숨은 파일 입력: 촬영(카메라) / 불러오기(갤러리·파일) */}
                <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { handleAddPhotos(e.target.files); e.target.value = '' }}
                />
                <input
                    ref={pickRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { handleAddPhotos(e.target.files); e.target.value = '' }}
                />

                <div className="flex flex-wrap gap-2">
                    <Pressable
                        type="button"
                        onClick={() => cameraRef.current?.click()}
                        disabled={uploading}
                        className={`${PILL} ${PILL_IDLE} disabled:opacity-50`}
                    >
                        <Icon icon={uploading ? 'mdi:loading' : 'mdi:camera-outline'} className={`inline text-sm mr-1 ${uploading ? 'animate-spin' : ''}`} />
                        촬영
                    </Pressable>
                    <Pressable
                        type="button"
                        onClick={() => pickRef.current?.click()}
                        disabled={uploading}
                        className={`${PILL} ${PILL_IDLE} disabled:opacity-50`}
                    >
                        <Icon icon={uploading ? 'mdi:loading' : 'mdi:image-multiple-outline'} className={`inline text-sm mr-1 ${uploading ? 'animate-spin' : ''}`} />
                        {uploading ? '처리 중…' : '불러오기'}
                    </Pressable>
                </div>
                <p className="text-[10px] text-[var(--color-text-secondary)]/60 leading-relaxed">
                    손으로 쓴 일기를 찍거나 스캔해 올리면 기록에 사진 그대로 남습니다.
                </p>
            </div>

            {/* 확정 버튼 */}
            <div className="flex gap-3 pt-1">
                {onCancel && (
                    <Pressable
                        type="button"
                        onClick={onCancel}
                        disabled={saving}
                        className="flex-1 py-4 rounded-2xl bg-black/[0.04] dark:bg-white/5 hover:bg-black/[0.08] dark:hover:bg-white/10 text-[var(--color-text-secondary)] font-black text-sm disabled:opacity-40"
                    >
                        취소
                    </Pressable>
                )}
                <Pressable
                    type="button"
                    onClick={handleConfirm}
                    disabled={saving}
                    className="flex-[1.6] py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black text-sm shadow-xl shadow-indigo-500/30 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                    {saving ? <Icon icon="mdi:loading" className="text-lg animate-spin" /> : <Icon icon="mdi:check-circle-outline" className="text-lg" />}
                    {existing ? '수정 완료' : '오늘 일기 확정'}
                </Pressable>
            </div>
        </div>
    )
}

// ── 모달 래퍼 (기록장에서 사용) ──────────────────────────────────────────────

interface DiaryEditModalProps {
    isOpen: boolean
    onClose: () => void
    date: string
    settings: Settings
    stats: DiaryStats
    existing?: DiaryEntry
    initialDraft: string
    inheritedTags: string[]
    onSaved: () => void | Promise<void>
}

export default function DiaryEditModal({
    isOpen, onClose, date, settings, stats, existing, initialDraft, inheritedTags, onSaved,
}: DiaryEditModalProps) {
    return (
        <Sheet open={isOpen} onClose={onClose} ariaLabel={`${date} 일기`}>
            <h2 className="text-xl font-black text-[var(--color-text)] mb-5 pt-1">{date} 일기</h2>
            <DiaryEditor
                date={date}
                settings={settings}
                stats={stats}
                existing={existing}
                initialDraft={initialDraft}
                inheritedTags={inheritedTags}
                onSaved={async () => { await onSaved() }}
                onCancel={onClose}
            />
        </Sheet>
    )
}
