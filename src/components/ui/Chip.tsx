/**
 * Chip — 선택 가능한 알약 버튼 (평가 태그 · 하위 항목 · 프리셋).
 *
 * 활성/비활성 클래스 삼항이 EditRecords(2곳)·Settings·Study 에 각각 복사돼 있었다.
 */
import Pressable from './Pressable';

/** 선택 색. 태그는 indigo, 공부 화면의 하위 항목은 purple 을 쓴다. */
export type ChipTone = 'indigo' | 'purple';

const ACTIVE = {
    indigo: 'fill-ink',
    purple: 'bg-white/[0.14] text-white border border-white/10',
} as const;

const IDLE = {
    indigo:
        'bg-[var(--surface-raised)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
    purple: 'text-white/45 hover:text-white/80 border border-white/[0.08]',
} as const;

interface ChipProps {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
    tone?: ChipTone;
    className?: string;
}

export default function Chip({ children, active, onClick, tone = 'indigo', className = '' }: ChipProps) {
    return (
        <Pressable
            type="button"
            onClick={onClick}
            pressScale={0.97}
            aria-pressed={active}
            className={`h-9 px-4 rounded-full text-[14px] font-medium transition-colors whitespace-nowrap ${active ? ACTIVE[tone] : IDLE[tone]} ${className}`}
        >
            {children}
        </Pressable>
    );
}
