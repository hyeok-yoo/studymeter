/** 계측 눈금(MeterScale) 공용 값 — 컴포넌트 파일과 분리해 둔다(react-refresh 규칙). */

const HOUR = 3_600_000

/** 구간 블루 단계(%) — 앞(큰 구간)일수록 진하게. 범례 목록도 같은 값을 쓴다. */
export const SEGMENT_TONE_PCT = [100, 72, 52, 38, 28, 20]

/** 값·목표로부터 눈금 길이를 정한다 — 목표가 있으면 목표, 넘기면 다음 정시까지(최소 4시간). */
export function meterSpan(value: number, goal?: number | null): number {
    const g = goal && goal > 0 ? goal : 0
    if (g && value <= g) return g
    return Math.max(4 * HOUR, Math.ceil((Math.max(g, value) + 1) / HOUR) * HOUR)
}
