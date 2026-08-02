/**
 * Chip — 선택 가능한 알약 버튼 (평가 태그 · 하위 항목 · 프리셋).
 *
 * 활성/비활성 클래스 삼항이 EditRecords(2곳)·Settings·Study 에 각각 복사돼 있었다.
 */
import Pressable from './Pressable';

/** 선택 색. 태그는 indigo, 공부 화면의 하위 항목은 purple 을 쓴다. */
export type ChipTone = 'indigo' | 'purple';

const ACTIVE = {
    indigo: 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20',
    purple: 'bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.3)]',
} as const;

const IDLE = {
    indigo:
        'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-indigo-500/10',
    purple: 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/80 border border-white/5',
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
            pressScale={0.95}
            aria-pressed={active}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap ${active ? ACTIVE[tone] : IDLE[tone]} ${className}`}
        >
            {children}
        </Pressable>
    );
}
