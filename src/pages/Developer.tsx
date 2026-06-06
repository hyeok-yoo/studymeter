import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'

const GITHUB_URL = 'https://github.com/hyeok-yoo'
const SPONSORS_URL = 'https://github.com/sponsors/hyeok-yoo'

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
