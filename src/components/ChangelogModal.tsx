/**
 * ChangelogModal.tsx — 업데이트 후 최초 실행 시 뜨는 "새로워진 점" 모달.
 *
 * App 루트에 마운트된다. pendingChangelog() 로 보여줄 항목을 판단하고,
 * 있으면 1회 표시한 뒤 현재 버전을 "봤음"으로 기록한다 (다음 업데이트 전까지 재노출 없음).
 * 아침 브리핑 팝업과 같은 시각 언어(liquid-modal, materialize)를 쓴다.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { pendingChangelog, markVersionSeen, APP_VERSION, type ChangelogEntry } from '../lib/changelog'
import Pressable from './ui/Pressable'
import { materialize, staggerContainer, staggerItem } from '../lib/motion'

export default function ChangelogModal() {
    const [entries, setEntries] = useState<ChangelogEntry[]>([])
    const [open, setOpen] = useState(false)
    const location = useLocation()
    const decidedRef = useRef(false)

    useEffect(() => {
        // 공부(집중) 화면에서는 방해하지 않는다 — 화면을 벗어난 뒤 판단한다.
        if (decidedRef.current || location.pathname === '/study') return
        let cancelled = false
        ;(async () => {
            const pending = await pendingChangelog()
            if (cancelled) return
            decidedRef.current = true
            if (pending.length > 0) {
                setEntries(pending)
                setOpen(true)
            }
        })()
        return () => { cancelled = true }
    }, [location.pathname])

    const close = () => {
        markVersionSeen(APP_VERSION)
        setOpen(false)
    }

    if (!open || entries.length === 0) return null

    const latest = entries[0]

    return createPortal(
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-[9200] flex items-center justify-center p-4 sm:p-6">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/60 backdrop-blur-lg"
                        onClick={close}
                    />
                    <motion.div
                        variants={materialize}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="relative w-full max-w-md liquid-modal shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-indigo-500/12 via-transparent to-purple-500/10" />
                        <div className="relative p-6 sm:p-8 flex flex-col gap-5 max-h-[82vh]">
                            <header className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 flex-shrink-0">
                                    <Icon icon="mdi:party-popper" className="text-xl text-white" />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-lg font-black text-[var(--color-text)] leading-tight">
                                        새로워진 점
                                    </h2>
                                    <p className="text-[11px] font-bold text-[var(--color-text-secondary)] flex items-center gap-1.5">
                                        <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-400 text-display">v{latest.version}</span>
                                        {latest.title && <span className="opacity-80 truncate">{latest.title}</span>}
                                    </p>
                                </div>
                            </header>

                            <div className="overflow-y-auto no-scrollbar pr-1 flex flex-col gap-6">
                                {entries.map((entry) => (
                                    <div key={entry.version} className="flex flex-col gap-3">
                                        {entries.length > 1 && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-black text-[var(--color-text)] text-display">v{entry.version}</span>
                                                <span className="text-[10px] font-bold text-[var(--color-text-secondary)] opacity-60">{entry.date}</span>
                                                <div className="flex-1 h-px bg-[var(--color-border)]" />
                                            </div>
                                        )}
                                        <motion.ul
                                            variants={staggerContainer}
                                            initial="initial"
                                            animate="animate"
                                            className="flex flex-col gap-2.5"
                                        >
                                            {entry.items.map((item, i) => (
                                                <motion.li
                                                    key={i}
                                                    variants={staggerItem}
                                                    className="flex items-start gap-3"
                                                >
                                                    <span className="w-7 h-7 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center flex-shrink-0 mt-0.5">
                                                        <Icon icon={item.icon ?? 'mdi:circle-medium'} className="text-base text-indigo-400" />
                                                    </span>
                                                    <p className="text-sm text-[var(--color-text)]/90 leading-relaxed">{item.text}</p>
                                                </motion.li>
                                            ))}
                                        </motion.ul>
                                    </div>
                                ))}
                            </div>

                            <Pressable
                                onClick={close}
                                className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/25"
                            >
                                좋아요, 계속하기
                            </Pressable>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
    )
}
