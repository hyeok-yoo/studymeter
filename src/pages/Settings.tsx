import { useState, useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import type { Settings, SubjectItem } from '../lib/db'
import { db } from '../lib/db'
import { useModal } from '../lib/ModalContext'
import { useFocusSync } from '../lib/focusSync'
import { useFocusNative } from '../lib/useFocusNative'
import { TabletCamera } from '../components/TabletCamera'

interface SettingsPageProps {
    settings: Settings
    onSettingsChange: (settings: Settings) => void
}

// IP만 / 포트 누락 / http 스킴 / /ws 경로 누락 입력을 ws://HOST:8765/ws 로 보강.
function normalizeWsUrl(raw: string): string {
    let url = raw.trim()
    if (!url) return ''
    url = url.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')
    if (!/^wss?:\/\//i.test(url)) url = 'ws://' + url
    try {
        const u = new URL(url)
        if (!u.port) u.port = '8765'
        if (!u.pathname || u.pathname === '/') u.pathname = '/ws'
        return u.toString()
    } catch {
        return url
    }
}

interface GeminiModel {
    name: string
    displayName: string
    description: string
}

export default function SettingsPage({ settings, onSettingsChange }: SettingsPageProps) {
    const { showAlert, showConfirm, showPrompt } = useModal()
    const [userName, setUserName] = useState(settings.userName)
    const [localSubjects, setLocalSubjects] = useState<SubjectItem[]>(settings.subjects)
    const [types, setTypes] = useState(settings.types.join(', '))
    const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey || '')
    const [geminiModel, setGeminiModel] = useState(settings.geminiModel || 'gemini-2.0-flash')
    const [theme, setTheme] = useState(settings.theme)
    const [profilePicture, setProfilePicture] = useState(settings.profilePicture || '')
    const [saved, setSaved] = useState(false)
    const [geminiModels, setGeminiModels] = useState<GeminiModel[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // PC Focus 연결 설정 상태
    const [serverUrlInput, setServerUrlInput] = useState(() => localStorage.getItem('focus_server_url') || '')
    const [activeServerUrl, setActiveServerUrl] = useState(() => localStorage.getItem('focus_server_url') || '')
    const [captureCount, setCaptureCount] = useState(0)
    const [currentCalibMode, setCurrentCalibMode] = useState<'book' | 'monitor' | null>(null)
    const {
        connected,
        pipelineState,
        sendCalibrateStart,
        sendCalibrateCapture,
        sendPipelineStart,
        sendPipelineStop,
        sendVideoFrame,
    } = useFocusSync(activeServerUrl)

    const {
        isNative,
        status: nativeStatus,
        trainingState,
        startCalibration: startNativeCalibration,
        resetScoreCalibration,
    } = useFocusNative()
    const [nativeCalibRunning, setNativeCalibRunning] = useState(false)

    const handleNativeCalibration = async (scenario: 'book' | 'monitor') => {
        setNativeCalibRunning(true)
        try { await startNativeCalibration(scenario) } finally { setNativeCalibRunning(false) }
    }

    const handleSaveServerUrl = () => {
        const normalized = normalizeWsUrl(serverUrlInput)
        localStorage.setItem('focus_server_url', normalized)
        setServerUrlInput(normalized)
        setActiveServerUrl(normalized)
        setCaptureCount(0)
    }

    const CALIB_LABELS = [
        '좌측 상단', '상단 중앙', '우측 상단',
        '좌측 중앙', '정중앙',   '우측 중앙',
        '좌측 하단', '하단 중앙', '우측 하단',
    ]

    const handleCalibrateStart = (mode: 'book' | 'monitor') => {
        sendCalibrateStart(mode)
        setCaptureCount(0)
        setCurrentCalibMode(mode)
    }

    const handleCalibrateCapture = () => {
        sendCalibrateCapture()
        setCaptureCount(prev => {
            const next = Math.min(prev + 1, 9)
            if (next >= 9) setCurrentCalibMode(null)
            return next
        })
    }

    // Fetch available Gemini models when API key is set
    useEffect(() => {
        async function fetchModels() {
            if (!geminiApiKey || geminiApiKey.length < 10) {
                // Use default models if no API key
                setGeminiModels([
                    { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: '빠름' },
                    { name: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash Lite', description: '더 빠름' },
                    { name: 'gemini-2.5-flash-preview-05-20', displayName: 'Gemini 2.5 Flash', description: '최신' },
                    { name: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro', description: '고성능' },
                ])
                return
            }

            setLoadingModels(true)
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`)
                if (response.ok) {
                    const data = await response.json()
                    const chatModels = data.models
                        ?.filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
                        ?.map((m: any) => ({
                            name: m.name.replace('models/', ''),
                            displayName: m.displayName,
                            description: m.description?.substring(0, 30) || ''
                        }))
                        ?.slice(0, 10) || []

                    if (chatModels.length > 0) {
                        setGeminiModels(chatModels)
                    }
                }
            } catch (error) {
                console.error('Failed to fetch models:', error)
            } finally {
                setLoadingModels(false)
            }
        }
        fetchModels()
    }, [geminiApiKey])

    // Handle profile picture upload
    const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // Check file size (max 500KB for offline storage)
        if (file.size > 500 * 1024) {
            showAlert('이미지 용량 초과', '이미지 크기는 500KB 이하로 해주세요.')
            return
        }

        const reader = new FileReader()
        reader.onloadend = () => {
            const base64 = reader.result as string
            setProfilePicture(base64)
            // Save immediately
            db.settings.update(settings.id!, { profilePicture: base64 })
            onSettingsChange({ ...settings, profilePicture: base64 })
        }
        reader.readAsDataURL(file)
    }

    const handleRemoveProfilePicture = () => {
        setProfilePicture('')
        db.settings.update(settings.id!, { profilePicture: undefined })
        onSettingsChange({ ...settings, profilePicture: undefined })
    }

    const handleAddSubject = async () => {
        const name = await showPrompt('과목 추가', '새 과목 이름을 입력하세요:')
        if (name) {
            setLocalSubjects([...localSubjects, { name, children: [] }])
        }
    }

    const handleRemoveSubject = async (index: number) => {
        const confirmed = await showConfirm('과목 삭제', `'${localSubjects[index].name}' 과목을 삭제하시겠습니까? 관련 세부 항목도 모두 삭제됩니다.`)
        if (confirmed) {
            const newSubjects = [...localSubjects]
            newSubjects.splice(index, 1)
            setLocalSubjects(newSubjects)
        }
    }

    const handleAddSubItem = async (subjectIndex: number) => {
        const name = await showPrompt('세부 항목 추가', `${localSubjects[subjectIndex].name}의 세부 항목 이름을 입력하세요:`)
        if (name) {
            const newSubjects = [...localSubjects]
            const subject = { ...newSubjects[subjectIndex] }
            subject.children = [...(subject.children || []), name]
            newSubjects[subjectIndex] = subject
            setLocalSubjects(newSubjects)
        }
    }

    const handleRemoveSubItem = (subjectIndex: number, childIndex: number) => {
        const newSubjects = [...localSubjects]
        const subject = { ...newSubjects[subjectIndex] }
        const children = [...(subject.children || [])]
        children.splice(childIndex, 1)
        subject.children = children
        newSubjects[subjectIndex] = subject
        setLocalSubjects(newSubjects)
    }

    const handleSave = async () => {
        const newSettings: Settings = {
            ...settings,
            userName,
            subjects: localSubjects,
            types: types.split(',').map(s => s.trim()).filter(s => s),
            geminiApiKey: geminiApiKey || undefined,
            geminiModel: geminiModel || undefined,
            theme,
            profilePicture: profilePicture || undefined
        }

        await db.settings.update(settings.id!, newSettings as any)
        onSettingsChange(newSettings)

        // Apply theme
        if (theme === 'dark') {
            document.documentElement.classList.add('dark')
        } else if (theme === 'light') {
            document.documentElement.classList.remove('dark')
        } else {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
            document.documentElement.classList.toggle('dark', prefersDark)
        }

        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    return (
        <div className="animate-fade-in max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold gradient-text mb-8">설정</h1>

            <div className="space-y-6">
                {/* Profile Picture */}
                <div className="glass-card p-6">
                    <label className="block text-sm font-medium mb-4">프로필 사진</label>
                    <div className="flex items-center gap-6">
                        {profilePicture ? (
                            <img
                                src={profilePicture}
                                alt="프로필"
                                className="w-20 h-20 rounded-full object-cover shadow-lg border-4 border-[var(--color-primary)]"
                            />
                        ) : (
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center text-3xl font-bold text-white shadow-lg">
                                {userName.charAt(0)}
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleProfilePictureChange}
                                className="hidden"
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-all flex items-center gap-2"
                            >
                                <Icon icon="mdi:camera-outline" className="text-lg" /> 사진 변경
                            </button>
                            {profilePicture && (
                                <button
                                    onClick={handleRemoveProfilePicture}
                                    className="px-4 py-2 rounded-xl bg-red-500/20 text-red-500 font-medium text-sm hover:bg-red-500/30 transition-all flex items-center gap-2"
                                >
                                    <Icon icon="mdi:trash-can-outline" className="text-lg" /> 삭제
                                </button>
                            )}
                            <p className="text-xs text-[var(--color-text-secondary)]">최대 500KB</p>
                        </div>
                    </div>
                </div>

                {/* User Name */}
                <div className="glass-card p-6">
                    <label className="block text-sm font-medium mb-2">사용자 이름</label>
                    <input
                        type="text"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                    />
                </div>

                {/* Subjects with Hierarchy Management */}
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-medium">과목 및 하위 항목 관리</label>
                        <button
                            onClick={handleAddSubject}
                            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold hover:bg-indigo-500/20 transition-all"
                        >
                            + 과목 추가
                        </button>
                    </div>

                    <div className="space-y-4">
                        {localSubjects.map((subject, sIdx) => (
                            <div key={sIdx} className="p-4 rounded-xl bg-white/5 border border-white/5">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="font-bold text-indigo-400">{subject.name}</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleAddSubItem(sIdx)}
                                            className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10"
                                        >
                                            + 하위 항목
                                        </button>
                                        <button
                                            onClick={() => handleRemoveSubject(sIdx)}
                                            className="text-[10px] px-2 py-1 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20"
                                        >
                                            삭제
                                        </button>
                                    </div>
                                </div>

                                {subject.children && subject.children.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {subject.children.map((child, cIdx) => (
                                            <div key={cIdx} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 text-xs font-medium border border-indigo-500/20">
                                                <span>{child}</span>
                                                <button
                                                    onClick={() => handleRemoveSubItem(sIdx, cIdx)}
                                                    className="opacity-40 hover:opacity-100 flex items-center justify-center p-0.5"
                                                >
                                                    <Icon icon="mdi:close" className="text-sm" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-white/30 italic">하위 항목이 없습니다.</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Types */}
                <div className="glass-card p-6">
                    <label className="block text-sm font-medium mb-2">유형 (쉼표로 구분)</label>
                    <input
                        type="text"
                        value={types}
                        onChange={(e) => setTypes(e.target.value)}
                        placeholder="자습, 수업, 테스트, ..."
                        className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                    />
                </div>

                {/* Theme */}
                <div className="glass-card p-6">
                    <label className="block text-sm font-medium mb-3">테마</label>
                    <div className="flex gap-3">
                        {(['light', 'dark', 'system'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => {
                                    setTheme(t)
                                    // Instantly apply theme
                                    if (t === 'dark') {
                                        document.documentElement.classList.add('dark')
                                    } else if (t === 'light') {
                                        document.documentElement.classList.remove('dark')
                                    } else {
                                        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                                        document.documentElement.classList.toggle('dark', prefersDark)
                                    }
                                    // Also save to DB immediately
                                    db.settings.update(settings.id!, { theme: t })
                                    onSettingsChange({ ...settings, theme: t })
                                }}
                                className={`flex-1 py-3 rounded-xl font-medium transition-all ${theme === t
                                    ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    {t === 'light' ? <><Icon icon="mdi:white-balance-sunny" className="text-lg" /> 라이트</> : t === 'dark' ? <><Icon icon="mdi:weather-night" className="text-lg" /> 다크</> : <><Icon icon="mdi:remote-desktop" className="text-lg" /> 시스템</>}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Gemini API */}
                <div className="glass-card p-6">
                    <label className="block text-sm font-medium mb-2">Gemini API Key</label>
                    <input
                        type="password"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                    />
                    <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">
                            Google AI Studio에서 API 키 발급받기 →
                        </a>
                    </p>
                </div>

                {/* Gemini Model */}
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-medium">Gemini 모델 설정</label>
                        {loadingModels && <span className="text-[10px] text-[var(--color-text-secondary)] animate-pulse">동기화 중...</span>}
                    </div>

                    <select
                        value={geminiModel}
                        onChange={(e) => setGeminiModel(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                    >
                        {geminiModels.map((model) => (
                            <option key={model.name} value={model.name}>
                                {model.displayName} ({model.description})
                            </option>
                        ))}
                    </select>
                </div>

                {/* 태블릿 자체 측정 설정 */}
                <div className="glass-card p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium">태블릿 자체 측정</label>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isNative ? 'bg-green-400' : 'bg-white/20'}`} />
                            <span className="text-xs text-[var(--color-text-secondary)]">
                                {isNative ? '앱 환경' : '브라우저 — 앱에서만 사용 가능'}
                            </span>
                        </div>
                    </div>

                    {/* Gaze calibration */}
                    <div className="pt-2 border-t border-[var(--color-border)]">
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-3">시선 캘리브레이션</p>
                        {!isNative && (
                            <p className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)] rounded-xl px-4 py-3">
                                Android 앱에서만 사용 가능합니다.
                            </p>
                        )}
                        {isNative && (
                            <>
                                <p className="text-[10px] text-white/40 mb-3">
                                    캘리브레이션 화면이 열립니다. 빨간 점을 차례로 응시하고 버튼을 눌러 9개 지점을 캡처하세요.
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleNativeCalibration('book')}
                                        disabled={nativeCalibRunning || nativeStatus === 'starting'}
                                        className="flex-1 px-4 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 font-medium text-sm hover:bg-indigo-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Icon icon="mdi:book-open-outline" className="text-base" />
                                        책 캘리브레이션
                                    </button>
                                    <button
                                        onClick={() => handleNativeCalibration('monitor')}
                                        disabled={nativeCalibRunning || nativeStatus === 'starting'}
                                        className="flex-1 px-4 py-3 rounded-xl bg-purple-500/10 text-purple-400 font-medium text-sm hover:bg-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        <Icon icon="mdi:monitor-outline" className="text-base" />
                                        모니터 캘리브레이션
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Score personalization */}
                    <div className="pt-2 border-t border-[var(--color-border)]">
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-3">점수 개인화</p>
                        {trainingState ? (
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-white/70">
                                        누적 세션: <span className="font-bold text-white">{trainingState.session_count}회</span>
                                    </p>
                                    <p className="text-[10px] text-white/40 mt-0.5">
                                        {trainingState.is_calibrated
                                            ? '✓ 개인화 점수 적용 중'
                                            : `${Math.max(0, 3 - trainingState.session_count)}회 더 평가 필요`}
                                    </p>
                                </div>
                                {isNative && (
                                    <button
                                        onClick={resetScoreCalibration}
                                        className="text-[10px] px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 font-bold hover:bg-red-500/20 transition-all"
                                    >
                                        초기화
                                    </button>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-[var(--color-text-secondary)]">
                                측정 세션 종료 후 집중도를 평가하면 점수가 당신에게 맞게 조정됩니다.
                            </p>
                        )}
                    </div>
                </div>

                {/* PC Focus 연결 설정 */}
                <div className="glass-card p-6 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium">PC Focus 서버 연결</label>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
                            <span className={`text-xs font-medium ${connected ? 'text-green-400' : 'text-[var(--color-text-secondary)]'}`}>
                                {connected ? '연결됨' : '연결 안 됨'}
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={serverUrlInput}
                            onChange={(e) => setServerUrlInput(e.target.value)}
                            placeholder="예: 192.168.25.14 (IP만 입력해도 자동 보강)"
                            className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] text-sm font-mono"
                        />
                        <button
                            onClick={handleSaveServerUrl}
                            className="px-4 py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-all whitespace-nowrap"
                        >
                            저장
                        </button>
                    </div>
                    {activeServerUrl && (
                        <p className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-60">
                            현재 연결 시도: {activeServerUrl}
                        </p>
                    )}

                    <div className="pt-2 border-t border-[var(--color-border)]">
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-3">파이프라인 컨트롤</p>

                        <div className="flex items-center gap-2 mb-2">
                            {pipelineState === null ? (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-white/40" />
                                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">상태 불명</span>
                                </>
                            ) : pipelineState.running ? (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-green-400" />
                                    <span className="text-xs font-medium text-green-400">실행 중</span>
                                </>
                            ) : (
                                <>
                                    <div className="w-2 h-2 rounded-full bg-red-400" />
                                    <span className="text-xs font-medium text-red-400">정지</span>
                                </>
                            )}
                        </div>

                        <p className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-60 mb-3">
                            모델: {pipelineState?.model ?? '없음'} · 캘리: {pipelineState?.calibration ?? '없음'} · fps: {pipelineState ? pipelineState.fps.toFixed(1) : '-'}
                        </p>

                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={sendPipelineStart}
                                disabled={!connected || (pipelineState?.running === true)}
                                className="flex-1 px-4 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 font-medium text-sm hover:bg-indigo-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Icon icon="mdi:play" className="text-base" />
                                시작
                            </button>
                            <button
                                onClick={sendPipelineStop}
                                disabled={!connected || (pipelineState?.running !== true)}
                                className="flex-1 px-4 py-3 rounded-xl bg-red-500/10 text-red-400 font-medium text-sm hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Icon icon="mdi:stop" className="text-base" />
                                정지
                            </button>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--color-border)]">
                        <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-3">캘리브레이션</p>

                        {!connected && (
                            <p className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)] rounded-xl px-4 py-3 mb-3">
                                PC에 연결되지 않음 — 서버 URL을 저장하면 자동으로 연결됩니다.
                            </p>
                        )}

                        {/* 캘리 진행 중 안내 */}
                        {currentCalibMode !== null && captureCount < 9 && (
                            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 mb-3">
                                <p className="text-xs font-bold text-indigo-400 mb-1">
                                    {captureCount + 1}/9 — <span className="text-white">{CALIB_LABELS[captureCount]}</span>을(를) 바라보세요
                                </p>
                                <p className="text-[10px] text-white/40">
                                    {currentCalibMode === 'book' ? '책' : '모니터'}의 해당 위치를 응시한 뒤 캡처 버튼을 누르세요
                                </p>
                            </div>
                        )}
                        {currentCalibMode === null && captureCount >= 9 && (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-3">
                                <p className="text-xs font-bold text-green-400">캘리브레이션 완료!</p>
                            </div>
                        )}

                        {/* 캘리 중 카메라 자동 활성 (video_frame PC 전송) */}
                        {currentCalibMode !== null && (
                            <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, overflow: 'hidden' }}>
                                <TabletCamera sendVideoFrame={sendVideoFrame} connected={connected} fps={15} autoStart />
                            </div>
                        )}

                        <div className="flex gap-2 mb-3">
                            <button
                                onClick={() => handleCalibrateStart('book')}
                                disabled={!connected}
                                className="flex-1 px-4 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 font-medium text-sm hover:bg-indigo-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Icon icon="mdi:book-open-outline" className="text-base" />
                                책 캘리브레이션
                            </button>
                            <button
                                onClick={() => handleCalibrateStart('monitor')}
                                disabled={!connected}
                                className="flex-1 px-4 py-3 rounded-xl bg-purple-500/10 text-purple-400 font-medium text-sm hover:bg-purple-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Icon icon="mdi:monitor-outline" className="text-base" />
                                모니터 캘리브레이션
                            </button>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleCalibrateCapture}
                                disabled={!connected || captureCount >= 9}
                                className="flex-1 px-4 py-3 rounded-xl bg-green-500/10 text-green-400 font-medium text-sm hover:bg-green-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Icon icon="mdi:camera-iris" className="text-base" />
                                캡처
                            </button>
                            <div className="flex items-center gap-2 min-w-[90px]">
                                <div className="flex gap-0.5">
                                    {Array.from({ length: 9 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className={`w-2 h-2 rounded-full transition-all ${i < captureCount ? 'bg-green-400' : 'bg-[var(--color-border)]'}`}
                                        />
                                    ))}
                                </div>
                                <span className="text-xs text-[var(--color-text-secondary)] font-mono ml-1">{captureCount}/9</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <button
                    onClick={handleSave}
                    className="w-full btn btn-primary text-lg py-4 flex items-center justify-center gap-2"
                >
                    {saved ? <><Icon icon="mdi:check-bold" className="text-xl" /> 저장됨!</> : '저장하기'}
                </button>

                {/* Build Information */}
                <div className="mt-8 pt-8 border-t border-[var(--color-border)] text-center flex flex-col items-center gap-1">
                    <p className="text-xs font-bold text-[var(--color-text-secondary)] opacity-80 mb-1">
                        Made by SeungHyeok Yoo
                    </p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-60">
                        StudyMeter Version 1.1.2
                    </p>
                    <p className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-40">
                        Build: {new Date(__BUILD_DATE__).toLocaleString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        })}
                    </p>
                </div>
            </div>
        </div>
    )
}
