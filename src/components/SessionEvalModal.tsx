import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { SessionEvaluation, ThoughtNote } from '../lib/db'
import { markThoughtsReviewed } from '../lib/db'

interface SessionEvalModalProps {
    isOpen: boolean
    onClose: () => void
    onSave: (evaluation: SessionEvaluation) => void
    sessionDuration: number
    subject: string
    subItem?: string
    parkedNotes?: ThoughtNote[]
}

export default function SessionEvalModal({
    isOpen,
    onClose,
    onSave,
    sessionDuration,
    subject,
    subItem,
    parkedNotes = []
}: SessionEvalModalProps) {
    const [focus, setFocus] = useState(5)
    const [satisfaction, setSatisfaction] = useState(5)
    const [showProblemSolving, setShowProblemSolving] = useState(false)
    const [correct, setCorrect] = useState('')
    const [total, setTotal] = useState('')
    const [memo, setMemo] = useState('')

    const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / 3600000)
        const minutes = Math.floor((ms % 3600000) / 60000)
        if (hours > 0) return `${hours}시간 ${minutes}분`
        return `${minutes}분`
    }

    const handleSave = async () => {
        if (parkedNotes.length > 0) {
            const ids = parkedNotes.map(n => n.id!).filter(Boolean)
            await markThoughtsReviewed(ids)
        }
        const evaluation: SessionEvaluation = {
            focus,
            satisfaction,
            ...(showProblemSolving && correct && total ? {
                problemSolving: {
                    correct: parseInt(correct) || 0,
                    total: parseInt(total) || 0
                }
            } : {}),
            ...(memo.trim() ? { memo: memo.trim() } : {})
        }
        onSave(evaluation)
    }

    const renderRatingButtons = (
        value: number,
        onChange: (val: number) => void,
        label: string,
        activeColor: string,
        emoji: React.ReactNode
    ) => (
        <div className="space-y-3">
            <div className="flex justify-between items-end">
                <div className="flex items-center gap-2">
                    <span className="text-xl flex items-center justify-center">{emoji}</span>
                    <span className="text-sm font-bold text-white/60 uppercase tracking-widest">{label}</span>
                </div>
                <span className={`text-2xl font-black ${activeColor} drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]`}>
                    {value}<span className="text-sm opacity-40 ml-1">/ 10</span>
                </span>
            </div>
            <div className="flex gap-1.5 h-12">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => onChange(n)}
                        className={`flex-1 rounded-xl text-xs font-black transition-all duration-300 relative overflow-hidden group ${n <= value
                            ? `${activeColor.replace('text-', 'bg-')} shadow-[0_0_15px_rgba(255,255,255,0.1)] scale-[1.05] z-10 text-white`
                            : 'bg-white/5 text-white/20 hover:bg-white/10'
                            }`}
                    >
                        {n}
                        {n <= value && (
                            <motion.div
                                layoutId={`active-glow-${label}`}
                                className="absolute inset-0 bg-white/20 mix-blend-overlay"
                            />
                        )}
                        <div className="absolute inset-0 opacity-0 group-active:opacity-100 bg-white/10 transition-opacity" />
                    </button>
                ))}
            </div>
        </div>
    )

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
                    {/* Backdrop with heavy blur - Sibling Pattern */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
                        onClick={onClose}
                    />

                    {/* Modal with Liquid Glass Design */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 30 }}
                        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        className="relative w-full max-w-lg liquid-modal shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Glass Overlay Effect */}
                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />

                        {/* Interior content with max-height for scrolling */}
                        <div className="relative p-8 space-y-8 max-h-[85vh] overflow-y-auto no-scrollbar">

                            {/* Header Section */}
                            <header className="text-center space-y-4 pt-2">
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ delay: 0.2, type: 'spring' }}
                                    className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-2xl shadow-indigo-500/20"
                                >
                                    <Icon icon="mdi:sparkles" className="text-4xl text-amber-300" />
                                </motion.div>
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-black tracking-tight text-white uppercase">세션 완료</h2>
                                    <div className="flex items-center justify-center gap-2 text-white/40 font-bold text-sm">
                                        <span className="text-indigo-400">{subject}</span>
                                        {subItem && <span>› {subItem}</span>}
                                        <span className="w-1 h-1 rounded-full bg-white/20" />
                                        <span>{formatDuration(sessionDuration)}</span>
                                    </div>
                                </div>
                            </header>

                            {/* Rating Sections */}
                            <div className="space-y-8 px-2">
                                {renderRatingButtons(focus, setFocus, '집중도', 'text-indigo-400', <Icon icon="mdi:fire" className="text-orange-400" />)}
                                {renderRatingButtons(satisfaction, setSatisfaction, '만족도', 'text-emerald-400', <Icon icon="mdi:diamond-stone" className="text-cyan-400" />)}
                            </div>

                            {/* Parked Thoughts Section */}
                            {parkedNotes.length > 0 && (
                                <div className="px-2 pt-2 border-t border-white/5">
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-lg font-black text-blue-400">🅿</span>
                                        <span className="text-xs font-black uppercase tracking-widest text-white/50">주차된 생각 {parkedNotes.length}개</span>
                                    </div>
                                    <div className="space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                                        {parkedNotes.map((note, i) => (
                                            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
                                                <span className="text-blue-400 text-xs mt-0.5 font-black flex-shrink-0">P</span>
                                                <p className="text-xs text-white/70 leading-relaxed">{note.content}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-white/25 mt-2 text-center">저장 시 검토 완료로 표시됩니다</p>
                                </div>
                            )}

                            {/* Additional Info Section */}
                            <div className="space-y-6 pt-2 border-t border-white/5">
                                {/* Problem Solving Toggle */}
                                <div className="space-y-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowProblemSolving(!showProblemSolving)}
                                        className="flex items-center justify-between w-full group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${showProblemSolving ? 'bg-amber-500 border-amber-500' : 'border-white/10 group-hover:border-white/20'
                                                }`}>
                                                {showProblemSolving && <span className="text-white text-xs font-black">✓</span>}
                                            </div>
                                            <span className="font-bold text-white/50 group-hover:text-white/80 transition-colors">문제 풀이 기록</span>
                                        </div>
                                        <span className="text-xs font-black text-amber-500/60 uppercase tracking-widest">{showProblemSolving ? '온' : '오프'}</span>
                                    </button>

                                    <AnimatePresence>
                                        {showProblemSolving && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="flex items-center gap-4 pl-9"
                                            >
                                                <div className="flex-1 flex items-center gap-3 bg-white/5 p-2 rounded-2xl border border-white/5 focus-within:border-amber-500/30 transition-all">
                                                    <input
                                                        type="number"
                                                        value={correct}
                                                        onChange={(e) => setCorrect(e.target.value)}
                                                        placeholder="맞힌 수"
                                                        className="w-full bg-transparent text-center font-black text-white placeholder:text-white/10 outline-none"
                                                    />
                                                    <span className="text-white/20 font-black">/</span>
                                                    <input
                                                        type="number"
                                                        value={total}
                                                        onChange={(e) => setTotal(e.target.value)}
                                                        placeholder="전체"
                                                        className="w-full bg-transparent text-center font-black text-white placeholder:text-white/10 outline-none"
                                                    />
                                                </div>
                                                <span className="font-bold text-white/30 whitespace-nowrap">문항</span>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Memo field with glass look */}
                                <div className="space-y-3">
                                    <label className="text-xs font-black text-white/30 uppercase tracking-widest pl-1">메모</label>
                                    <textarea
                                        value={memo}
                                        onChange={(e) => setMemo(e.target.value)}
                                        placeholder="오늘 공부는 어땠나요?"
                                        rows={3}
                                        className="w-full px-5 py-4 rounded-[2rem] bg-white/5 border border-white/5 text-white placeholder:text-white/10 resize-none outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all font-medium"
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <footer className="flex gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 py-5 rounded-[2rem] bg-white/5 hover:bg-white/10 text-white/40 font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                                >
                                    건너뛰기
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    className="flex-[1.5] py-5 rounded-[2rem] bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-black uppercase tracking-widest text-xs shadow-2xl shadow-indigo-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    평가 완료 <Icon icon="mdi:rocket-launch-outline" className="text-lg" />
                                </button>
                            </footer>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}
