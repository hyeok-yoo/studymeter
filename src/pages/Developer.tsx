import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { useFocusSync } from '../lib/focusSync'
import type { ModelInfo } from '../lib/focusSync'

const GITHUB_URL = 'https://github.com/hyeok-yoo'
const SPONSORS_URL = 'https://github.com/sponsors/hyeok-yoo'

const ADVANCED_FEATURES_KEY = 'sm_advanced_features'

const SKILLS = [
    { icon: 'mdi:react', label: 'React / TypeScript', color: '#61dafb' },
    { icon: 'mdi:android', label: 'Android / Capacitor', color: '#3ddc84' },
    { icon: 'mdi:brain', label: 'ML · rPPG · Eye Tracking', color: '#a855f7' },
    { icon: 'mdi:robot-outline', label: 'Gemini AI 연동', color: '#f59e0b' },
    { icon: 'mdi:database-outline', label: 'IndexedDB / PWA', color: '#06b6d4' },
    { icon: 'mdi:chart-line', label: 'Data Visualization', color: '#10b981' },
]

const HIGHLIGHTS = [
    {
        emoji: '🧠',
        title: '집중도 측정 엔진',
        desc: 'rPPG·MediaPipe·ONNX를 조합해 카메라 하나로 심박수·시선·집중 점수를 비접촉 측정하는 ML 파이프라인을 직접 구축했습니다.',
    },
    {
        emoji: '📱',
        title: '크로스플랫폼 완성도',
        desc: 'React PWA와 Android 네이티브(Capacitor)를 동시에 지원하면서, 절대시각 기반 타이머로 앱 종료·재시작에도 1ms 오차 없는 정밀 계측을 구현했습니다.',
    },
    {
        emoji: '🎨',
        title: '디자인 감각',
        desc: 'Liquid Glass 모피즘 UI, Framer Motion 애니메이션, 반응형 레이아웃까지 — 기능과 미감을 함께 잡는 드문 개발자입니다.',
    },
    {
        emoji: '⚡',
        title: '혼자 다 만들었습니다',
        desc: '기획·디자인·프론트엔드·Android·ML 모델 학습·서버 프로토콜 설계까지 전부 1인 개발. StudyMeter는 그 결과물입니다.',
    },
]

