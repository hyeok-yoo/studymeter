/**
 * Segmented — 선택 배경이 layoutId 스프링으로 미끄러지는 세그먼티드 컨트롤.
 *
 * 같은 패턴이 Settings/Records(2곳)/EditRecords/Study(집중도 탭·측정 모드)에
 * 각각 손으로 다시 짜여 있었다. 시각 변형은 `tone` 하나로 흡수한다.
 */
import { motion } from 'framer-motion';
import { spring } from '../../lib/motion';

/**
 * 선택 배경의 시각 톤.
 *  brand  — 밝은 화면 기본 (그라데이션 알약)
 *  glass  — 공부 화면의 어두운 유리
 *  accent — 개발자 도구의 인디고 알약
 */
export type SegmentedTone = keyof typeof TONE;

const TONE = {
    brand: {
        track: 'bg-[var(--color-surface)] border border-[var(--color-border)]',
        fill: 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)]',
        on: 'text-white',
        off: 'text-[var(--color-text-secondary)]',
    },
    // 공부 화면의 어두운 유리 위. 값은 이전 인라인 스타일과 정확히 같게 유지한다.
    glass: {
        track: 'bg-[rgba(255,255,255,0.04)] border border-transparent',
        fill: 'bg-[rgba(129,140,248,0.25)] border border-[rgba(129,140,248,0.35)]',
        on: 'text-[#a5b4fc]',
        off: 'text-[rgba(255,255,255,0.35)]',
    },
    accent: {
        track: 'bg-white/5 border border-white/10',
        fill: 'bg-indigo-500/25 border border-indigo-400/40',
        on: 'text-indigo-300',
        off: 'text-[var(--color-text-secondary)] opacity-60',
    },
} as const;

// 같은 속성을 바깥에서 덮어쓰면 Tailwind 는 클래스 순서가 아니라 스타일시트 순서로
// 이기므로, 변형마다 달라지는 값(gap·radius·굵기)은 전부 토큰이 직접 들고 있어야 한다.
const SIZE = {
    md: { track: 'gap-1 rounded-xl p-1', button: 'py-2.5 px-3 text-sm font-medium', pill: 'rounded-lg', label: 'gap-1.5' },
    sm: { track: 'gap-1 rounded-xl p-0.5', button: 'py-1 px-2 text-[10px] font-medium', pill: 'rounded-lg', label: 'gap-1.5' },
    /** 집중도 탭 바 */
    tab: { track: 'gap-1 rounded-xl p-1', button: 'py-1.5 text-[11px] font-bold', pill: 'rounded-lg', label: 'gap-1.5' },
    /** 측정 모드 선택 — 두 줄짜리 라벨이 들어가 조금 더 높다 */
    mode: { track: 'gap-1 rounded-xl p-1', button: 'py-2 text-[11px] font-extrabold', pill: 'rounded-lg', label: 'gap-1.5' },
    /** 개발자 도구 — 아이콘 + 라벨이 들어가는 큰 탭 */
    lg: { track: 'gap-2 rounded-2xl p-1', button: 'py-2.5 text-sm font-black', pill: 'rounded-xl', label: 'gap-2' },
} as const;

interface SegmentedProps<T extends string> {
    /** 스프링 배경을 공유할 고유 id — 화면 안에서 유일해야 한다 */
    layoutId: string;
    options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
    value: T;
    onChange: (v: T) => void;
    size?: keyof typeof SIZE;
    tone?: SegmentedTone;
    className?: string;
    /** 전환을 막는다 (측정 시작 중 등) */
    disabled?: boolean;
}

export default function Segmented<T extends string>({
    layoutId,
    options,
    value,
    onChange,
    size = 'md',
    tone = 'brand',
    className = '',
    disabled = false,
}: SegmentedProps<T>) {
    const t = TONE[tone];
    const s = SIZE[size];
    return (
        <div className={`relative flex ${s.track} ${t.track} ${className}`}>
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        disabled={disabled}
                        className={`relative flex-1 transition-colors active:scale-[0.97] disabled:cursor-not-allowed ${s.button}`}
                    >
                        {active && (
                            <motion.div
                                layoutId={layoutId}
                                className={`absolute inset-0 ${s.pill} ${t.fill}`}
                                transition={spring.default}
                            />
                        )}
                        <span
                            className={`relative z-10 flex items-center justify-center whitespace-nowrap ${s.label} ${active ? t.on : t.off}`}
                        >
                            {opt.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
