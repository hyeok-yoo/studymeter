import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { NativeBridge } from '../lib/NativeBridge'

export interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// 모듈 레벨에서 한 번만 캡처 (React 마운트 전 이벤트도 놓치지 않음)
let _deferredPrompt: BeforeInstallPromptEvent | null = null
if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault()
        _deferredPrompt = e as BeforeInstallPromptEvent
    })
}

export function getCapturedPrompt() { return _deferredPrompt }
export function clearCapturedPrompt() { _deferredPrompt = null }

export function isStandaloneMode(): boolean {
    // `standalone` 은 iOS Safari 전용 비표준 속성 (표준 Navigator 타입에 없음)
    const nav = window.navigator as Navigator & { standalone?: boolean }
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        nav.standalone === true
    )
}

export function isIOSDevice(): boolean {
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
}

// ── 공유 상수 ─────────────────────────────────────────────────────────────────

const PWA_BENEFITS = [
    { icon: 'mdi:cellphone-arrow-down', title: '홈 화면 아이콘', desc: '브라우저 없이 바로 실행' },
    { icon: 'mdi:wifi-off', title: '오프라인 지원', desc: '인터넷 없이도 기록 조회' },
    { icon: 'mdi:lightning-bolt', title: '빠른 시작', desc: '웹보다 즉각 열림' },
    { icon: 'mdi:fullscreen', title: '앱 전용 화면', desc: '주소창 없는 깔끔한 UI' },
]

const IOS_STEPS = [
    {
        step: 1, icon: 'mdi:safari',
        title: 'Safari에서 열기',
        desc: 'Chrome·웨일 등 다른 브라우저는 설치를 지원하지 않아요. 반드시 Safari 앱을 사용하세요.',
    },
    {
        step: 2, icon: 'mdi:export-variant',
        title: '하단 공유 버튼 탭',
        desc: '화면 하단 중앙의 □↑ 공유(Share) 아이콘을 탭하세요.',
    },
    {
        step: 3, icon: 'mdi:plus-box-outline',
        title: '"홈 화면에 추가" 선택',
        desc: '목록을 스크롤하여 "홈 화면에 추가(Add to Home Screen)"를 탭하세요.',
    },
    {
        step: 4, icon: 'mdi:check-circle-outline',
        title: '"추가" 탭으로 완료',
        desc: '앱 이름을 확인하고 오른쪽 상단 "추가"를 탭하면 설치가 완료됩니다!',
    },
]

// ── iOS 설치 가이드 모달 (단독 내보내기) ─────────────────────────────────────

interface IOSInstallGuideProps {
    isOpen: boolean
    onClose: () => void
}

