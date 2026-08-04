/**
 * Segmented — 선택 배경이 layoutId 스프링으로 미끄러지는 세그먼티드 컨트롤.
 *
 * 같은 패턴이 Settings/Records(2곳)/EditRecords/Study(집중도 탭·측정 모드)에
 * 각각 손으로 다시 짜여 있었다. 시각 변형은 `tone` 하나로 흡수한다.
 */
import { motion } from 'framer-motion';
import { spring } from '../../lib/motion';

/** 선택 배경의 시각 톤 — 밝은 화면 기본(brand) vs 공부 화면의 어두운 유리(glass) */
export type SegmentedTone = 'brand' | 'glass';

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
} as const;

const SIZE = {
    md: { track: 'p-1', button: 'py-2.5 px-3 text-sm' },
    sm: { track: 'p-0.5', button: 'py-1 px-2 text-[10px]' },
    /** 집중도 탭 바 */
    tab: { track: 'p-1', button: 'py-1.5 text-[11px] font-bold' },
    /** 측정 모드 선택 — 두 줄짜리 라벨이 들어가 조금 더 높다 */
    mode: { track: 'p-1', button: 'py-2 text-[11px] font-extrabold' },
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
        <div className={`relative flex gap-1 rounded-xl ${t.track} ${s.track} ${className}`}>
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        disabled={disabled}
                        className={`relative flex-1 rounded-lg font-medium transition-colors active:scale-[0.97] disabled:cursor-not-allowed ${s.button}`}
                    >
                        {active && (
                            <motion.div
                                layoutId={layoutId}
                                className={`absolute inset-0 rounded-lg ${t.fill}`}
                                transition={spring.default}
                            />
                        )}
                        <span
                            className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${active ? t.on : t.off}`}
                        >
                            {opt.label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
