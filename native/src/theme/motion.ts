/**
 * motion.ts — 앱 공용 모션 시스템 (React Native / Reanimated 포팅).
 *
 * 웹 src/lib/motion.ts 와 동일 철학(Apple 'Designing Fluid Interfaces' 의 번역):
 *  - 모든 인터랙티브 모션은 스프링. 스프링은 현재 값에서 시작하므로 중간에
 *    끊고 되돌려도(interruptible) 자연스럽다.
 *  - 기본은 임계감쇠(bounce 0). 바운스는 제스처가 운동량을 실어준 경우에만 살짝.
 *  - transform/opacity 만 애니메이션한다.
 *
 * 웹은 framer-motion 의 `{ bounce, duration }` 스프링을 쓴다. Reanimated 의
 * withSpring 은 duration + dampingRatio 표기를 지원하므로 같은 의도를 직역할 수 있다.
 * dampingRatio 1.0 = 임계감쇠(bounce 0). 값이 낮을수록 바운스가 커진다.
 * (framer 의 bounce b ≈ 1 - dampingRatio 로 근사해 매핑.)
 */
import type { WithSpringConfig } from 'react-native-reanimated';

export const spring = {
  /** 기본 UI 전환 — 임계감쇠, response 0.4 (웹 spring.default) */
  default: { duration: 400, dampingRatio: 1.0 } satisfies WithSpringConfig,
  /** 눌림/작은 요소 — 더 빠르게 (웹 spring.snappy) */
  snappy: { duration: 300, dampingRatio: 1.0 } satisfies WithSpringConfig,
  /** 드래그 릴리즈 등 운동량이 실린 전환 — 살짝 바운스 (웹 spring.momentum, bounce 0.2) */
  momentum: { duration: 400, dampingRatio: 0.8 } satisfies WithSpringConfig,
  /** 시트/드로어 — Apple 값 근사, 살짝 바운스 (웹 spring.sheet, bounce 0.15) */
  sheet: { duration: 350, dampingRatio: 0.85 } satisfies WithSpringConfig,
} as const;

/** 버튼/카드 공용 눌림 스케일 값 (웹 press / pressStrong 미러) */
export const pressScale = {
  soft: 0.97,
  strong: 0.95,
} as const;

/** 등장 오프셋 (웹 fadeRise: y 14 에서 떠오름) */
export const enter = {
  fadeRiseOffset: 14,
} as const;

// ── 제스처 물리 (웹과 동일한 순수 함수 — 플랫폼 무관) ──────────────────────────

/**
 * 운동량 투영 — 릴리즈 속도(px/s)로 최종 정지 지점을 예측한다.
 * (스크롤 감속과 동일한 지수 감쇠 모델. Apple 샘플 코드의 project 함수.)
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * 러버밴딩 — 경계 밖으로 끌수록 점점 덜 따라온다 (하드 스톱 금지).
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
