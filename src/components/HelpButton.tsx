import { useState } from 'react'
import { Icon } from '@iconify/react'
import Modal from './ui/Modal'
import Pressable from './ui/Pressable'

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
            <Pressable
                type="button"
                pressScale={0.9}
                onClick={(e) => {
                    e.stopPropagation()
                    setOpen(true)
                }}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0
                    ${dark
                        ? 'bg-white/10 hover:bg-white/25 text-white/50 hover:text-white/80'
                        : 'bg-[var(--color-primary)]/15 hover:bg-[var(--color-primary)]/30 text-[var(--color-primary)]'
                    } ${className}`}
                aria-label="도움말"
            >
                ?
            </Pressable>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                width="max-w-lg"
                scrim="bg-black/40 backdrop-blur-xl"
                className="p-10 max-h-[90vh] overflow-y-auto no-scrollbar"
                ariaLabel={title}
            >
                <div className="absolute -top-20 -right-20 w-40 h-40 bg-[var(--color-primary)] opacity-10 blur-[60px] rounded-full pointer-events-none" />

                <div className="flex items-center gap-3 mb-6 relative z-10">
                    <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/15 flex items-center justify-center flex-shrink-0">
                        <Icon
                            icon="mdi:help-circle-outline"
                            className="text-[var(--color-primary)] text-2xl"
                        />
                    </div>
                    <h3 className="text-2xl font-black gradient-text leading-tight">{title}</h3>
                </div>

                <div className="relative z-10 space-y-4">
                    {typeof items === 'string' ? (
                        <p className="text-[var(--color-text-secondary)] text-base leading-relaxed">
                            {items}
                        </p>
                    ) : (
                        items.map((item, i) => (
                            <div key={i} className="p-4 rounded-2xl bg-[var(--color-primary)]/5">
                                {item.title && (
                                    <p className="text-xs font-black uppercase tracking-wider text-[var(--color-primary)] mb-2">
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

                <Pressable
                    onClick={() => setOpen(false)}
                    className="mt-8 w-full py-4 rounded-2xl bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white font-black text-base relative z-10"
                >
                    확인
                </Pressable>
            </Modal>
        </>
    )
}
