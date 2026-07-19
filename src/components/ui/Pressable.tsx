/**
 * Pressable — 눌림 피드백이 pointer-down 즉시 오는 공용 버튼.
 * 스프링 기반이라 눌렀다 떼는 동작이 언제든 끊기고 되돌아갈 수 있다.
 */
import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';
import { spring } from '../../lib/motion';

interface PressableProps extends HTMLMotionProps<'button'> {
    /** 눌림 스케일 (기본 0.97 — 큰 버튼은 0.98, 작은 칩은 0.95 권장) */
    pressScale?: number;
    /** hover 가능한 기기에서의 리프트 (기본 없음) */
    hoverLift?: boolean;
}

const Pressable = forwardRef<HTMLButtonElement, PressableProps>(
    ({ pressScale = 0.97, hoverLift = false, children, ...props }, ref) => (
        <motion.button
            ref={ref}
            whileTap={{ scale: pressScale }}
            whileHover={hoverLift ? { y: -2 } : undefined}
            transition={spring.snappy}
            {...props}
        >
            {children}
        </motion.button>
    ),
);

Pressable.displayName = 'Pressable';
export default Pressable;