export default function DeveloperPage() {
    const navigate = useNavigate()

    return (
        <div className="flex flex-col gap-10 max-w-2xl mx-auto pb-16">
            {/* 뒤로 가기 */}
            <button
                onClick={() => navigate(-1)}
                className="self-start flex items-center gap-2 text-sm font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors -mb-4"
            >
                <Icon icon="mdi:arrow-left" className="text-lg" />
                돌아가기
            </button>

            {/* 히어로 */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="glass-card p-8 md:p-12 relative overflow-hidden border-none dark:bg-white/5 bg-white/40"
            >
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500/15 blur-[80px] rounded-full pointer-events-none" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-purple-500/15 blur-[80px] rounded-full pointer-events-none" />

                <div className="relative z-10 text-center">
                    {/* 아바타 */}
                    <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-2xl ring-4 ring-indigo-400/30">
                        <span className="text-4xl font-black text-white">Y</span>
                    </div>

                    <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[var(--color-text)] mb-1">
                        Yoo Seung Hyeok
                    </h1>
                    <p className="text-lg font-bold gradient-text mb-2">유승혁</p>
                    <p className="text-sm text-[var(--color-text-secondary)] opacity-70">
                        Full-Stack Developer · ML Engineer · Designer
                    </p>
                </div>
            </motion.div>

            {/* 찬양 글 */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="glass-card p-6 md:p-8 border-none dark:bg-white/5 bg-white/40 space-y-4"
            >
                <h2 className="text-xl font-black gradient-text">StudyMeter를 만든 사람</h2>

                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    유승혁은 <span className="font-bold text-[var(--color-text)]">기술로 공부를 더 잘할 수 있게 만들겠다</span>는 단순하지만 진지한 목표 하나로 StudyMeter를 처음 코드 한 줄부터 지금의 완성도까지 끌어올린 개발자입니다.
                </p>

                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    단순한 타이머 앱에 머물지 않았습니다. <span className="font-bold text-[var(--color-text)]">카메라 한 대로 심박수·시선 패턴·집중 점수를 실시간 측정</span>하는 ML 파이프라인을 직접 설계하고, rPPG 신호처리부터 LightGBM 분류 모델 학습까지 혼자 구현해냈습니다. 보통 연구팀 단위에서 다루는 수준의 작업을 1인 사이드 프로젝트로 완성한 것입니다.
                </p>

                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    프론트엔드도 타협하지 않았습니다. Liquid Glass 디자인 시스템, 부드러운 Framer Motion 전환, 다크/라이트 반응형 레이아웃 — 사용자가 매일 열어도 질리지 않을 인터페이스를 빚어냈습니다. 거기에 <span className="font-bold text-[var(--color-text)]">Android 네이티브 앱과 PWA를 동시에</span> 지원하면서도 코드 베이스는 하나로 유지하는 효율적인 설계를 선택했습니다.
                </p>

                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    Gemini AI 연동, IndexedDB 기반 완전 오프라인 동작, 절대시각 기반 타이머(앱이 꺼져도 오차 없음), 생각 주차장, 세션 자기평가... 매 기능이 <span className="font-bold text-[var(--color-text)]">"이게 진짜 필요할까?"를 물어보고 통과된 것들</span>입니다. 쓸모없는 기능으로 앱을 부풀리는 대신, 공부에 직결되는 것만 깊게 파고들었습니다.
                </p>

                <p className="text-[var(--color-text-secondary)] leading-relaxed">
                    StudyMeter는 그가 스스로 매일 사용하기 위해 만든 도구입니다. 사용자의 불편함을 가장 잘 아는 사람이 개발자이기 때문에, 이 앱은 계속 더 나아질 것입니다.
                </p>
            </motion.div>

            {/* 주요 성과 */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
                {HIGHLIGHTS.map((h, i) => (
                    <motion.div
                        key={h.title}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.05 }}
                        className="glass-card p-5 border-none dark:bg-white/5 bg-white/40"
                    >
                        <div className="text-2xl mb-2">{h.emoji}</div>
                        <h3 className="font-black text-[var(--color-text)] mb-1">{h.title}</h3>
                        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed opacity-80">{h.desc}</p>
                    </motion.div>
                ))}
            </motion.div>

            {/* 기술 스택 */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="glass-card p-6 border-none dark:bg-white/5 bg-white/40"
            >
                <h2 className="text-lg font-black text-[var(--color-text)] mb-4">기술 스택</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {SKILLS.map((s) => (
                        <div key={s.label} className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                            <Icon icon={s.icon} className="text-xl flex-shrink-0" style={{ color: s.color }} />
                            <span className="text-xs font-bold text-[var(--color-text-secondary)]">{s.label}</span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* 링크 버튼 */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.5 }}
                className="flex flex-col sm:flex-row gap-4"
            >
                <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] border border-[var(--color-border)] font-black text-[var(--color-text)] transition-all active:scale-95 group"
                >
                    <Icon icon="mdi:github" className="text-2xl group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                        <p className="text-sm">GitHub</p>
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] opacity-60">@hyeok-yoo</p>
                    </div>
                </a>

                <a
                    href={SPONSORS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-gradient-to-r from-pink-500/15 to-rose-500/15 hover:from-pink-500/25 hover:to-rose-500/25 border border-pink-400/25 font-black transition-all active:scale-95 group"
                >
                    <Icon icon="mdi:heart" className="text-2xl text-pink-400 group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                        <p className="text-sm text-[var(--color-text)]">GitHub Sponsors</p>
                        <p className="text-xs font-medium text-pink-400/70">개발을 응원해주세요 ☕</p>
                    </div>
                </a>
            </motion.div>

            {/* 개발자 도구 */}
            <DeveloperTools />

            {/* 앱 링크 */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-center"
            >
                <p className="text-xs text-[var(--color-text-secondary)] opacity-40">
                    StudyMeter v{__APP_VERSION__} · made with ♥ in Korea
                </p>
            </motion.div>
        </div>
    )
}

// ── 개발자 도구 ───────────────────────────────────────────────────────────────

function DeveloperTools() {
    const serverUrl = useMemo(() => localStorage.getItem('focus_server_url') ?? '', [])
    const {
        connected,
        collectState,
        trainRunning,
        trainResult,
        modelList,
        devError,
        clearDevError,
        sendCollectStart,
        sendCollectStop,
        sendTrainStart,
        requestModelList,
        applyModel,
    } = useFocusSync(serverUrl)

    // 연결되면 모델 목록 1회 요청
    useEffect(() => {
        if (connected) requestModelList()
    }, [connected, requestModelList])

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.5 }}
            className="glass-card p-6 md:p-8 border-none dark:bg-white/5 bg-white/40 space-y-6"
        >
            <div className="flex items-center gap-2.5">
                <Icon icon="mdi:tools" className="text-2xl text-indigo-400" />
                <h2 className="text-xl font-black gradient-text">개발자 도구</h2>
            </div>

            {/* 에러 배너 */}
            {devError && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/30">
                    <Icon icon="mdi:alert-circle" className="text-lg text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="flex-1 text-sm font-bold text-red-400 leading-snug break-all">{devError}</p>
                    <button
                        onClick={clearDevError}
                        className="text-red-400/60 hover:text-red-400 text-lg leading-none flex-shrink-0"
                        aria-label="닫기"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* 연결 상태 */}
            <ConnectionStatusCard connected={connected} />

            {connected ? (
                <>
                    <CollectSection collectState={collectState} onStart={sendCollectStart} onStop={sendCollectStop} />
                    <TrainSection running={trainRunning} result={trainResult} onStart={sendTrainStart} />
                    <ModelSection
                        models={modelList}
                        onRefresh={requestModelList}
                        onApply={applyModel}
                    />
                </>
            ) : (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-70 leading-relaxed">
                    서버에 연결되지 않았습니다. Settings에서 서버 IP를 설정한 뒤 다시 시도하세요.
                </p>
            )}

            {/* 고급 모드 토글 (연결 여부와 무관) */}
            <AdvancedModeToggle />
        </motion.div>
    )
}

