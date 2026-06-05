import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'

export interface HelpItem {
    title?: string
    description: string
}

interface HelpButtonProps {
    /** 도움말 제목 */
    title: string
    /** 도움말 내용: 문자열 또는 항목 배열 */
    items: HelpItem[] | string
    /** 추가 className */
    className?: string
    /** 어두운 배경용 (Study 페이지 등) */
    dark?: boolean
}

export function HelpButton({ title, items, className = '', dark = false }: HelpButtonProps) {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    setOpen(true)
                }}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black transition-all flex-shrink-0
                    ${dark
                        ? 'bg-white/10 hover:bg-white/25 text-white/50 hover:text-white/80'
                        : 'bg-[var(--color-primary)]/15 hover:bg-[var(--color-primary)]/30 text-[var(--color-primary)]'
                    } ${className}`}
                aria-label="도움말"
            >
                ?
            </button>

            <AnimatePresence>
                {open && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
                        {/* 배경 오버레이 */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setOpen(false)}
                            className="absolute inset-0 bg-black/40 backdrop-blur-xl"
                        />

                        {/* 모달 */}
                        <motion.div
                            initial={{ scale: 0.92, opacity: 0, y: 16 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.92, opacity: 0, y: 16 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="relative w-full max-w-sm liquid-modal shadow-2xl"
                            style={{ padding: '2rem' }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="absolute -top-20 -right-20 w-40 h-40 bg-[var(--color-primary)] opacity-10 blur-[60px] rounded-full pointer-events-none" />

                            <div className="flex items-center gap-3 mb-4 relative z-10">
                                <div className="w-9 h-9 rounded-xl bg-[var(--color-primary)]/15 flex items-center justify-center flex-shrink-0">
                                    <Icon
                                        icon="mdi:help-circle-outline"
                                        className="text-[var(--color-primary)] text-xl"
                                    />
                                </div>
                                <h3 className="text-xl font-black gradient-text leading-tight">{title}</h3>
                            </div>

                            <div className="relative z-10 space-y-3">
                                {typeof items === 'string' ? (
                                    <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                                        {items}
                                    </p>
                                ) : (
                                    items.map((item, i) => (
                                        <div key={i}>
                                            {item.title && (
                                                <p className="text-xs font-black uppercase tracking-wider text-[var(--color-primary)] mb-1">
                                                    {item.title}
                                                </p>
                                            )}
                                            <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
                                                {item.description}
                                            </p>
                                        </div>
                                    ))
                                )}
                            </div>

                            <button
                                onClick={() => setOpen(false)}
                                className="mt-6 w-full py-3 rounded-2xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-black text-sm relative z-10 active:scale-95 transition-all"
                            >
                                확인
                            </button>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    )
}
