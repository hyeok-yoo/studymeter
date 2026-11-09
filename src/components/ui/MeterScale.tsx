/**
 * MeterScale — StudyMeter 의 시그니처: 시간을 재는 계측 눈금.
 *
 * 30분마다 짧은 눈금, 정시마다 긴 눈금, 현재 값에 앰버 바늘 하나.
 * 시간이 재어지는 숫자 바로 아래에만 쓴다 (홈 오늘 시간 · 공부 화면 목표).
 *
 * segments 를 주면 트랙을 구간으로 나눠 무채색 단계로 칠한다(과목별 누적).
 */
import { motion } from 'framer-motion'
import { spring } from '../../lib/motion'
import { SEGMENT_TONE_PCT } from '../../lib/meter'

const HOUR = 3_600_000
const HALF = 1_800_000

export interface MeterSegment {
    key: string
    ms: number
}

const SEGMENT_TONES = SEGMENT_TONE_PCT.map((p) => p / 100)

export default function MeterScale({
    value,
    span,
    goal,
    segments,
    reached = false,
    tone = 'auto',
    className = '',
}: {
    /** 현재 값 (ms) — 바늘 위치 */
    value: number
    /** 눈금 전체 길이 (ms) */
    span: number
    /** 목표 위치 (ms). span 과 다를 때 긴 눈금으로 표시 */
    goal?: number
    segments?: MeterSegment[]
    /** 목표 달성 — 채움을 의미 색(초록)으로 */
    reached?: boolean
    /** 'dark' 는 항상 검은 배경(공부 화면)용 */
    tone?: 'auto' | 'dark'
    className?: string
}) {
    const safeSpan = Math.max(span, HOUR)
    const pct = (ms: number) => Math.max(0, Math.min(100, (ms / safeSpan) * 100))

    // 눈금이 너무 촘촘해지면 30분 눈금을 생략한다.
    const minor = safeSpan / HALF <= 32 ? HALF : HOUR
    const ticks: { at: number; major: boolean }[] = []
    for (let t = 0; t <= safeSpan + 1; t += minor) ticks.push({ at: t, major: t % HOUR === 0 })

    // 시간 라벨 간격: 8시간 넘으면 2시간마다, 16시간 넘으면 4시간마다
    const hours = Math.floor(safeSpan / HOUR)
    const labelEvery = hours > 16 ? 4 : hours > 8 ? 2 : 1

    const ink = tone === 'dark' ? '237,237,237' : null
    // 채움은 블루 단계 — 큰 구간일수록 진하게
    const fillColor = (o: number) => (ink ? `rgba(91,148,255,${o})` : `color-mix(in srgb, var(--lamp) ${Math.round(o * 100)}%, transparent)`)
    const tickColor = ink ? `rgba(${ink},0.22)` : 'var(--tick)'
    const tickMajorColor = ink ? `rgba(${ink},0.45)` : 'var(--tick-major)'
    const labelColor = ink ? 'rgba(237,237,237,0.45)' : 'var(--color-text-muted)'

    let cursor = 0
    const parts = segments && segments.length
        ? segments.filter((s) => s.ms > 0).map((s, i) => {
            const left = cursor
            cursor += s.ms
            return { key: s.key, left: pct(left), width: pct(s.ms), color: fillColor(SEGMENT_TONES[Math.min(i, SEGMENT_TONES.length - 1)]) }
        })
        : [{ key: 'fill', left: 0, width: pct(value), color: reached ? 'var(--positive, #1fa971)' : fillColor(1) }]

    return (
        <div className={`w-full ${className}`} aria-hidden>
            <div
                className="relative h-2.5 rounded-full overflow-visible"
                style={{ background: ink ? 'rgba(91,148,255,0.14)' : 'var(--track)' }}
            >
                <div className="absolute inset-0 overflow-hidden rounded-full">
                    {parts.map((p) => (
                        <motion.div
                            key={p.key}
                            className="absolute top-0 bottom-0"
                            style={{ left: `${p.left}%`, width: `${p.width}%`, background: p.color, transformOrigin: 'left' }}
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={spring.default}
                        />
                    ))}
                </div>
                <motion.div
                    className="meter-needle"
                    style={{ boxShadow: `0 0 0 2px ${ink ? '#000' : 'var(--surface)'}` }}
                    initial={false}
                    animate={{ left: `${pct(value)}%` }}
                    transition={spring.default}
                />
            </div>

            {/* 눈금 */}
            <div className="relative h-3 mt-1">
                {ticks.map((t) => (
                    <span
                        key={t.at}
                        className="absolute top-0 w-px"
                        style={{
                            left: `${pct(t.at)}%`,
                            height: t.major ? 8 : 4,
                            background: t.major ? tickMajorColor : tickColor,
                        }}
                    />
                ))}
                {goal != null && goal > 0 && goal < safeSpan && (
                    <span
                        className="absolute top-0 w-[2px] -ml-px h-3"
                        style={{ left: `${pct(goal)}%`, background: 'var(--lamp)' }}
                    />
                )}
            </div>

            {/* 시간 라벨 */}
            <div className="relative h-4 font-mono text-[11px] leading-4 tabular-nums" style={{ color: labelColor }}>
                {ticks
                    .filter((t) => t.major && (t.at / HOUR) % labelEvery === 0)
                    .map((t, i, arr) => {
                        const first = i === 0
                        const last = i === arr.length - 1 && pct(t.at) > 96
                        return (
                            <span
                                key={t.at}
                                className="absolute top-0"
                                style={{
                                    left: `${pct(t.at)}%`,
                                    transform: first ? 'none' : last ? 'translateX(-100%)' : 'translateX(-50%)',
                                }}
                            >
                                {t.at / HOUR}h
                            </span>
                        )
                    })}
            </div>
        </div>
    )
}
