/**
 * DataManagement — 데이터 관리 화면.
 * 저장소 사용량을 보여주고, 오래된 데이터 정리 / 카테고리별 전체 삭제를 제공한다.
 * 모든 파괴적 동작은 인라인 2단계 확인("정말 삭제?")을 거친다.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { getDatabaseStats, pruneDataOlderThan, clearChatConversations, clearLearningNotes, clearAiArtifacts, clearThoughtNotes, type DatabaseStats, type PruneResult } from '../lib/db'
import Pressable from '../components/ui/Pressable'
import { spring, staggerContainer, staggerItem } from '../lib/motion'

// ── 바이트 → 사람이 읽기 좋은 단위 ───────────────────────────────────────────
function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / Math.pow(1024, exp)
    return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`
}

// ── 섹션 라벨 (Settings.tsx 와 동일 스타일) ─────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
            {children}
        </p>
    )
}

interface CountItem {
    icon: string
    label: string
    value: number
}

// ── 카테고리별 개수 카드 ─────────────────────────────────────────────────────
function CountGrid({ stats }: { stats: DatabaseStats }) {
    const items: CountItem[] = [
        { icon: 'mdi:chat-outline', label: '대화 기록', value: stats.chatConversations },
        { icon: 'mdi:timer-outline', label: '공부 세션', value: stats.sessions },
        { icon: 'mdi:notebook-outline', label: '일기', value: stats.diaryEntries },
        { icon: 'mdi:calendar-week-outline', label: '주간 일기', value: stats.weeklyDiaries },
        { icon: 'mdi:school-outline', label: '학습 복기 노트', value: stats.learningNotes },
        { icon: 'mdi:checkbox-marked-circle-outline', label: '할 일', value: stats.todos },
        { icon: 'mdi:thought-bubble-outline', label: '세션 메모(주차된 생각)', value: stats.thoughtNotes },
        { icon: 'mdi:robot-outline', label: 'AI 캐시', value: stats.aiArtifacts },
    ]
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {items.map((item) => (
                <div key={item.label} className="glass-card-elevated p-4 flex flex-col gap-2">
                    <Icon icon={item.icon} className="text-xl text-[var(--color-primary)] opacity-80" />
                    <div>
                        <p className="text-xl font-bold tabular-nums text-[var(--color-text)]">{item.value.toLocaleString()}</p>
                        <p className="text-[11px] text-[var(--color-text-secondary)] leading-tight mt-0.5">{item.label}</p>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── 저장소 사용량 바 ─────────────────────────────────────────────────────────
function StorageUsageBar({ stats }: { stats: DatabaseStats }) {
    if (stats.storageUsedBytes == null || stats.storageQuotaBytes == null || stats.storageQuotaBytes <= 0) return null
    const pct = Math.min(100, (stats.storageUsedBytes / stats.storageQuotaBytes) * 100)
    return (
        <div className="glass-card p-6 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Icon icon="mdi:harddisk" className="text-lg text-[var(--color-primary)]" />
                    <span className="text-sm font-medium text-[var(--color-text)]">저장소 사용량</span>
                </div>
                <span className="text-xs font-bold text-[var(--color-text-secondary)] tabular-nums">
                    {formatBytes(stats.storageUsedBytes)} / {formatBytes(stats.storageQuotaBytes)}
                </span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
                <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-purple-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={spring.default}
                />
            </div>
            <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60">
                브라우저가 이 기기에 이 앱을 위해 할당한 전체 저장 공간 중 사용된 비율입니다 (사진·백업 등 다른 앱 데이터는 포함되지 않습니다).
            </p>
        </div>
    )
}

type ActionKey = 'prune' | 'chat' | 'notes' | 'ai' | 'thoughts'

interface ConfirmState {
    key: ActionKey
    title: string
    message: string
    onConfirm: () => void
}

// ── 결과 요약 토스트 (화면 하단 고정) ────────────────────────────────────────
interface ResultToast {
    id: number
    text: string
}

export default function DataManagement() {
    const navigate = useNavigate()
    const [stats, setStats] = useState<DatabaseStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [months, setMonths] = useState<1 | 3 | 6 | 12>(3)
    const [pending, setPending] = useState<ActionKey | null>(null)
    const [confirm, setConfirm] = useState<ConfirmState | null>(null)
    const [toasts, setToasts] = useState<ResultToast[]>([])
    const [lastPruneResult, setLastPruneResult] = useState<PruneResult | null>(null)

    const refresh = useCallback(async () => {
        const s = await getDatabaseStats()
        setStats(s)
    }, [])

    useEffect(() => {
        setLoading(true)
        refresh().finally(() => setLoading(false))
    }, [refresh])

    const pushToast = (text: string) => {
        const id = Date.now() + Math.random()
        setToasts((prev) => [...prev, { id, text }])
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200)
    }

    const runAction = async (key: ActionKey, fn: () => Promise<void>) => {
        if (pending) return
        setPending(key)
        setConfirm(null)
        try {
            await fn()
        } finally {
            setPending(null)
            await refresh()
        }
    }

    const handlePrune = () => {
        setConfirm({
            key: 'prune',
            title: '오래된 데이터 정리',
            message: `최근 ${months}개월만 남기고, 그보다 오래된 공부 세션·일기·주간 일기·학습 복기 노트·AI 캐시를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`,
            onConfirm: () => runAction('prune', async () => {
                const result = await pruneDataOlderThan(months)
                setLastPruneResult(result)
                const total = result.sessions + result.diaryEntries + result.thoughtNotes + result.learningNotes + result.aiArtifacts + result.weeklyDiaries
                pushToast(total > 0 ? `${total}개 항목 정리됨` : '삭제할 오래된 데이터가 없습니다')
            }),
        })
    }

    const handleClearChat = () => {
        setConfirm({
            key: 'chat',
            title: '대화 기록 전체 삭제',
            message: 'AI 챗봇과 나눈 모든 대화 기록을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?',
            onConfirm: () => runAction('chat', async () => {
                const n = await clearChatConversations()
                pushToast(`대화 ${n}개 삭제됨`)
            }),
        })
    }

    const handleClearNotes = () => {
        setConfirm({
            key: 'notes',
            title: '학습 복기 노트 전체 삭제',
            message: '작성한 모든 학습 복기 노트를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?',
            onConfirm: () => runAction('notes', async () => {
                const n = await clearLearningNotes()
                pushToast(`학습 복기 노트 ${n}개 삭제됨`)
            }),
        })
    }

    const handleClearAi = () => {
        setConfirm({
            key: 'ai',
            title: 'AI 생성물 캐시 삭제',
            message: '아침 리포트·일기 초안 등 AI가 생성해둔 캐시를 삭제합니다. 필요하면 다시 생성할 수 있습니다. 계속할까요?',
            onConfirm: () => runAction('ai', async () => {
                const n = await clearAiArtifacts()
                pushToast(`AI 캐시 ${n}개 삭제됨`)
            }),
        })
    }

    const handleClearThoughts = () => {
        setConfirm({
            key: 'thoughts',
            title: '세션 메모(주차된 생각) 삭제',
            message: '공부 중 남긴 모든 세션 메모(주차된 생각)를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?',
            onConfirm: () => runAction('thoughts', async () => {
                const n = await clearThoughtNotes()
                pushToast(`세션 메모 ${n}개 삭제됨`)
            }),
        })
    }

    return (
        <motion.div
            className="max-w-3xl mx-auto pb-24"
            initial="initial"
            animate="animate"
            variants={staggerContainer}
        >
            {/* 헤더 */}
            <motion.div variants={staggerItem} className="flex items-center gap-3 mb-8">
                <Pressable
                    onClick={() => navigate('/settings')}
                    pressScale={0.9}
                    className="p-2 rounded-xl glass-card-elevated flex items-center justify-center flex-shrink-0"
                    aria-label="설정으로 돌아가기"
                >
                    <Icon icon="mdi:chevron-left" className="text-xl" />
                </Pressable>
                <div>
                    <h1 className="text-3xl font-bold gradient-text text-display">데이터 관리</h1>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">저장소 사용량을 확인하고 필요 없는 데이터를 정리하세요.</p>
                </div>
            </motion.div>

            {loading ? (
                <motion.div variants={staggerItem} className="glass-card p-10 flex items-center justify-center">
                    <Icon icon="mdi:loading" className="text-2xl animate-spin text-[var(--color-text-secondary)] opacity-50" />
                </motion.div>
            ) : stats ? (
                <div className="space-y-6">
                    {/* 저장소 사용량 */}
                    <motion.div variants={staggerItem}>
                        <StorageUsageBar stats={stats} />
                    </motion.div>

                    {/* 카테고리별 개수 */}
                    <motion.div variants={staggerItem}>
                        <SectionLabel>항목별 개수</SectionLabel>
                        <CountGrid stats={stats} />
                    </motion.div>

                    {/* 오래된 데이터 정리 */}
                    <motion.div variants={staggerItem}>
                        <SectionLabel>오래된 데이터 정리</SectionLabel>
                        <div className="glass-card p-6 space-y-4">
                            <div className="flex items-center gap-2">
                                <Icon icon="mdi:calendar-remove-outline" className="text-lg text-[var(--color-primary)]" />
                                <label className="text-sm font-medium text-[var(--color-text)]">보관 기간 선택 후 정리</label>
                            </div>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                                선택한 기간보다 오래된 공부 세션·일기·주간 일기·학습 복기 노트·AI 캐시를 삭제합니다. 대화 기록과 할 일은 영향받지 않습니다.
                            </p>

                            <div className="grid grid-cols-4 gap-2">
                                {([1, 3, 6, 12] as const).map((m) => (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => setMonths(m)}
                                        className={`py-2.5 rounded-xl text-sm font-bold transition-colors border ${months === m
                                            ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white border-transparent'
                                            : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                                            }`}
                                    >
                                        {m}개월
                                    </button>
                                ))}
                            </div>

                            <Pressable
                                onClick={handlePrune}
                                disabled={pending !== null}
                                pressScale={0.98}
                                className="w-full px-4 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {pending === 'prune' ? (
                                    <Icon icon="mdi:loading" className="text-base animate-spin" />
                                ) : (
                                    <Icon icon="mdi:broom" className="text-base" />
                                )}
                                최근 {months}개월만 남기고 정리
                            </Pressable>

                            {lastPruneResult && (
                                <div className="pt-3 border-t border-[var(--color-border)] flex flex-wrap gap-1.5">
                                    {([
                                        ['공부 세션', lastPruneResult.sessions],
                                        ['일기', lastPruneResult.diaryEntries],
                                        ['주간 일기', lastPruneResult.weeklyDiaries],
                                        ['학습 복기 노트', lastPruneResult.learningNotes],
                                        ['세션 메모', lastPruneResult.thoughtNotes],
                                        ['AI 캐시', lastPruneResult.aiArtifacts],
                                    ] as const).filter(([, n]) => n > 0).map(([label, n]) => (
                                        <span key={label} className="text-[10px] font-medium px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-400/20">
                                            {label} {n}개 삭제
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* 위험 구역 — 카테고리 전체 삭제 */}
                    <motion.div variants={staggerItem}>
                        <div className="flex items-center gap-2 px-1.5 mb-2">
                            <Icon icon="mdi:alert-outline" className="text-sm text-red-400" />
                            <p className="text-[11px] font-bold uppercase tracking-wider text-red-400/80">위험 구역 — 전체 삭제</p>
                        </div>
                        <div className="glass-card p-6 space-y-3 border border-red-500/15">
                            <DangerRow
                                icon="mdi:chat-remove-outline"
                                title="대화 기록 전체 삭제"
                                desc="AI 챗봇과의 모든 대화를 삭제합니다."
                                count={stats.chatConversations}
                                busy={pending === 'chat'}
                                disabled={pending !== null}
                                onClick={handleClearChat}
                            />
                            <DangerRow
                                icon="mdi:notebook-remove-outline"
                                title="학습 복기 노트 전체 삭제"
                                desc="작성한 모든 학습 복기 노트를 삭제합니다."
                                count={stats.learningNotes}
                                busy={pending === 'notes'}
                                disabled={pending !== null}
                                onClick={handleClearNotes}
                            />
                            <DangerRow
                                icon="mdi:robot-off-outline"
                                title="AI 생성물 캐시 삭제"
                                desc="아침 리포트·일기 초안 등 재생성 가능한 캐시입니다."
                                count={stats.aiArtifacts}
                                busy={pending === 'ai'}
                                disabled={pending !== null}
                                onClick={handleClearAi}
                            />
                            <DangerRow
                                icon="mdi:thought-bubble-outline"
                                title="세션 메모(주차된 생각) 삭제"
                                desc="공부 중 남긴 모든 세션 메모를 삭제합니다."
                                count={stats.thoughtNotes}
                                busy={pending === 'thoughts'}
                                disabled={pending !== null}
                                onClick={handleClearThoughts}
                                last
                            />
                        </div>
                    </motion.div>
                </div>
            ) : (
                <motion.div variants={staggerItem} className="glass-card p-10 text-center text-sm text-[var(--color-text-secondary)]">
                    데이터를 불러오지 못했습니다.
                </motion.div>
            )}

            {/* 확인 모달 */}
            <AnimatePresence>
                {confirm && (
                    <motion.div
                        key="confirm-backdrop"
                        className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setConfirm(null)}
                    >
                        <motion.div
                            className="material-chrome glass-card-elevated max-w-sm w-full p-6 space-y-4"
                            initial={{ opacity: 0, scale: 0.94, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.94, y: 10 }}
                            transition={spring.sheet}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-2 text-red-400">
                                <Icon icon="mdi:alert-circle-outline" className="text-2xl" />
                                <h2 className="text-lg font-bold text-[var(--color-text)]">{confirm.title}</h2>
                            </div>
                            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{confirm.message}</p>
                            <div className="flex gap-2 pt-1">
                                <Pressable
                                    onClick={() => setConfirm(null)}
                                    pressScale={0.97}
                                    className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] font-medium text-sm"
                                >
                                    취소
                                </Pressable>
                                <Pressable
                                    onClick={confirm.onConfirm}
                                    pressScale={0.97}
                                    className="flex-1 px-4 py-3 rounded-xl bg-red-500 text-white font-bold text-sm flex items-center justify-center gap-1.5"
                                >
                                    <Icon icon="mdi:trash-can-outline" className="text-base" /> 정말 삭제
                                </Pressable>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 결과 토스트 */}
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
                <AnimatePresence>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, y: 12, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={spring.snappy}
                            className="material-chrome px-4 py-2.5 rounded-full text-xs font-bold text-[var(--color-text)] shadow-lg flex items-center gap-2"
                        >
                            <Icon icon="mdi:check-circle-outline" className="text-sm text-green-400" />
                            {t.text}
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </motion.div>
    )
}

// ── 위험 구역 개별 행 ────────────────────────────────────────────────────────
function DangerRow({
    icon,
    title,
    desc,
    count,
    busy,
    disabled,
    onClick,
    last = false,
}: {
    icon: string
    title: string
    desc: string
    count: number
    busy: boolean
    disabled: boolean
    onClick: () => void
    last?: boolean
}) {
    return (
        <div className={`flex items-center justify-between gap-3 ${last ? '' : 'pb-3 border-b border-red-500/10'}`}>
            <div className="flex items-start gap-3 min-w-0">
                <Icon icon={icon} className="text-lg text-red-400/80 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)]">{title}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{desc}</p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60 mt-0.5">현재 {count.toLocaleString()}개</p>
                </div>
            </div>
            <Pressable
                onClick={onClick}
                disabled={disabled || count === 0}
                pressScale={0.94}
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
            >
                {busy ? <Icon icon="mdi:loading" className="text-sm animate-spin" /> : <Icon icon="mdi:trash-can-outline" className="text-sm" />}
                삭제
            </Pressable>
        </div>
    )
}
