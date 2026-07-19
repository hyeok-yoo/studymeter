/**
 * Sheet — 제스처로 끌어서 닫을 수 있는 바텀 시트.
 *
 * Apple 시트 규칙 구현:
 *  - 드래그는 손가락과 1:1, 위쪽 경계는 러버밴딩
 *  - 릴리즈 시 속도의 "부호"로 닫힘/복귀 결정 + 운동량을 스프링에 넘겨 이음새 없음
 *  - 스프링이라 닫히는 중에도 다시 잡아 되돌릴 수 있음 (interruptible)
 *  - 등장/퇴장은 같은 경로(아래) — 공간적 일관성
 *  - reduced-motion 이면 짧은 크로스페이드로 대체
 */
import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import { spring, prefersReducedMotion } from '../../lib/motion';

interface SheetProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    /** 시트 위 그랩 핸들 표시 (기본 true) */
    handle?: boolean;
    /** 콘텐츠 최대 높이 (기본 90dvh) */
    maxHeight?: string;
    /** z-index (기본 9500 — 졸음 방지 오버레이(10000)보다는 아래) */
    zIndex?: number;
    /** 배경 스크림 탭으로 닫기 (기본 true) */
    dismissOnScrim?: boolean;
    ariaLabel?: string;
}

const CLOSE_DISTANCE = 120; // px — 속도가 없을 때의 닫힘 임계
const CLOSE_VELOCITY = 500; // px/s — 이 이상 아래로 플릭하면 거리와 무관하게 닫힘

export default function Sheet({
    open,
    onClose,
    children,
    handle = true,
    maxHeight = '90dvh',
    zIndex = 9500,
    dismissOnScrim = true,
    ariaLabel,
}: SheetProps) {
    const dragControls = useDragControls();
    const reduced = prefersReducedMotion();

    const handleDragEnd = useCallback(
        (_: unknown, info: PanInfo) => {
            // 속도의 부호가 의도를 말한다: 아래로 플릭 → 닫기, 위로 → 복귀
            if (info.velocity.y > CLOSE_VELOCITY) return onClose();
            if (info.velocity.y < -CLOSE_VELOCITY) return; // 위로 던짐 → 유지
            if (info.offset.y > CLOSE_DISTANCE) return onClose();
        },
        [onClose],
    );

    const sheet = (
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 flex items-end justify-center" style={{ zIndex }}>
                    {/* Scrim */}
                    <motion.div
                        className="absolute inset-0"
                        style={{ background: 'var(--scrim)' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={dismissOnScrim ? onClose : undefined}
                    />

                    {/* Sheet */}
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={ariaLabel}
                        className="relative w-full max-w-2xl material-chrome overflow-hidden"
                        style={{
                            borderRadius: '28px 28px 0 0',
                            maxHeight,
                            paddingBottom: 'env(safe-area-inset-bottom)',
                            touchAction: 'none',
                        }}
                        initial={reduced ? { opacity: 0 } : { y: '100%' }}
                        animate={reduced ? { opacity: 1 } : { y: 0 }}
                        exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { y: '100%' }}
                        transition={spring.sheet}
                        drag={reduced ? false : 'y'}
                        dragControls={dragControls}
                        dragListener={true}
                        // 위쪽 경계는 러버밴딩(dragElastic), 아래는 자유
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0.08, bottom: 0.9 }}
                        dragMomentum={false}
                        onDragEnd={handleDragEnd}
                    >
                        {handle && (
                            <div className="flex justify-center pt-3 pb-1">
                                <div className="w-10 h-1.5 rounded-full bg-[var(--color-text-secondary)] opacity-30" />
                            </div>
                        )}
                        <div
                            className="overflow-y-auto overscroll-contain px-5 pb-5"
                            style={{ maxHeight: `calc(${maxHeight} - 2rem)`, touchAction: 'pan-y' }}
                        >
                            {children}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );

    return createPortal(sheet, document.body);
}
