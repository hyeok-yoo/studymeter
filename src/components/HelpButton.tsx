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
                pressScale={0.96}
                onClick={(e) => {
                    e.stopPropagation()
                    setOpen(true)
                }}
                className={`w-6 h-6 -m-0.5 rounded-full inline-flex items-center justify-center flex-shrink-0 transition-colors duration-150
                    ${dark
                        ? 'text-white/35 hover:text-white/70'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    } ${className}`}
                aria-label="도움말"
            >
                <Icon icon="mdi:help-circle-outline" className="text-[16px]" />
            </Pressable>

            <Modal
                open={open}
                onClose={() => setOpen(false)}
                width="max-w-md"
                className="p-6 max-h-[90vh] overflow-y-auto no-scrollbar"
                ariaLabel={title}
            >
                <h3 className="text-xl font-semibold leading-tight text-[var(--color-text)] mb-4">{title}</h3>

                <div className="divide-y divide-[var(--color-border)]">
                    {typeof items === 'string' ? (
                        <p className="text-[var(--color-text-secondary)] text-[15px] leading-relaxed">
                            {items}
                        </p>
                    ) : (
                        items.map((item, i) => (
                            <div key={i} className="py-3 first:pt-0 last:pb-0">
                                {item.title && (
                                    <p className="text-[14px] font-medium text-[var(--color-text)] mb-1">
                                        {item.title}
                                    </p>
                                )}
                                <p className="text-[var(--color-text-secondary)] text-[14px] leading-relaxed">
                                    {item.description}
                                </p>
                            </div>
                        ))
                    )}
                </div>

                <Pressable
                    onClick={() => setOpen(false)}
                    className="btn btn-primary mt-6 w-full h-11 text-[15px]"
                >
                    확인
                </Pressable>
            </Modal>
        </>
    )
}