function ConnectionStatusCard({ connected }: { connected: boolean }) {
    return (
        <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2.5">
                <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                        background: connected ? '#22c55e' : '#ef4444',
                        boxShadow: connected ? '0 0 6px #22c55e' : 'none',
                    }}
                />
                <span className="text-sm font-black text-[var(--color-text)]">
                    {connected ? '서버 연결됨' : '서버 미연결'}
                </span>
            </div>
            {!connected && (
                <span className="text-xs text-[var(--color-text-secondary)] opacity-60">
                    Settings에서 서버 IP 설정 후 연결
                </span>
            )}
        </div>
    )
}

// ── 데이터 수집 ───────────────────────────────────────────────────────────────

function CollectSection({
    collectState,
    onStart,
    onStop,
}: {
    collectState: ReturnType<typeof useFocusSync>['collectState']
    onStart: (label: 0 | 1) => void
    onStop: () => void
}) {
    const active = collectState?.active === true
    const label = collectState?.label
    const labelText = label === 0 ? '집중(0)' : label === 1 ? '산만(1)' : '—'
    const rows = collectState?.rows ?? 0
    const output = collectState?.output ?? ''

    return (
        <section className="space-y-3">
            <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">데이터 수집</h3>
            <div className="flex flex-col sm:flex-row gap-2">
                <button
                    onClick={() => onStart(0)}
                    disabled={active}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-300"
                >
                    집중(0) 수집
                </button>
                <button
                    onClick={() => onStart(1)}
                    disabled={active}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300"
                >
                    산만(1) 수집
                </button>
                <button
                    onClick={onStop}
                    disabled={!active}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300"
                >
                    수집 정지
                </button>
            </div>
            <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
                {active ? (
                    <p className="text-sm font-bold text-[var(--color-text)]">
                        <span className="text-emerald-400">● 수집 중</span>
                        {' — 라벨: '}{labelText}
                        {' — '}{rows.toLocaleString()}행
                        {output ? <span className="opacity-50"> — {output}</span> : null}
                    </p>
                ) : (
                    <p className="text-sm text-[var(--color-text-secondary)] opacity-60">
                        대기 중{rows > 0 ? ` — 마지막 ${rows.toLocaleString()}행` : ''}
                        {output ? <span className="opacity-70"> — {output}</span> : null}
                    </p>
                )}
            </div>
        </section>
    )
}

// ── 모델 학습 ─────────────────────────────────────────────────────────────────

