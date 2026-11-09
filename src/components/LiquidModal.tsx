import React, { useState, useEffect } from 'react';
import Modal from './ui/Modal';

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
        // alert 은 취소가 없으므로 바깥 탭도 "확인"으로 친다 (기존 동작 유지).
        <Modal
            open={isOpen}
            onClose={type === 'alert' ? handleConfirm : onCancel}
            className="p-6 flex flex-col gap-5"
            ariaLabel={title}
        >
            <header className="space-y-2 relative z-10">
                <h3 className="text-[20px] font-medium leading-tight">
                    {title}
                </h3>
                <p className="text-[var(--color-text-secondary)] text-[15px] leading-relaxed whitespace-pre-wrap">
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
                        className="w-full h-12 px-4 rounded-xl text-[var(--color-text)] text-[15px]"
                        placeholder="입력"
                    />
                </div>
            )}

            <footer className="flex gap-3 relative z-10">
                {(type === 'confirm' || type === 'prompt') && (
                    <button
                        onClick={onCancel}
                        className="btn btn-glass flex-1 h-12 text-[15px] text-[var(--color-text-secondary)]"
                    >
                        {cancelText}
                    </button>
                )}
                <button
                    onClick={handleConfirm}
                    className="btn btn-primary flex-1 h-12 text-[15px]"
                >
                    {confirmText}
                </button>
            </footer>
        </Modal>
    );
};
