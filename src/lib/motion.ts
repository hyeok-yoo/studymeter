/**
 * motion.ts — 앱 공용 모션 시스템 (Apple 'Designing Fluid Interfaces' 의 웹 번역).
 *
 * 규칙:
 *  - 모든 인터랙티브 모션은 스프링. 스프링은 현재 값에서 시작하므로 중간에
 *    끊고 되돌려도 (interruptible) 자연스럽다.
 *  - 기본은 임계감쇠(bounce 0). 바운스는 사용자의 제스처가 운동량을 실어준
 *    경우(플릭/드래그 릴리즈)에만 살짝(≤0.2).
 *  - transform/opacity 만 애니메이션한다.
 */
import type { Transition, Variants } from 'framer-motion';

// ── 공용 스프링 (Apple damping/response 값의 framer-motion 매핑) ────────────
export const spring = {
    /** 기본 UI 전환 — 임계감쇠, response 0.4 */
    default: { type: 'spring', bounce: 0, duration: 0.4 } as Transition,
    /** 눌림/작은 요소 — 더 빠르게 */
    snappy: { type: 'spring', bounce: 0, duration: 0.3 } as Transition,
    /** 드래그 릴리즈 등 운동량이 실린 전환 — 살짝 바운스 */
    momentum: { type: 'spring', bounce: 0.2, duration: 0.4 } as Transition,
    /** 시트/드로어 — Apple 값(damping 0.8, response 0.3) 근사 */
    sheet: { type: 'spring', bounce: 0.15, duration: 0.35 } as Transition,
};

/** 버튼/카드 공용 눌림 피드백 — pointer-down 즉시 반응 */
export const press = {
    whileTap: { scale: 0.97 },
    transition: spring.snappy,
};

export const pressStrong = {
    whileTap: { scale: 0.95 },
    transition: spring.snappy,
};

// ── 등장/퇴장 variants ──────────────────────────────────────────────────────

/** 아래에서 살짝 떠오르며 등장 (퇴장은 같은 경로로 — 공간적 일관성) */
export const fadeRise: Variants = {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: spring.default },
    exit: { opacity: 0, y: 14, transition: { duration: 0.18 } },
};

/** 머티리얼 등장 — 블러+스케일을 함께 (유리가 "도착"하는 느낌) */
export const materialize: Variants = {
    initial: { opacity: 0, scale: 0.96, filter: 'blur(8px)' },
    animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: spring.default },
    exit: { opacity: 0, scale: 0.96, filter: 'blur(8px)', transition: { duration: 0.18 } },
};

/** 리스트 컨테이너 stagger */
export const staggerContainer: Variants = {
    animate: { transition: { staggerChildren: 0.05 } },
};

export const staggerItem: Variants = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0, transition: spring.default },
};

// ── 제스처 물리 ─────────────────────────────────────────────────────────────

/**
 * 운동량 투영 — 릴리즈 속도(px/s)로 최종 정지 지점을 예측한다.
 * (스크롤 감속과 동일한 지수 감쇠 모델. Apple 샘플 코드의 project 함수.)
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
    return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * 러버밴딩 — 경계 밖으로 끌수록 점점 덜 따라온다 (하드 스톱 금지).
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// ── 접근성 ─────────────────────────────────────────────────────────────────

export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