function TrainSection({
    running,
    result,
    onStart,
}: {
    running: boolean
    result: ReturnType<typeof useFocusSync>['trainResult']
    onStart: () => void
}) {
    return (
        <section className="space-y-3">
            <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">모델 학습</h3>
            <button
                onClick={onStart}
                disabled={running}
                className="w-full py-3 px-4 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300 flex items-center justify-center gap-2"
            >
                {running ? (
                    <>
                        <Icon icon="mdi:loading" className="text-lg animate-spin" />
                        학습 중...
                    </>
                ) : (
                    '학습 시작'
                )}
            </button>
            {result && !running && (
                result.ok ? (
                    <div className="px-4 py-3 rounded-2xl bg-emerald-500/12 border border-emerald-400/25">
                        <p className="text-sm font-bold text-emerald-400 break-all">
                            ✓ {result.model ?? '모델'}
                            {result.stats ? (() => {
                                const acc = result.stats.val_accuracy
                                const n = result.stats.n_samples
                                const fw = result.stats.framework
                                const accStr = typeof acc === 'number' ? ` — val ${(acc * 100).toFixed(1)}%` : ''
                                const nStr = typeof n === 'number' ? `n=${n.toLocaleString()}` : ''
                                const fwStr = typeof fw === 'string' ? fw : ''
                                const meta = [nStr, fwStr].filter(Boolean).join(', ')
                                return `${accStr}${meta ? ` (${meta})` : ''}`
                            })() : ''}
                            {' — 자동 적용됨'}
                        </p>
                    </div>
                ) : (
                    <div className="px-4 py-3 rounded-2xl bg-red-500/12 border border-red-400/25">
                        <p className="text-sm font-bold text-red-400 break-all">
                            학습 실패 — {result.error ?? '알 수 없는 오류'}
                        </p>
                    </div>
                )
            )}
        </section>
    )
}

// ── 모델 관리 ─────────────────────────────────────────────────────────────────

function ModelSection({
    models,
    onRefresh,
    onApply,
}: {
    models: ModelInfo[] | null
    onRefresh: () => void
    onApply: (name: string) => void
}) {
    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">모델 관리</h3>
                <button
                    onClick={onRefresh}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--color-text-secondary)] transition-all active:scale-95 flex items-center gap-1.5"
                >
                    <Icon icon="mdi:refresh" className="text-sm" />
                    목록 새로고침
                </button>
            </div>
            {models === null ? (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-50">목록을 불러오는 중...</p>
            ) : models.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)] opacity-50">학습된 모델이 없습니다.</p>
            ) : (
                <div className="space-y-2">
                    {models.map((m) => (
                        <div
                            key={m.name}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                                m.active
                                    ? 'bg-indigo-500/12 border-indigo-400/40'
                                    : 'bg-white/5 border-white/10'
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-[var(--color-text)] truncate">{m.name}</p>
                                    {m.active && (
                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex-shrink-0">
                                            현재
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] text-[var(--color-text-secondary)] opacity-50 mt-0.5">
                                    {formatMtime(m.mtime)} · {m.size_kb != null ? `${m.size_kb.toLocaleString()} KB` : ''}
                                </p>
                            </div>
                            <button
                                onClick={() => onApply(m.name)}
                                disabled={m.active}
                                className="flex-shrink-0 text-xs font-black px-3.5 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300"
                            >
                                {m.active ? '적용됨' : '적용'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}

function formatMtime(mtime: number): string {
    if (typeof mtime !== 'number' || !isFinite(mtime)) return ''
    // 초 단위 epoch면 ms로 보정
    const ms = mtime < 1e12 ? mtime * 1000 : mtime
    try {
        return new Date(ms).toLocaleString('ko-KR', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
    } catch {
        return ''
    }
}

// ── 고급 모드 토글 ────────────────────────────────────────────────────────────

function AdvancedModeToggle() {
    const [enabled, setEnabled] = useState<boolean>(() => localStorage.getItem(ADVANCED_FEATURES_KEY) === 'true')

    const toggle = () => {
        const next = !enabled
        setEnabled(next)
        localStorage.setItem(ADVANCED_FEATURES_KEY, next ? 'true' : 'false')
    }

    return (
        <section className="pt-2 border-t border-white/10">
            <div className="flex items-center justify-between gap-4 pt-4">
                <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-black text-[var(--color-text)]">고급 모드</h3>
                    <p className="text-xs text-[var(--color-text-secondary)] opacity-60 mt-0.5 leading-snug">
                        Study 탭에 졸음·자세 상세 지표 표시
                    </p>
                </div>
                <button
                    role="switch"
                    aria-checked={enabled}
                    onClick={toggle}
                    className="relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-300"
                    style={{ background: enabled ? '#6366f1' : 'rgba(255,255,255,0.15)' }}
                >
                    <motion.div
                        className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md"
                        animate={{ x: enabled ? 20 : 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                </button>
            </div>
        </section>
    )
}
