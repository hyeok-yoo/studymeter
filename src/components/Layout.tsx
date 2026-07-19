import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Settings } from '../lib/db'
import { spring } from '../lib/motion'

interface LayoutProps {
    settings: Settings
    onSettingsChange: (settings: Settings) => void
}

const NAV_ITEMS = [
    { path: '/', icon: 'mdi:home-outline', activeIcon: 'mdi:home', label: '홈' },
    { path: '/records', icon: 'mdi:chart-bar', activeIcon: 'mdi:chart-bar', label: '기록' },
    { path: '/edit-records', icon: 'mdi:pencil-outline', activeIcon: 'mdi:pencil', label: '편집' },
    { path: '/gemini', icon: 'mdi:sparkles', activeIcon: 'mdi:sparkles', label: 'Gemini' },
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
            {/* Desktop Sidebar — 콘텐츠가 밑으로 지나가는 떠 있는 크롬 */}
            <aside className="hidden md:flex w-72 h-screen fixed left-0 top-0 z-50 flex-col p-6">
                <div className="material-chrome rounded-[28px] h-full flex flex-col p-6 overflow-hidden text-[var(--color-text)]">
                    {/* Logo */}
                    <div className="mb-2 px-2 flex items-center gap-3">
                        <img src={`${import.meta.env.BASE_URL}logo_chart.svg`} alt="StudyMeter Logo" className="w-10 h-10 drop-shadow-lg logo-float" />
                        <h1 className="text-2xl font-black text-display gradient-text">StudyMeter</h1>
                    </div>
                    <div className="mb-8 px-2 flex flex-col gap-1.5">
                        {founder && (
                            <span className="founder-badge self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black tracking-[0.25em] uppercase text-white bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 ring-1 ring-blue-300/50">
                                <Icon icon="mdi:crown" className="text-[11px]" />
                                Founder
                            </span>
                        )}
                        <p className="text-[10px] font-medium text-[var(--color-text-secondary)] tracking-widest uppercase opacity-70">
                            Made by SeungHyeok
                        </p>
                    </div>

                    {/* Navigation — 활성 배경이 스프링으로 따라 움직인다 */}
                    <nav className="flex-1 flex flex-col gap-1">
                        {NAV_ITEMS.map((item) => {
                            const active = isActive(item.path)
                            return (
                                <NavLink key={item.path} to={item.path} end={item.path === '/'} className="sidebar-link">
                                    {active && (
                                        <motion.span
                                            layoutId="sidebar-active"
                                            transition={spring.default}
                                            className="absolute inset-0 rounded-2xl bg-[var(--color-primary)]/12 dark:bg-[var(--color-primary)]/25 border border-[var(--color-primary)]/20"
                                        />
                                    )}
                                    <Icon icon={active ? item.activeIcon : item.icon} className={`text-xl relative z-10 ${active ? 'text-[var(--color-primary)] dark:text-white' : ''}`} />
                                    <span className={`relative z-10 ${active ? 'text-[var(--color-primary)] dark:text-white font-bold' : ''}`}>{item.label}</span>
                                </NavLink>
                            )
                        })}
                    </nav>

                    {/* User Info */}
                    <div className="mt-auto pt-6 border-t border-white/10">
                        <div className="flex items-center gap-4 glass-card-elevated p-4 rounded-2xl">
                            {settings.profilePicture ? (
                                <img
                                    src={settings.profilePicture}
                                    alt="프로필"
                                    className="w-10 h-10 rounded-full object-cover shadow-lg"
                                />
                            ) : (
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center font-bold text-white shadow-lg">
                                    {settings.userName.charAt(0)}
                                </div>
                            )}
                            <div className="flex flex-col min-w-0">
                                <span className="font-bold truncate text-sm">{settings.userName}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Mobile Bottom Tab Bar — 떠 있는 필 + 스프링 활성 인디케이터 */}
            <nav
                className="md:hidden fixed bottom-4 left-4 right-4 material-chrome z-50 flex justify-around items-stretch rounded-[26px] overflow-hidden"
                style={{ paddingBottom: 'max(0px, calc(env(safe-area-inset-bottom) - 8px))' }}
            >
                {NAV_ITEMS.map((item) => {
                    const active = isActive(item.path)
                    return (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            end={item.path === '/'}
                            className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none"
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                            {active && (
                                <motion.span
                                    layoutId="tabbar-active"
                                    transition={spring.default}
                                    className="absolute inset-x-2 inset-y-1.5 rounded-2xl bg-[var(--color-primary)]/12 dark:bg-[var(--color-primary)]/25"
                                />
                            )}
                            <motion.span
                                animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }}
                                transition={spring.snappy}
                                className={`relative z-10 flex flex-col items-center gap-0.5 ${active ? 'text-[var(--color-primary)] dark:text-white' : 'text-[var(--color-text-secondary)]'}`}
                            >
                                <Icon icon={active ? item.activeIcon : item.icon} className="text-2xl" />
                                <span className="text-[10px] font-extrabold tracking-wide">{item.label}</span>
                            </motion.span>
                        </NavLink>
                    )
                })}
            </nav>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-72 p-6 md:p-12 pb-32 md:pb-12 min-h-screen pt-[calc(1.5rem+env(safe-area-inset-top))] md:pt-12">
                <div className="max-w-6xl mx-auto animate-fade-in">
                    <Outlet />
                </div>
            </main>
        </div>
    )
}
