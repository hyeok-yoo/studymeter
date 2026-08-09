/**
 * ChangelogModal.tsx — "새로워진 점" 모달.
 *
 * 두 가지로 쓰인다.
 *  - `<ChangelogModal />` (App 루트): 업데이트 후 최초 실행 시 자동으로 1회 뜬다.
 *    닫으면 현재 버전을 "봤음"으로 기록해 다음 업데이트 전까지 다시 뜨지 않는다.
 *  - `<ChangelogHistoryModal open onClose />` (설정 → 업데이트 내역): 아무 때나
 *    직접 열어 보는 전체 이력. "봤음" 기록을 건드리지 않는다.
 *
 * 어느 쪽이든 이력 **전체**를 최신순으로 싣고, 최신 버전만 펼친 채로 시작한다.
 * 예전 버전은 접혀 있어 버전이 쌓여도 목록이 길어지지 않고, 헤더를 누르면 펼쳐진다.
 * 아침 브리핑 팝업과 같은 시각 언어(liquid-modal, materialize)를 쓴다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Icon } from '@iconify/react'
import { pendingChangelog, markVersionSeen, CHANGELOG, APP_VERSION, type ChangelogEntry } from '../lib/changelog'
import Modal from './ui/Modal'
import Pressable from './ui/Pressable'
import { staggerContainer, staggerItem } from '../lib/motion'

interface PanelProps {
    entries: ChangelogEntry[]
    /** NEW 배지를 달 버전들. 직접 열어 본 경우엔 비어 있다. */
    newVersions: string[]
    /** 처음부터 펼쳐 둘 버전들. 나머지는 접힌 채 시작한다. */
    expandedVersions: string[]
    onClose: () => void
    title: string
    icon: string
    closeLabel: string
}

function ChangelogPanel({ entries, newVersions, expandedVersions, onClose, title, icon, closeLabel }: PanelProps) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(expandedVersions))
    const latest = entries[0]

    const toggle = (version: string) => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(version)) next.delete(version)
        else next.add(version)
        return next
    })

    return (
        <>
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-indigo-500/12 via-transparent to-purple-500/10" />
            <div className="relative p-6 sm:p-8 flex flex-col gap-5 max-h-[82vh]">
                <header className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 flex-shrink-0">
                        <Icon icon={icon} className="text-xl text-white" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-[var(--color-text)] leading-tight">
                            {title}
                        </h2>
                        <p className="text-[11px] font-bold text-[var(--color-text-secondary)] flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-400 text-display">v{latest.version}</span>
                            {latest.title && <span className="opacity-80 truncate">{latest.title}</span>}
                        </p>
                    </div>
                </header>

                <div className="overflow-y-auto no-scrollbar pr-1 flex flex-col gap-4">
                    {entries.map((entry) => {
                        const isOpen = expanded.has(entry.version)
                        return (
                            <div key={entry.version} className="flex flex-col gap-3">
                                <Pressable
                                    onClick={() => toggle(entry.version)}
                                    pressScale={0.99}
                                    className="flex items-center gap-2 w-full text-left"
                                    aria-expanded={isOpen}
                                    aria-label={`v${entry.version} 변경사항 ${isOpen ? '접기' : '펼치기'}`}
                                >
                                    <span className="text-xs font-black text-[var(--color-text)] text-display">v{entry.version}</span>
                                    {newVersions.includes(entry.version) && (
                                        <span className="px-1.5 py-0.5 rounded-md bg-indigo-500 text-white text-[9px] font-black tracking-wide">NEW</span>
                                    )}
                                    <span className="text-[10px] font-bold text-[var(--color-text-secondary)] opacity-60">{entry.date}</span>
                                    <div className="flex-1 h-px bg-[var(--color-border)]" />
                                    <Icon
                                        icon="mdi:chevron-down"
                                        className={`text-base text-[var(--color-text-secondary)] opacity-60 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                                    />
                                </Pressable>

                                {isOpen ? (
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
                                ) : (
                                    <p className="text-xs text-[var(--color-text-secondary)] opacity-70 pl-0.5 truncate">
                                        {entry.title ?? `변경사항 ${entry.items.length}건`}
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </div>

                <Pressable
                    onClick={onClose}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/25"
                >
                    {closeLabel}
                </Pressable>
            </div>
        </>
    )
}

/** 업데이트 직후 자동으로 1회 뜨는 팝업. App 루트에 마운트한다. */
export default function ChangelogModal() {
    const [entries, setEntries] = useState<ChangelogEntry[]>([])
    const [newVersions, setNewVersions] = useState<string[]>([])
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
            if (pending.show && pending.entries.length > 0) {
                setEntries(pending.entries)
                setNewVersions(pending.newVersions)
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

    return (
        <Modal
            open={open}
            onClose={close}
            width="max-w-md"
            zIndex={9200}
            padding="p-4 sm:p-6"
            scrim="bg-black/60 backdrop-blur-lg"
            className="overflow-hidden"
            ariaLabel="새로워진 점"
        >
            <ChangelogPanel
                entries={entries}
                newVersions={newVersions}
                // 이번에 새로 추가된 버전만 펼쳐 두고, 예전 버전은 접어 둔다.
                expandedVersions={newVersions.length > 0 ? newVersions : [entries[0].version]}
                onClose={close}
                title="새로워진 점"
                icon="mdi:party-popper"
                closeLabel="좋아요, 계속하기"
            />
        </Modal>
    )
}

/** 설정에서 아무 때나 열어 보는 전체 업데이트 내역. "봤음" 기록은 건드리지 않는다. */
export function ChangelogHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const expandedVersions = useMemo(() => (CHANGELOG[0] ? [CHANGELOG[0].version] : []), [])

    if (CHANGELOG.length === 0) return null

    return (
        <Modal
            open={open}
            onClose={onClose}
            width="max-w-md"
            zIndex={9200}
            padding="p-4 sm:p-6"
            scrim="bg-black/60 backdrop-blur-lg"
            className="overflow-hidden"
            ariaLabel="업데이트 내역"
        >
            <ChangelogPanel
                entries={CHANGELOG}
                newVersions={[]}
                expandedVersions={expandedVersions}
                onClose={onClose}
                title="업데이트 내역"
                icon="mdi:history"
                closeLabel="닫기"
            />
        </Modal>
    )
}
