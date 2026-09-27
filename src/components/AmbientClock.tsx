/**
 * AmbientClock — 공부 화면의 화면 보호(번인 방지) 모드.
 *
 * 한동안 손대지 않으면 과목 선택기·통계·버튼을 전부 치우고 새까만 화면에 시계만 남긴다
 * (유튜브가 재생바를 숨기는 것과 같은 발상). OLED 는 검정 픽셀이 꺼져 있으므로 켜진
 * 픽셀 수 자체가 적어지고, 남은 숫자도 번인이 쌓이지 않게 세 가지를 더 한다:
 *
 *  · 가는 글꼴 + 낮은 밝기 — 켜지는 픽셀 수와 발광 세기를 함께 줄인다.
 *  · 픽셀 시프트 — 1분마다 수 px 씩 천천히 옮긴다. 삼성 AOD 와 같은 방식이라
 *    눈에는 거의 안 띄지만, 같은 픽셀에 같은 획이 몇 시간씩 머무르지 않는다.
 *  · 소수점(0.1초) 자리 제거 — 초당 10번 깜빡이는 자리가 사라져 시선도 편하다.
 *
 * 아무 곳이나 한 번 누르면 원래 화면으로 돌아온다(그 터치는 아래 버튼으로 새지 않는다).
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

interface AmbientClockProps {
    active: boolean
    /** 큰 숫자 (H:MM:SS) */
    time: string
    /** 작은 보조 줄 — 과목 · 유형 */
    label: string
    running: boolean
    countdown: boolean
    onWake: () => void
}

/** 시프트 반경(px). 획 두께보다 넉넉히 커야 같은 픽셀을 비켜 간다. */
const SHIFT_PX = 14
const SHIFT_EVERY_MS = 60_000

function randomOffset() {
    const r = () => Math.round((Math.random() * 2 - 1) * SHIFT_PX)
    return { x: r(), y: r() }
}

export default function AmbientClock({ active, time, label, running, countdown, onWake }: AmbientClockProps) {
    const [offset, setOffset] = useState(randomOffset)

    useEffect(() => {
        if (!active) return
        const id = window.setInterval(() => setOffset(randomOffset()), SHIFT_EVERY_MS)
        return () => clearInterval(id)
    }, [active])

    return (
        <AnimatePresence>
            {active && (
                <motion.div
                    key="ambient"
                    className="fixed inset-0 z-[900] bg-black flex items-center justify-center select-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onWake()
                    }}
                    role="button"
                    aria-label="화면 보호 해제"
                >
                    <div
                        className="flex flex-col items-center gap-3"
                        style={{
                            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                            // 한 번에 뛰지 않고 수 초에 걸쳐 흘러가게 — 옮겨지는 게 눈에 띄지 않는다.
                            transition: 'transform 4s ease-in-out',
                        }}
                    >
                        <span
                            className="tabular-nums text-display"
                            style={{
                                fontSize: 'clamp(4rem, 17vw, 13rem)',
                                fontWeight: 200,
                                letterSpacing: '-0.02em',
                                color: countdown ? 'rgba(248, 113, 113, 0.62)' : 'rgba(255, 255, 255, 0.62)',
                            }}
                        >
                            {time}
                        </span>
                        <span
                            className="text-sm font-medium tracking-[0.3em] uppercase"
                            style={{ color: 'rgba(255, 255, 255, 0.22)' }}
                        >
                            {running ? label : `일시정지 · ${label}`}
                        </span>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
