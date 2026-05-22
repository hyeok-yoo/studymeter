import React, { createContext, useContext, useState, useCallback } from 'react';
import { LiquidModal } from '../components/LiquidModal';

type ModalType = 'alert' | 'confirm' | 'prompt';

interface ModalOptions {
    title: string;
    message: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
}

interface ModalState extends ModalOptions {
    isOpen: boolean;
    type: ModalType;
    resolve: (value: any) => void;
}

interface ModalContextType {
    showAlert: (title: string, message: string) => Promise<void>;
    showConfirm: (title: string, message: string, options?: Partial<ModalOptions>) => Promise<boolean>;
    showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
    const context = useContext(ModalContext);
    if (!context) {
        throw new Error('useModal must be used within a ModalProvider');
    }
    return context;
};

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<ModalState | null>(null);

    const showAlert = useCallback((title: string, message: string) => {
        return new Promise<void>((resolve) => {
            setState({
                isOpen: true,
                type: 'alert',
                title,
                message,
                resolve: () => {
                    setState(null);
                    resolve();
                }
            });
        });
    }, []);

    const showConfirm = useCallback((title: string, message: string, options?: Partial<ModalOptions>) => {
        return new Promise<boolean>((resolve) => {
            setState({
                isOpen: true,
                type: 'confirm',
                title,
                message,
                confirmText: options?.confirmText || '확인',
                cancelText: options?.cancelText || '취소',
                resolve: (val: boolean) => {
                    setState(null);
                    resolve(val);
                }
            });
        });
    }, []);

    const showPrompt = useCallback((title: string, message: string, defaultValue = '') => {
        return new Promise<string | null>((resolve) => {
            setState({
                isOpen: true,
                type: 'prompt',
                title,
                message,
                defaultValue,
                resolve: (val: string | null) => {
                    setState(null);
                    resolve(val);
                }
            });
        });
    }, []);

    return (
        <ModalContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
            {children}
            {state && <LiquidModalRenderer state={state} />}
        </ModalContext.Provider>
    );
};

// Internal renderer component to avoid circular dependencies or cluttering the provider
const LiquidModalRenderer: React.FC<{ state: ModalState }> = ({ state }) => {
    return (
        <LiquidModal
            isOpen={state.isOpen}
            type={state.type}
            title={state.title}
            message={state.message}
            defaultValue={state.defaultValue}
            confirmText={state.confirmText}
            cancelText={state.cancelText}
            onConfirm={(val: any) => state.resolve(val)}
            onCancel={() => state.resolve(state.type === 'confirm' ? false : null)}
        />
    );
};
