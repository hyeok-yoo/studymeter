import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Suspense } from 'react'
import { NativeBridge } from '../lib/NativeBridge'
import { Icon } from '@iconify/react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Settings } from '../lib/db'
import { spring } from '../lib/motion'
import BrandMark from './ui/BrandMark'

interface LayoutProps {
    settings: Settings
    onSettingsChange: (settings: Settings) => void
}

const NAV_ITEMS = [
    { path: '/', icon: 'mdi:home-outline', activeIcon: 'mdi:home', label: '홈' },
    { path: '/records', icon: 'mdi:chart-bar', activeIcon: 'mdi:chart-bar', label: '기록' },
    { path: '/edit-records', icon: 'mdi:pencil-outline', activeIcon: 'mdi:pencil', label: '편집' },
    { path: '/gemini', icon: 'mdi:message-text-outline', activeIcon: 'mdi:message-text', label: 'Gemini' },
    { path: '/settings', icon: 'mdi:cog-outline', activeIcon: 'mdi:cog', label: '설정' },
]

export default function Layout({ settings }: LayoutProps) {
    const [founder, setFounder] = useState(false)
    const location = useLocation()
    useEffect(() => {
        import('../lib/telemetry').then(({ isOwner }) => setFounder(isOwner()))
    }, [])

    const isActive = (path: string) =>
        path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

    return (
        <div className="min-h-screen flex flex-col md:flex-row relative">
            {/* Tablet/Desktop Sidebar — 화면에 붙은 크롬. 태블릿에서도 손가락 크기(48px 행) */}
            <aside className="hidden md:flex w-64 lg:w-72 h-screen fixed left-0 top-0 z-50 flex-col material-chrome border-y-0 border-l-0 px-4 lg:px-5 py-6 text-[var(--color-text)]">
                {/* Logo */}
                <div className="flex items-center gap-2.5 px-3 h-10">
                    <BrandMark className="w-6 h-6 text-[var(--color-text)]" />
                    <span className="text-[20px] font-semibold leading-none">StudyMeter</span>
                </div>
                <div className="px-3 mt-1.5 mb-8 flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
                    <span>Made by SeungHyeok</span>
                    {founder && (
                        <span className="founder-badge inline-flex items-center gap-1 font-medium">
                            <Icon icon="mdi:crown-outline" className="text-[14px]" />
                            Founder
                        </span>
                    )}
                </div>

                <nav className="flex-1 flex flex-col gap-1">
                    {NAV_ITEMS.map((item) => {
                        const active = isActive(item.path)
                        return (
                            <NavLink key={item.path} to={item.path} end={item.path === '/'} className="sidebar-link">
                                {active && (
                                    <motion.span
                                        layoutId="sidebar-active"
                                        transition={spring.default}
                                        className="absolute inset-0 rounded-full bg-[var(--accent-soft)]"
                                    />
                                )}
                                <Icon icon={active ? item.activeIcon : item.icon} className={`text-[22px] relative z-10 shrink-0 ${active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />
                                <span className="relative z-10">{item.label}</span>
                            </NavLink>
                        )
                    })}
                </nav>

                {/* User Info */}
                <div className="mt-auto flex items-center gap-3 p-3 rounded-[20px] bg-[var(--surface-raised)]">
                    {settings.profilePicture ? (
                        <img
                            src={settings.profilePicture}
                            alt="프로필"
                            className="w-10 h-10 rounded-full object-cover"
                        />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[16px] font-medium text-[var(--color-primary)]">
                            {settings.userName.charAt(0)}
                        </div>
                    )}
                    <span className="text-[16px] font-medium truncate">{settings.userName}</span>
                </div>
            </aside>

            {/* Mobile Bottom Tab Bar — 화면 아래에 붙은 크롬, 활성 탭 위에 앰버 바늘 */}
            <nav
                className="md:hidden fixed bottom-0 left-0 right-0 material-chrome border-x-0 border-b-0 z-50 flex justify-around items-stretch"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
                {NAV_ITEMS.map((item) => {
                    const active = isActive(item.path)
                    return (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === '/'}
                            className="relative flex-1 h-16 flex flex-col items-center justify-center gap-1 select-none"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                            onClick={() => { if (!active) NativeBridge.haptic('tick') }}
                        >
                            <span className="relative w-14 h-8 flex items-center justify-center">
                                {active && (
                                    <motion.span
                                        layoutId="tabbar-active"
                                        transition={spring.default}
                                        className="absolute inset-0 rounded-full bg-[var(--accent-soft)]"
                                    />
                                )}
                                <Icon
                                    icon={active ? item.activeIcon : item.icon}
                                    className={`relative text-[22px] transition-colors duration-150 ${active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`}
                                />
                            </span>
                            <span className={`text-[11px] leading-none font-medium transition-colors duration-150 ${active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                                {item.label}
                            </span>
                        </NavLink>
                    )
                })}
            </nav>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 lg:ml-72 px-4 md:px-8 xl:px-12 pb-28 md:pb-16 min-h-screen pt-[calc(1.25rem+env(safe-area-inset-top))] md:pt-10">
                <div className="max-w-[1480px] mx-auto animate-fade-in">
                    {/* 화면 코드가 아직 안 받아졌을 때 앱 전체(탭바 포함)가 하얗게 비지 않도록
                        본문만 기다리게 한다. */}
                    <Suspense fallback={null}>
                        <Outlet />
                    </Suspense>
                </div>
            </main>
        </div>
    )
}
