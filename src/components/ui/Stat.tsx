/**
 * Stat — 라벨 위, 값 아래인 지표 카드.
 *
 * Study 의 `MetricCard` 와 `AdvancedMetricCard` 는 배율(scale) 하나만 다른
 * 사본이었고, 공부 화면의 4개 요약 카드도 같은 골격을 손으로 반복하고 있었다.
 */

/** 유효하지 않은 수치(undefined·null·NaN·Infinity)는 값 대신 placeholder 를 낸다. */
export function Metric({ label, value, unit = '', decimals = 0, scale = 1, color, help, placeholder = '--' }: {
    label: React.ReactNode;
    value: number | undefined | null;
    unit?: string;
    decimals?: number;
    /** 표시 전에 곱할 배율 — 비율을 %로 보일 때 100 */
    scale?: number;
    color: string;
    help?: React.ReactNode;
    placeholder?: string;
}) {
    const valid = value != null && Number.isFinite(value);
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-center">
            <span className="flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-widest opacity-40 mb-1">
                {label}
                {help}
            </span>
            <span
                className="text-base font-bold tabular-nums"
                style={{ color: valid ? color : 'rgba(255,255,255,0.2)' }}
            >
                {valid ? `${(value * scale).toFixed(decimals)}${unit}` : placeholder}
            </span>
        </div>
    );
}

/** 공부 화면 상단의 큰 요약 카드 (이미 포맷된 문자열을 받는다). */
export function Stat({ label, value, color, help }: {
    label: React.ReactNode;
    value: React.ReactNode;
    /** 값 색 클래스. 생략하면 본문색 */
    color?: string;
    help?: React.ReactNode;
}) {
    return (
        <div className="sm-metric-card bg-white/[0.06] border border-white/10 rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{label}</span>
                {help}
            </div>
            <span className={`sm-metric-value text-2xl md:text-3xl font-bold tabular-nums ${color ?? ''}`}>
                {value}
            </span>
        </div>
    );
}
