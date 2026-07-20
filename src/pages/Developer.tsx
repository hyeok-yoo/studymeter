import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { useFocusSync } from '../lib/focusSync'
import type { ModelInfo } from '../lib/focusSync'
import { useLocalFocusLab } from '../lib/useLocalFocusLab'
import { spring, fadeRise, staggerContainer, staggerItem } from '../lib/motion'
import Pressable from '../components/ui/Pressable'

const GITHUB_URL = 'https://github.com/hyeok-yoo'
const SPONSORS_URL = 'https://github.com/sponsors/hyeok-yoo'

const DEVTOOLS_MODE_KEY = 'sm_devtools_mode' // 'local' | 'server'

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

// ── Segmented control — 선택 배경이 layoutId 스프링으로 이동 (Settings.tsx 와 동일 패턴) ──
function SegmentedControl<T extends string>({
    layoutId,
    options,
    value,
    onChange,
}: {
    layoutId: string
    options: Array<{ value: T; label: React.ReactNode; icon: string }>
    value: T
    onChange: (v: T) => void
}) {
    return (
        <div className="relative flex gap-2 p-1 rounded-2xl bg-white/5 border border-white/10">
            {options.map((opt) => {
                const active = opt.value === value
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        className="relative flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black transition-colors active:scale-[0.97]"
                    >
                        {active && (
                            <motion.div
                                layoutId={layoutId}
                                className="absolute inset-0 rounded-xl bg-indigo-500/25 border border-indigo-400/40"
                                transition={spring.default}
                            />
                        )}
                        <span className={`relative z-10 flex items-center justify-center gap-2 ${active ? 'text-indigo-300' : 'text-[var(--color-text-secondary)] opacity-60'}`}>
                            <Icon icon={opt.icon} className="text-lg" />
                            {opt.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

export default function DeveloperPage() {
    const navigate = useNavigate()

    return (
        <motion.div
            className="flex flex-col gap-10 max-w-2xl mx-auto pb-16"
            initial="initial"
            animate="animate"
            variants={staggerContainer}
        >
            {/* 뒤로 가기 */}
            <Pressable
                onClick={() => navigate(-1)}
                pressScale={0.96}
                className="self-start flex items-center gap-2 text-sm font-bold text-[var(--color-text-secondary)] hover:text-[var(--color-text)] -mb-4"
            >
                <Icon icon="mdi:arrow-left" className="text-lg" />
                돌아가기
            </Pressable>

            {/* 히어로 */}
            <motion.div
                variants={staggerItem}
                className="glass-card p-8 md:p-12 relative overflow-hidden border-none dark:bg-white/5 bg-white/40"
            >
                <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500/15 blur-[80px] rounded-full pointer-events-none" />
                <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-purple-500/15 blur-[80px] rounded-full pointer-events-none" />

                <div className="relative z-10 text-center">
                    {/* 아바타 */}
                    <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-2xl ring-4 ring-indigo-400/30">
                        <span className="text-4xl font-black text-white">Y</span>
                    </div>

                    <h1 className="text-3xl md:text-4xl font-black tracking-tight text-display text-[var(--color-text)] mb-1">
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
                variants={staggerItem}
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
                variants={staggerItem}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
                {HIGHLIGHTS.map((h) => (
                    <motion.div
                        key={h.title}
                        variants={staggerItem}
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
                variants={staggerItem}
                className="glass-card p-6 border-none dark:bg-white/5 bg-white/40"
            >
                <h2 className="text-lg font-black text-[var(--color-text)] mb-4">기술 스택</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {SKILLS.map((s) => (
                        <div key={s.label} className="glass-card-elevated flex items-center gap-2.5 p-3">
                            <Icon icon={s.icon} className="text-xl flex-shrink-0" style={{ color: s.color }} />
                            <span className="text-xs font-bold text-[var(--color-text-secondary)]">{s.label}</span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* 링크 버튼 */}
            <motion.div
                variants={staggerItem}
                className="flex flex-col sm:flex-row gap-4"
            >
                <motion.a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileTap={{ scale: 0.96 }}
                    whileHover={{ y: -2 }}
                    transition={spring.snappy}
                    className="flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-[var(--color-surface)] hover:bg-[var(--color-surface-elevated)] border border-[var(--color-border)] font-black text-[var(--color-text)] group"
                >
                    <Icon icon="mdi:github" className="text-2xl group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                        <p className="text-sm">GitHub</p>
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] opacity-60">@hyeok-yoo</p>
                    </div>
                </motion.a>

                <motion.a
                    href={SPONSORS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileTap={{ scale: 0.96 }}
                    whileHover={{ y: -2 }}
                    transition={spring.snappy}
                    className="flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-gradient-to-r from-pink-500/15 to-rose-500/15 hover:from-pink-500/25 hover:to-rose-500/25 border border-pink-400/25 font-black group"
                >
                    <Icon icon="mdi:heart" className="text-2xl text-pink-400 group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                        <p className="text-sm text-[var(--color-text)]">GitHub Sponsors</p>
                        <p className="text-xs font-medium text-pink-400/70">개발을 응원해주세요 ☕</p>
                    </div>
                </motion.a>
            </motion.div>

            {/* 개발자 도구 */}
            <motion.div variants={staggerItem}>
                <DeveloperTools />
            </motion.div>

            {/* 앱 링크 */}
            <motion.div variants={staggerItem} className="text-center">
                <p className="text-xs text-[var(--color-text-secondary)] opacity-40">
                    StudyMeter v{__APP_VERSION__} · made with ♥ in Korea
                </p>
            </motion.div>
        </motion.div>
    )
}

// ── 개발자 도구 ───────────────────────────────────────────────────────────────

function DeveloperTools() {
    const [mode, setMode] = useState<'local' | 'server'>(() =>
        localStorage.getItem(DEVTOOLS_MODE_KEY) === 'server' ? 'server' : 'local')

    const switchMode = (next: 'local' | 'server') => {
        setMode(next)
        localStorage.setItem(DEVTOOLS_MODE_KEY, next)
    }

    return (
        <div className="glass-card p-6 md:p-8 border-none dark:bg-white/5 bg-white/40 space-y-6">
            <div className="flex items-center gap-2.5">
                <Icon icon="mdi:tools" className="text-2xl text-indigo-400" />
                <h2 className="text-xl font-black gradient-text">개발자 도구</h2>
            </div>

            {/* 모드 전환: 온디바이스(기본) ↔ PC 서버 — segmented control */}
            <SegmentedControl
                layoutId="devtools-mode"
                value={mode}
                onChange={switchMode}
                options={[
                    { value: 'local', label: '온디바이스', icon: 'mdi:cellphone' },
                    { value: 'server', label: 'PC 서버', icon: 'mdi:server' },
                ]}
            />

            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={mode}
                    variants={fadeRise}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                >
                    {mode === 'local' ? <LocalLabTools /> : <ServerTools />}
                </motion.div>
            </AnimatePresence>

            {/* 고급 모드는 설정 페이지의 "고급 모드" 토글로 통합됨 */}
        </div>
    )
}

// ── PC 서버 모드 (기존 WS 기반 — 무변경 로직) ────────────────────────────────

function ServerTools() {
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
        <div className="space-y-6">
            {/* 에러 배너 */}
            {devError && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/30">
                    <Icon icon="mdi:alert-circle" className="text-lg text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="flex-1 text-sm font-bold text-red-400 leading-snug break-all">{devError}</p>
                    <Pressable
                        onClick={clearDevError}
                        pressScale={0.85}
                        className="text-red-400/60 hover:text-red-400 text-lg leading-none flex-shrink-0"
                        aria-label="닫기"
                    >
                        ×
                    </Pressable>
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
        </div>
    )
}

// ── 온디바이스(로컬) 모드 — PC 없이 수집·학습·적용 ───────────────────────────

function LocalLabTools() {
    const lab = useLocalFocusLab()
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [importMsg, setImportMsg] = useState<string | null>(null)

    const measuring = lab.status === 'running'
    const collecting = lab.collectLabel != null

    return (
        <div className="space-y-6">
            {/* 에러 배너 */}
            {lab.labError && (
                <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-400/30">
                    <Icon icon="mdi:alert-circle" className="text-lg text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="flex-1 text-sm font-bold text-red-400 leading-snug break-all">{lab.labError}</p>
                    <Pressable
                        onClick={lab.clearLabError}
                        pressScale={0.85}
                        className="text-red-400/60 hover:text-red-400 text-lg leading-none flex-shrink-0"
                        aria-label="닫기"
                    >
                        ×
                    </Pressable>
                </div>
            )}

            {/* 측정 상태 카드 */}
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2.5">
                    <motion.div
                        className="w-2.5 h-2.5 rounded-full"
                        animate={{
                            backgroundColor: measuring ? '#22c55e' : lab.status === 'starting' ? '#eab308' : '#64748b',
                        }}
                        transition={spring.snappy}
                        style={{ boxShadow: measuring ? '0 0 6px #22c55e' : 'none' }}
                    />
                    <span className="text-sm font-black text-[var(--color-text)]">
                        {measuring
                            ? `측정 중${lab.score != null ? ` — ${lab.score.toFixed(0)}점` : ''}`
                            : lab.status === 'starting' ? '카메라 시작 중...' : '측정 꺼짐'}
                    </span>
                    {measuring && lab.scoreSource && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-[var(--color-text-secondary)]">
                            {lab.scoreSource}
                        </span>
                    )}
                </div>
                <Pressable
                    onClick={measuring ? lab.stopMeasure : lab.startMeasure}
                    disabled={lab.status === 'starting'}
                    pressScale={0.95}
                    className="text-xs font-black px-3.5 py-2 rounded-xl disabled:opacity-40 bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--color-text-secondary)]"
                >
                    {measuring ? '측정 끄기' : '측정 켜기'}
                </Pressable>
            </div>

            {/* 데이터 수집 */}
            <section className="space-y-3">
                <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">
                    데이터 수집 (기기 저장)
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Pressable
                        onClick={() => lab.startCollect(0)}
                        disabled={lab.collectLabel === 0}
                        pressScale={0.96}
                        className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-300"
                    >
                        집중(0) 수집
                    </Pressable>
                    <Pressable
                        onClick={() => lab.startCollect(1)}
                        disabled={lab.collectLabel === 1}
                        pressScale={0.96}
                        className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300"
                    >
                        산만(1) 수집
                    </Pressable>
                    <Pressable
                        onClick={lab.stopCollect}
                        disabled={!collecting}
                        pressScale={0.96}
                        className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300"
                    >
                        수집 정지
                    </Pressable>
                </div>
                <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
                    {collecting ? (
                        <p className="text-sm font-bold text-[var(--color-text)]">
                            <span className="text-emerald-400">● 수집 중</span>
                            {' — 라벨: '}{lab.collectLabel === 0 ? '집중(0)' : '산만(1)'}
                            {' — 총 '}{lab.rowCount.toLocaleString()}행
                        </p>
                    ) : (
                        <p className="text-sm text-[var(--color-text-secondary)] opacity-60">
                            대기 중 — 누적 {lab.rowCount.toLocaleString()}행
                            {lab.rowCount > 0 && ` (집중 ${lab.focusedCount.toLocaleString()} / 산만 ${lab.distractedCount.toLocaleString()})`}
                        </p>
                    )}
                </div>
                {/* CSV 관리 */}
                <div className="flex flex-wrap gap-2">
                    <Pressable
                        onClick={lab.exportCsv}
                        disabled={lab.rowCount === 0}
                        pressScale={0.94}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--color-text-secondary)] disabled:opacity-40"
                    >
                        <Icon icon="mdi:export" className="text-sm" />
                        CSV 내보내기
                    </Pressable>
                    <Pressable
                        onClick={() => fileInputRef.current?.click()}
                        pressScale={0.94}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--color-text-secondary)]"
                    >
                        <Icon icon="mdi:import" className="text-sm" />
                        CSV 가져오기
                    </Pressable>
                    <Pressable
                        onClick={async () => {
                            if (window.confirm(`수집 데이터 ${lab.rowCount.toLocaleString()}행을 모두 삭제할까요?`)) {
                                await lab.clearSamples()
                            }
                        }}
                        disabled={lab.rowCount === 0}
                        pressScale={0.94}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-400/20 text-red-400 disabled:opacity-40"
                    >
                        <Icon icon="mdi:delete-outline" className="text-sm" />
                        전체 삭제
                    </Pressable>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={async (e) => {
                            const f = e.target.files?.[0]
                            if (f) {
                                const n = await lab.importCsv(f)
                                if (n > 0) setImportMsg(`${n.toLocaleString()}행 가져옴`)
                            }
                            e.target.value = ''
                        }}
                    />
                </div>
                {importMsg && (
                    <p className="text-xs font-bold text-emerald-400">✓ {importMsg}</p>
                )}
            </section>

            {/* 온디바이스 학습 */}
            <section className="space-y-3">
                <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">
                    온디바이스 학습
                </h3>
                <Pressable
                    onClick={lab.train}
                    disabled={lab.training || lab.rowCount < 40}
                    pressScale={0.97}
                    className="w-full py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300 flex items-center justify-center gap-2"
                >
                    {lab.training ? (
                        <>
                            <Icon icon="mdi:loading" className="text-lg animate-spin" />
                            학습 중...{lab.trainProgress ? ` (${lab.trainProgress.epoch}/${lab.trainProgress.totalEpochs})` : ''}
                        </>
                    ) : (
                        `이 기기에서 학습 시작 (${lab.rowCount.toLocaleString()}행 · ${lab.featureCount}피처)`
                    )}
                </Pressable>
                {lab.rowCount < 40 && !lab.training && (
                    <p className="text-xs text-[var(--color-text-secondary)] opacity-60">
                        학습에는 최소 40행(집중·산만 모두 포함)이 필요합니다.
                    </p>
                )}
                {lab.trainResult && !lab.training && (
                    lab.trainResult.ok ? (
                        <div className="px-4 py-3 rounded-2xl bg-emerald-500/12 border border-emerald-400/25">
                            <p className="text-sm font-bold text-emerald-400 break-all">
                                ✓ {lab.trainResult.name}
                                {typeof lab.trainResult.valAccuracy === 'number' &&
                                    ` — val ${(lab.trainResult.valAccuracy * 100).toFixed(1)}%`}
                                {typeof lab.trainResult.valF1 === 'number' &&
                                    ` (F1 ${lab.trainResult.valF1.toFixed(3)}, n=${lab.trainResult.nSamples?.toLocaleString()})`}
                                {' — 자동 적용됨'}
                            </p>
                        </div>
                    ) : (
                        <div className="px-4 py-3 rounded-2xl bg-red-500/12 border border-red-400/25">
                            <p className="text-sm font-bold text-red-400 break-all">
                                학습 실패 — {lab.trainResult.error ?? '알 수 없는 오류'}
                            </p>
                        </div>
                    )
                )}
            </section>

            {/* 로컬 모델 관리 */}
            <section className="space-y-3">
                <h3 className="text-sm font-black text-[var(--color-text)] uppercase tracking-wider opacity-70">
                    로컬 모델 관리
                </h3>
                {lab.models.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-secondary)] opacity-50">학습된 로컬 모델이 없습니다.</p>
                ) : (
                    <div className="space-y-2">
                        {lab.models.map((m) => {
                            const active = m.id === lab.activeModelId
                            return (
                                <div
                                    key={m.id}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${
                                        active ? 'bg-indigo-500/12 border-indigo-400/40' : 'bg-white/5 border-white/10'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-bold text-[var(--color-text)] truncate">{m.name}</p>
                                            {active && (
                                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex-shrink-0">
                                                    현재
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-[var(--color-text-secondary)] opacity-50 mt-0.5">
                                            {formatMtime(m.createdAt)} · val {(m.valAccuracy * 100).toFixed(1)}% · n={m.nSamples.toLocaleString()}
                                        </p>
                                    </div>
                                    <Pressable
                                        onClick={() => lab.applyModel(active ? null : m.id!)}
                                        pressScale={0.94}
                                        className="flex-shrink-0 text-xs font-black px-3.5 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300"
                                    >
                                        {active ? '해제' : '적용'}
                                    </Pressable>
                                    <Pressable
                                        onClick={async () => {
                                            if (window.confirm(`모델 "${m.name}"을 삭제할까요?`)) await lab.deleteModel(m.id!)
                                        }}
                                        pressScale={0.9}
                                        className="flex-shrink-0 text-xs font-black px-2.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-400/20 text-red-400"
                                        aria-label="모델 삭제"
                                    >
                                        <Icon icon="mdi:delete-outline" className="text-sm" />
                                    </Pressable>
                                </div>
                            )
                        })}
                    </div>
                )}
                <p className="text-xs text-[var(--color-text-secondary)] opacity-50 leading-snug">
                    적용된 로컬 모델은 Study 탭 측정에서도 최우선으로 사용됩니다 (로컬 &gt; ONNX &gt; 휴리스틱).
                </p>
            </section>
        </div>
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
                <Pressable
                    onClick={() => onStart(0)}
                    disabled={active}
                    pressScale={0.96}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-300"
                >
                    집중(0) 수집
                </Pressable>
                <Pressable
                    onClick={() => onStart(1)}
                    disabled={active}
                    pressScale={0.96}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300"
                >
                    산만(1) 수집
                </Pressable>
                <Pressable
                    onClick={onStop}
                    disabled={!active}
                    pressScale={0.96}
                    className="flex-1 py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-40 disabled:cursor-not-allowed bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300"
                >
                    수집 정지
                </Pressable>
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
            <Pressable
                onClick={onStart}
                disabled={running}
                pressScale={0.97}
                className="w-full py-3 px-4 rounded-2xl font-black text-sm disabled:opacity-50 disabled:cursor-not-allowed bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300 flex items-center justify-center gap-2"
            >
                {running ? (
                    <>
                        <Icon icon="mdi:loading" className="text-lg animate-spin" />
                        학습 중...
                    </>
                ) : (
                    '학습 시작'
                )}
            </Pressable>
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
                <Pressable
                    onClick={onRefresh}
                    pressScale={0.94}
                    className="text-xs font-bold px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[var(--color-text-secondary)] flex items-center gap-1.5"
                >
                    <Icon icon="mdi:refresh" className="text-sm" />
                    목록 새로고침
                </Pressable>
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
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${
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
                            <Pressable
                                onClick={() => onApply(m.name)}
                                disabled={m.active}
                                pressScale={0.94}
                                className="flex-shrink-0 text-xs font-black px-3.5 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300"
                            >
                                {m.active ? '적용됨' : '적용'}
                            </Pressable>
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

