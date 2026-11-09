/**
 * SlidingSelector — 손가락을 끌어 값을 고르는 알약 선택기 (공부 화면 상단).
 *
 * `Segmented` 와 달리 포인터를 누른 채 항목 위를 지나가며 고를 수 있고, 실제
 * 변경은 손을 뗄 때 한 번만 일어난다. 과목을 바꾸면 세션이 저장·재시작되므로
 * 지나가는 항목마다 저장이 일어나면 안 되기 때문이다.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { spring } from '../../lib/motion';

interface SlidingSelectorProps {
    items: string[];
    currentValue: string;
    onChange: (val: string) => void;
    /** 선택 알약 배경 클래스 */
    activeColor: string;
    activeTextColor: string;
    /** 알약이 미끄러질 layoutId — 화면 안에서 유일해야 한다 */
    layoutId: string;
}

export default function SlidingSelector({
    items,
    currentValue,
    onChange,
    activeColor,
    activeTextColor,
    layoutId,
}: SlidingSelectorProps) {
    const [dragging, setDragging] = useState(false);
    const [pending, setPending] = useState<string | null>(null);

    const commit = () => {
        setDragging(false);
        if (pending && pending !== currentValue) onChange(pending);
        setPending(null);
    };

    const shown = pending ?? currentValue;

    return (
        <div
            onPointerDown={() => setDragging(true)}
            onPointerUp={commit}
            onPointerLeave={commit}
            onPointerMove={(e) => {
                if (!dragging) return;
                const value = document
                    .elementFromPoint(e.clientX, e.clientY)
                    ?.closest('button[data-value]')
                    ?.getAttribute('data-value');
                if (value && value !== currentValue) setPending(value);
            }}
            className="flex gap-0.5 p-1 rounded-full bg-white/[0.06] border border-white/[0.08] relative touch-none shrink-0"
        >
            {items.map((item) => (
                <button
                    key={item}
                    data-value={item}
                    onClick={() => onChange(item)}
                    className={`relative px-4 h-10 rounded-full text-[15px] font-medium whitespace-nowrap transition-colors duration-150 z-10 ${shown === item ? activeTextColor : 'text-white/45 hover:text-white/75'}`}
                >
                    {shown === item && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <motion.div
                                layoutId={layoutId}
                                className={`absolute inset-0 ${activeColor} rounded-full`}
                                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}
                                transition={spring.default}
                            />
                        </div>
                    )}
                    <span className="relative z-20">{item}</span>
                </button>
            ))}
        </div>
    );
}
