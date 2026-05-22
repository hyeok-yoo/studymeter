import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LiquidModalProps {
    isOpen: boolean;
    type: 'alert' | 'confirm' | 'prompt';
    title: string;
    message: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: (value?: any) => void;
    onCancel: () => void;
}

export const LiquidModal: React.FC<LiquidModalProps> = ({
    isOpen,
    type,
    title,
    message,
    defaultValue = '',
    confirmText = '확인',
    cancelText = '취소',
    onConfirm,
    onCancel
}) => {
    const [inputValue, setInputValue] = useState(defaultValue);

    useEffect(() => {
        if (isOpen) {
            setInputValue(defaultValue);
        }
    }, [isOpen, defaultValue]);

    const handleConfirm = () => {
        if (type === 'prompt') {
            onConfirm(inputValue);
        } else if (type === 'confirm') {
            onConfirm(true);
        } else {
            onConfirm();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={type === 'alert' ? handleConfirm : onCancel}
                        className="absolute inset-0 bg-black/40 backdrop-blur-xl"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        transition={{
                            type: 'spring',
                            damping: 25,
                            stiffness: 300
                        }}
                        className="relative w-full max-w-sm liquid-modal shadow-2xl flex flex-col gap-6"
                        style={{ padding: '2.5rem' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Decorative Background Element */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-[var(--color-primary)] opacity-10 blur-[60px] rounded-full pointer-events-none" />

                        <header className="space-y-2 relative z-10">
                            <h3 className="text-2xl font-black gradient-text tracking-tight">
                                {title}
                            </h3>
                            <p className="text-[var(--color-text-secondary)] font-medium text-sm leading-relaxed whitespace-pre-wrap">
                                {message}
                            </p>
                        </header>

                        {type === 'prompt' && (
                            <div className="relative z-10">
                                <input
                                    autoFocus
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                                    className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] font-semibold transition-all"
                                    placeholder="입력하세요..."
                                />
                            </div>
                        )}

                        <footer className="flex gap-3 relative z-10">
                            {(type === 'confirm' || type === 'prompt') && (
                                <button
                                    onClick={onCancel}
                                    className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] font-bold transition-all active:scale-95"
                                >
                                    {cancelText}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                className={`flex-1 py-4 rounded-2xl font-black text-white shadow-xl active:scale-95 transition-all
                                    ${type === 'alert'
                                        ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)]'
                                        : 'bg-indigo-500 hover:bg-indigo-400'
                                    }`}
                            >
                                {confirmText}
                            </button>
                        </footer>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
