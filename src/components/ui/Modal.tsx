/**
 * Modal — 앱의 유일한 중앙 모달 껍데기.
 *
 * 이전에는 페이지·컴포넌트마다 `fixed inset-0 z-[9999]` + 스크림 + 스프링 패널을
 * 손으로 다시 짰다(10곳 이상). 그 결과 스크림 색·z-index·애니메이션·Esc 처리가
 * 곳곳에서 조금씩 달랐다. 여기 한 곳만 고치면 전부 같이 고쳐진다.
 *
 * 바텀 시트가 필요하면 `ui/Sheet` 를 쓴다 (제스처로 끌어 닫는 별개 규칙).
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { materialize } from '../../lib/motion';

interface ModalProps {
    open: boolean;
    /** 스크림 탭·Esc 로 닫기. 생략하면 닫히지 않는 모달(강제 확인용). */
    onClose?: () => void;
    children: React.ReactNode;
    /** 패널 최대 너비 유틸리티 (기본 max-w-sm) */
    width?: string;
    /** 패널에 덧붙일 클래스 — 패딩·정렬 등 */
    className?: string;
    /** 스크림 클래스. 생략하면 앱 표준 스크림(--scrim) */
    scrim?: string;
    /** 졸음 경고(10000) 아래, 시트(9500) 위가 기본 */
    zIndex?: number;
    ariaLabel?: string;
}

export default function Modal({
    open,
    onClose,
    children,
    width = 'max-w-sm',
    className = '',
    scrim,
    zIndex = 9999,
    ariaLabel,
}: ModalProps) {
    useEffect(() => {
        if (!open || !onClose) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return createPortal(
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex }}>
                    <motion.div
                        className={`absolute inset-0 ${scrim ?? ''}`}
                        style={scrim ? undefined : { background: 'var(--scrim)' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={onClose}
                    />
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={ariaLabel}
                        variants={materialize}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={`relative w-full ${width} liquid-modal shadow-2xl ${className}`}
                    >
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
