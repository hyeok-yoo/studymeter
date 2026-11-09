/**
 * HomeSection.tsx — 홈 화면의 접이식 섹션 래퍼.
 *
 * 매일 확인할 필요는 없지만 항상 접근 가능해야 하는 기능(주간 회고, 학습 복기 등)을
 * 감싸서 기본적으로 접힌 상태로 보여준다. 열림/닫힘 상태는 localStorage 에 저장되어
 * 다음 방문 때도 유지된다.
 */
import { useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import Pressable from './ui/Pressable'
import { staggerItem, spring } from '../lib/motion'

interface HomeSectionProps {
    title: string
    /** mdi 아이콘 이름 */
    icon: string
    /** 열림 상태를 저장할 localStorage 키 */
    storageKey: string
    /** 저장된 값이 없을 때 기본 열림 여부 (기본값: false) */
    defaultOpen?: boolean
    children: ReactNode
}

function readInitialOpen(storageKey: string, defaultOpen: boolean): boolean {
    try {
        const stored = window.localStorage.getItem(storageKey)
        if (stored === null) return defaultOpen
        return stored === '1'
    } catch {
        return defaultOpen
    }
}

export default function HomeSection({
    title,
    icon,
    storageKey,
    defaultOpen = false,
    children,
}: HomeSectionProps) {
    const [open, setOpen] = useState(() => readInitialOpen(storageKey, defaultOpen))

    const toggle = () => {
        setOpen((prev) => {
            const next = !prev
            try {
                window.localStorage.setItem(storageKey, next ? '1' : '0')
            } catch {
                /* ignore (프라이빗 모드 등) */
            }
            return next
        })
    }

    return (
        <motion.section variants={staggerItem} className="glass-card px-5 md:px-6">
            <Pressable
                type="button"
                onClick={toggle}
                pressScale={0.99}
                aria-expanded={open}
                className="w-full h-14 flex items-center gap-2.5 text-left"
            >
                <Icon icon={icon} className="text-[18px] text-[var(--color-text-muted)] flex-shrink-0" />
                <h2 className="text-[16px] font-medium text-[var(--color-text)]">{title}</h2>
                <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={spring.snappy}
                    className="ml-auto flex-shrink-0"
                >
                    <Icon icon="mdi:chevron-down" className="text-[18px] text-[var(--color-text-muted)]" />
                </motion.span>
            </Pressable>

            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={spring.default}
                        className="overflow-hidden"
                    >
                        <div className="pt-5 pb-5 border-t border-[var(--color-border)]">
                            {children}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.section>
    )
}
