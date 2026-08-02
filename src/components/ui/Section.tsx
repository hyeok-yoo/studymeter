/**
 * Section — iOS 설정 스타일의 라벨·행·스위치.
 *
 * Settings 안에만 있던 것을 꺼내 DataManagement/Developer 등이 각자 복사해 둔
 * 사본을 없앤다. 섹션 헤더(라벨 + HelpButton + 우측 액션)는 손으로 열 번 넘게
 * 조립돼 있어 `SectionHeader` 로 묶었다.
 */
import { motion } from 'framer-motion';
import { spring } from '../../lib/motion';

/** 카드 위 작은 대문자 라벨 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-1.5 mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
            {children}
        </p>
    );
}

/** 라벨(+도움말) 왼쪽 · 액션 오른쪽인 섹션 헤더 */
export function SectionHeader({ label, help, action }: {
    label: React.ReactNode;
    /** 보통 <HelpButton/> */
    help?: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between px-1.5 mb-2">
            <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
                    {label}
                </span>
                {help}
            </div>
            {action}
        </div>
    );
}

/** 카드 안의 행 — 라벨 왼쪽 · 컨트롤 오른쪽, 구분선으로 정렬 */
export function Row({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
    return (
        <div
            className={`flex items-center justify-between gap-4 px-5 py-4 ${first ? '' : 'border-t border-[var(--color-border)]'}`}
        >
            {children}
        </div>
    );
}

/** 작은 토글 스위치 */
export function Toggle({ enabled, onChange, label }: {
    enabled: boolean;
    onChange: () => void;
    label?: string;
}) {
    return (
        <motion.button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={label}
            onClick={onChange}
            whileTap={{ scale: 0.92 }}
            transition={spring.snappy}
            className="relative flex-shrink-0 w-12 h-7 rounded-full transition-colors duration-300"
            style={{ background: enabled ? 'var(--color-primary)' : 'rgba(120,120,128,0.24)' }}
        >
            <motion.div
                className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md"
                animate={{ x: enabled ? 20 : 0 }}
                transition={spring.snappy}
            />
        </motion.button>
    );
}