export function IOSInstallGuide({ isOpen, onClose }: IOSInstallGuideProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/50 backdrop-blur-xl"
                    />
                    <motion.div
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                        className="relative w-full max-w-sm liquid-modal rounded-b-none md:rounded-b-[2rem] p-6 pb-10 mx-4 md:mx-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mb-5 md:hidden" />

                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                                <Icon icon="mdi:apple" className="text-white text-2xl" />
                            </div>
                            <div>
                                <h3 className="font-black gradient-text text-xl leading-tight">iPhone / iPad 설치</h3>
                                <p className="text-xs text-[var(--color-text-secondary)] opacity-60">
                                    Safari로 홈 화면에 앱처럼 추가하세요
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {IOS_STEPS.map(({ step, icon, title, desc }) => (
                                <div key={step} className="flex gap-3">
                                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                                        <span className="text-xs font-black text-indigo-400">{step}</span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <Icon icon={icon} className="text-[var(--color-text-secondary)] text-base flex-shrink-0" />
                                            <p className="text-sm font-bold text-[var(--color-text)]">{title}</p>
                                        </div>
                                        <p className="text-xs text-[var(--color-text-secondary)] opacity-70 leading-relaxed">{desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-5 p-3 rounded-2xl bg-indigo-500/10 border border-indigo-400/20">
                            <p className="text-xs text-indigo-300 text-center leading-relaxed">
                                설치 후 홈 화면의 StudyMeter 아이콘으로 앱처럼 바로 실행돼요!
                            </p>
                        </div>

                        <button
                            onClick={onClose}
                            className="mt-4 w-full py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-black text-sm active:scale-95 transition-all"
                        >
                            확인했어요
                        </button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}

// ── 최초 방문 배너 (기본 내보내기) ───────────────────────────────────────────

const PWA_DISMISS_KEY = 'pwa_prompt_dismissed_at'
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000

export default function PWAInstallPrompt() {
    const [visible, setVisible] = useState(false)
    const [showIOSGuide, setShowIOSGuide] = useState(false)
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [ios, setIos] = useState(false)

    useEffect(() => {
        if (isStandaloneMode() || NativeBridge.isNative()) return

        const dismissedAt = localStorage.getItem(PWA_DISMISS_KEY)
        if (dismissedAt && Date.now() - parseInt(dismissedAt) < DISMISS_DURATION) return

        const isIOS = isIOSDevice()
        setIos(isIOS)

        if (_deferredPrompt) {
            setDeferredPrompt(_deferredPrompt)
            setVisible(true)
        } else {
            const handler = (e: Event) => {
                e.preventDefault()
                _deferredPrompt = e as BeforeInstallPromptEvent
                setDeferredPrompt(e as BeforeInstallPromptEvent)
                setVisible(true)
            }
            window.addEventListener('beforeinstallprompt', handler)
            if (isIOS) setVisible(true)
            return () => window.removeEventListener('beforeinstallprompt', handler)
        }

        if (isIOS) setVisible(true)

        const onInstalled = () => { setVisible(false); setDeferredPrompt(null); _deferredPrompt = null }
        window.addEventListener('appinstalled', onInstalled)
        return () => window.removeEventListener('appinstalled', onInstalled)
    }, [])

    const handleInstall = async () => {
        if (ios) { setShowIOSGuide(true); return }
        if (!deferredPrompt) return
        await deferredPrompt.prompt()
        const { outcome } = await deferredPrompt.userChoice
        if (outcome === 'accepted') setVisible(false)
        _deferredPrompt = null
        setDeferredPrompt(null)
    }

    const handleDismiss = () => {
        localStorage.setItem(PWA_DISMISS_KEY, String(Date.now()))
        setVisible(false)
        setShowIOSGuide(false)
    }

    if (!visible) return null

    return (
        <>
            <AnimatePresence>
                {visible && !showIOSGuide && (
                    <motion.div
                        initial={{ opacity: 0, y: -16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -16 }}
                        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                        className="glass-card p-6 relative overflow-hidden border-none"
                        style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.13) 0%, rgba(168,85,247,0.09) 100%)' }}
                    >
                        <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/20 blur-[60px] rounded-full pointer-events-none" />

                        <button
                            onClick={handleDismiss}
                            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[var(--color-text-secondary)] transition-all leading-none"
                            aria-label="닫기"
                        >
                            ×
                        </button>

                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
                                    <Icon icon="mdi:cellphone-arrow-down" className="text-white text-2xl" />
                                </div>
                                <div>
                                    <h3 className="font-black text-[var(--color-text)] text-base leading-tight">앱으로 설치하면 더 편해요!</h3>
                                    <p className="text-xs text-[var(--color-text-secondary)] opacity-60 leading-tight mt-0.5">
                                        단순 북마크·주소 추가와는 다릅니다 — 진짜 앱처럼 작동해요
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-5">
                                {PWA_BENEFITS.map((b) => (
                                    <div key={b.title} className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/5">
                                        <Icon icon={b.icon} className="text-indigo-400 text-xl flex-shrink-0" />
                                        <div>
                                            <p className="text-xs font-bold text-[var(--color-text)] leading-tight">{b.title}</p>
                                            <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60 leading-tight mt-0.5">{b.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleInstall}
                                    className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-black text-sm shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                                >
                                    <Icon icon={ios ? 'mdi:export-variant' : 'mdi:download'} className="text-lg" />
                                    {ios ? '설치 방법 보기' : '앱으로 설치하기'}
                                </button>
                                <button
                                    onClick={handleDismiss}
                                    className="px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] font-bold text-sm transition-all active:scale-95 whitespace-nowrap"
                                >
                                    나중에
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <IOSInstallGuide isOpen={showIOSGuide} onClose={handleDismiss} />
        </>
    )
}
