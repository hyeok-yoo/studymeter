/**
 * ThoughtParkingDrawer — 공부 중 떠오른 딴생각을 버려두는 서랍.
 *
 * 메모 앱으로 넘어가면 집중이 끊기므로, 여기에 던져두고 바로 복귀하게 한다.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ago } from '../lib/format';
import type { ThoughtNote } from '../lib/db';

interface ThoughtParkingDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    parkedNotes: ThoughtNote[];
    onPark: (content: string) => Promise<void>;
}

export default function ThoughtParkingDrawer({ isOpen, onClose, parkedNotes, onPark }: ThoughtParkingDrawerProps) {
    const [input, setInput] = useState('');
    const [justParked, setJustParked] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // 서랍이 올라오는 동안(스프링 ~300ms) 포커스를 주면 키보드와 애니메이션이 싸운다.
    useEffect(() => {
        if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
    }, [isOpen]);

    const park = async () => {
        const text = input.trim();
        if (!text) return;
        setJustParked(text);
        setInput('');
        await onPark(text);
        setTimeout(() => setJustParked(null), 2000);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-end">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                        className="relative w-full bg-[#19191b] text-white border border-b-0 border-white/10 rounded-t-[20px] p-6 pb-10 max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-9 h-1 bg-white/20 rounded-full mx-auto mb-5" />

                        <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center">
                                    <span className="text-[16px] font-medium text-white/85">P</span>
                                </div>
                                <div>
                                    <h3 className="text-[16px] font-medium text-white">생각 주차장</h3>
                                    <p className="text-[11px] text-white/40">지금 공부와 관계없는 생각을 여기 버려두고 집중으로 돌아가세요</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/40 hover:bg-white/20 transition-[color,background-color,border-color,opacity,transform]">
                                ×
                            </button>
                        </div>

                        {parkedNotes.length > 0 && (
                            <div className="mt-4 space-y-2 max-h-44 overflow-y-auto no-scrollbar">
                                <p className="text-[13px] font-medium text-white/30 mb-2">이번 세션에 주차됨</p>
                                <AnimatePresence>
                                    {[...parkedNotes].reverse().map((note, i) => (
                                        <motion.div
                                            key={note.id ?? i}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08]"
                                        >
                                            <span className="text-white/40 text-[12px] mt-0.5 flex-shrink-0">P</span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[14px] text-white/85 leading-relaxed">{note.content}</p>
                                                <p className="text-[11px] text-white/25 mt-0.5">{ago(note.createdAt)}</p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}

                        <AnimatePresence>
                            {justParked && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="mt-3 px-4 py-2.5 rounded-lg border border-white/10 text-center"
                                >
                                    <p className="text-[13px] font-medium text-[#4cc38a]">주차 완료. 이 생각은 안전해요.</p>
                                    <p className="text-[11px] text-white/30 mt-0.5">"{justParked.slice(0, 30)}{justParked.length > 30 ? '...' : ''}"</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="mt-4 flex flex-col gap-3">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        park();
                                    }
                                    if (e.key === 'Escape') onClose();
                                }}
                                placeholder="지금 머릿속에 걸리는 생각... (Enter로 주차)"
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/20 resize-none outline-none focus:border-white/30 focus:bg-white/[0.08] transition-[color,background-color,border-color,opacity,transform] font-medium text-sm leading-relaxed"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={park}
                                    disabled={!input.trim()}
                                    className="flex-1 h-12 rounded-xl bg-[#ededed] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed text-[#141415] font-medium text-[15px] transition-[color,background-color,border-color,opacity,transform] active:scale-[0.97] flex items-center justify-center gap-2"
                                >
                                    <span className="font-medium">P</span> 주차하기
                                </button>
                                <button
                                    onClick={onClose}
                                    className="flex-1 h-12 rounded-xl bg-white/[0.06] hover:bg-white/10 text-white/60 font-medium text-[15px] transition-[color,background-color,border-color,opacity,transform] active:scale-[0.97]"
                                >
                                    집중으로 돌아가기 →
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
