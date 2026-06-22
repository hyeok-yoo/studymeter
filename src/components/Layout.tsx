import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useEffect, useState } from 'react'
import type { Settings } from '../lib/db'

interface LayoutProps {
    settings: Settings
    onSettingsChange: (settings: Settings) => void
}

export default function Layout({ settings }: LayoutProps) {
    const [founder, setFounder] = useState(false)
    useEffect(() => {
        import('../lib/telemetry').then(({ isOwner }) => setFounder(isOwner()))
    }, [])
    const navItems = [
        { path: '/', icon: 'mdi:home-outline', label: '홈' },
        { path: '/records', icon: 'mdi:chart-bar', label: '기록' },
        { path: '/edit-records', icon: 'mdi:pencil-outline', label: '편집' },
        { path: '/gemini', icon: 'mdi:sparkles', label: 'Gemini' },
        { path: '/settings', icon: 'mdi:cog-outline', label: '설정' },
    ]

    return (
        <div className="min-h-screen flex flex-col md:flex-row relative">
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex w-72 h-screen fixed left-0 top-0 z-50 flex-col p-6">
                <div className="glass-card h-full flex flex-col p-6 overflow-hidden text-[var(--color-text)]">
                    {/* Logo */}
                    <div className="mb-2 px-2 flex items-center gap-3">
                        <img src={`${import.meta.env.BASE_URL}logo_chart.svg`} alt="StudyMeter Logo" className="w-10 h-10 drop-shadow-lg logo-float" />
                        <h1 className="text-2xl font-black tracking-tight gradient-text">StudyMeter</h1>
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

                    {/* Navigation */}
                    <nav className="flex-1 flex flex-col gap-2">
                        {navItems.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                end={item.path === '/'}
                                className={({ isActive }) =>
                                    `sidebar-link ${isActive ? 'active' : 'hover:bg-white/5 opacity-80 hover:opacity-100'}`
                                }
                            >
                                <Icon icon={item.icon} className="text-xl" />
                                <span>{item.label}</span>
                            </NavLink>
                        ))}
                    </nav>

                    {/* User Info */}
                    <div className="mt-auto pt-6 border-t border-white/10">
                        <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl">
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

            {/* Mobile Bottom Navigation */}
            <nav className="md:hidden fixed bottom-6 left-6 right-6 h-20 glass-card z-50 flex justify-around items-center px-4 overflow-hidden">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === '/'}
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center transition-all duration-300 ${isActive ? 'text-[var(--color-primary)] scale-110 -translate-y-1' : 'text-[var(--color-text-secondary)] scale-90'
                            }`
                        }
                    >
                        <Icon icon={item.icon} className="text-2xl mb-1" />
                        <span className="text-[10px] font-extrabold uppercase tracking-widest">{item.label}</span>
                        {/* Active Dot */}
                        <NavLink
                            to={item.path}
                            end={item.path === '/'}
                            className={({ isActive }) => `w-1 h-1 bg-[var(--color-primary)] rounded-full mt-1.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </NavLink>
                ))}
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
