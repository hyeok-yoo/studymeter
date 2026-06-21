import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, SubjectItem } from '../lib/db'
import { db } from '../lib/db'
import { exportBackup, importBackup } from '../lib/backup'
import { useModal } from '../lib/ModalContext'
import { useFocusSync } from '../lib/focusSync'
import { useFocusNative } from '../lib/useFocusNative'
import { TabletCamera } from '../components/TabletCamera'
import { HelpButton } from '../components/HelpButton'
import DevAccessModal from '../components/DevAccessModal'
import { isDevAdminDevice } from '../lib/telemetry'
import { fetchGeminiModels, type GeminiModel } from '../lib/gemini'

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

export default function SettingsPage({ settings, onSettingsChange }: SettingsPageProps) {
    const navigate = useNavigate()
    const { showAlert, showConfirm, showPrompt } = useModal()
    const [userName, setUserName] = useState(settings.userName)
    const [localSubjects, setLocalSubjects] = useState<SubjectItem[]>(settings.subjects)
    const [types, setTypes] = useState(settings.types.join(', '))
    const [geminiApiKey, setGeminiApiKey] = useState(settings.geminiApiKey || '')
    const [geminiModel, setGeminiModel] = useState(settings.geminiModel || '')
    const [theme, setTheme] = useState(settings.theme)
    const [profilePicture, setProfilePicture] = useState(settings.profilePicture || '')
    const [dailyGoalHours, setDailyGoalHours] = useState(
        settings.dailyGoalMs ? String(settings.dailyGoalMs / 3600000) : ''
    )
    const [drowsinessSec, setDrowsinessSec] = useState(
        String(settings.drowsinessThresholdSec ?? 15)
    )
    const [saved, setSaved] = useState(false)
    const [geminiModels, setGeminiModels] = useState<GeminiModel[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const backupInputRef = useRef<HTMLInputElement>(null)
    const [exporting, setExporting] = useState(false)
    const [importing, setImporting] = useState(false)

    // 숨겨진 개발자 진입: 버전명 5회 탭
    const [showDevAccess, setShowDevAccess] = useState(false)
    const [devAdmin, setDevAdmin] = useState(isDevAdminDevice())
    const versionTapCount = useRef(0)
    const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleVersionTap = () => {
        versionTapCount.current += 1
        if (versionTapTimer.current) clearTimeout(versionTapTimer.current)
        versionTapTimer.current = setTimeout(() => { versionTapCount.current = 0 }, 1500)
        if (versionTapCount.current >= 5) {
            versionTapCount.current = 0
            if (versionTapTimer.current) clearTimeout(versionTapTimer.current)
            setShowDevAccess(true)
        }
    }

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

    // API 키가 입력되면 사용 가능한 Gemini 모델 목록을 API 에서 동적으로 가져온다.
    // (모델명을 앱에 하드코딩하지 않는다 — 키마다 실제 사용 가능한 모델만 노출)
    useEffect(() => {
        if (!geminiApiKey || geminiApiKey.length < 10) {
            setGeminiModels([])
            setModelsError(null)
            return
        }
        let cancelled = false
        setLoadingModels(true)
        setModelsError(null)
        fetchGeminiModels(geminiApiKey)
            .then((models) => {
                if (cancelled) return
                setGeminiModels(models)
                if (models.length === 0) setModelsError('사용 가능한 모델이 없습니다. 키를 확인하세요.')
            })
            .catch((err) => {
                if (cancelled) return
                setGeminiModels([])
                setModelsError(err instanceof Error ? err.message : '모델 목록을 불러오지 못했습니다.')
            })
            .finally(() => { if (!cancelled) setLoadingModels(false) })
        return () => { cancelled = true }
    }, [geminiApiKey])

    // 목록이 로드되면, 선택된 모델이 목록에 없을 때 첫 모델로 자동 보정한다.
    useEffect(() => {
        if (geminiModels.length === 0) return
        if (!geminiModels.some((m) => m.name === geminiModel)) {
            setGeminiModel(geminiModels[0].name)
        }
    }, [geminiModels, geminiModel])

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
        const goalHours = parseFloat(dailyGoalHours)
        const drowsySec = parseInt(drowsinessSec, 10)
        const newSettings: Settings = {
            ...settings,
            userName,
            subjects: localSubjects,
            types: types.split(',').map(s => s.trim()).filter(s => s),
            geminiApiKey: geminiApiKey || undefined,
            geminiModel: geminiModel || undefined,
            theme,
            profilePicture: profilePicture || undefined,
            dailyGoalMs: (!isNaN(goalHours) && goalHours > 0) ? Math.round(goalHours * 3600000) : undefined,
            drowsinessThresholdSec: (!isNaN(drowsySec) && drowsySec > 0) ? Math.min(120, Math.max(3, drowsySec)) : 15
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

    const handleExportBackup = async () => {
        if (exporting) return
        setExporting(true)
        try {
            await exportBackup(__APP_VERSION__)
        } catch (e) {
            console.error('백업 내보내기 실패', e)
            // 사용자가 공유 시트를 취소한 경우는 오류로 보지 않음
            const msg = e instanceof Error ? e.message : ''
            if (!/cancel/i.test(msg)) {
                await showAlert('내보내기 실패', '백업 파일을 만들지 못했습니다. 잠시 후 다시 시도하세요.')
            }
        } finally {
            setExporting(false)
        }
    }

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        // 같은 파일을 다시 선택할 수 있도록 input 초기화
        e.target.value = ''
        if (!file) return

        const confirmed = await showConfirm(
            '데이터 복원',
            '현재 기기의 모든 설정·기록이 백업 파일 내용으로 교체됩니다. 계속하시겠습니까?'
        )
        if (!confirmed) return

        setImporting(true)
        try {
            const text = await file.text()
            const summary = await importBackup(text)
            await showAlert(
                '복원 완료',
                `세션 ${summary.sessions}개, 일일기록 ${summary.dailyRecords}개, 메모 ${summary.thoughtNotes}개를 불러왔습니다. 적용을 위해 앱을 다시 시작합니다.`
            )
            window.location.reload()
        } catch (err) {
            console.error('백업 가져오기 실패', err)
            const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
            await showAlert('복원 실패', msg)
        } finally {
            setImporting(false)
        }
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

                {/* Daily Goal */}
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <label className="block text-sm font-medium">일일 목표 시간</label>
                        <HelpButton title="일일 목표 시간" items={[
                            { description: '하루 동안 달성하고 싶은 총 공부 시간 목표를 설정합니다.' },
                            { title: '진척 바', description: '공부 타이머 화면 하단에 목표 대비 진행률을 퍼센트 바로 실시간 표시합니다.' },
                            { title: '비워두면', description: '진척 바가 비활성화되며 목표 없이 자유롭게 사용할 수 있습니다.' },
                        ]} />
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-3">공부 화면에 진척 바로 표시됩니다. 비워두면 비활성화.</p>
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            value={dailyGoalHours}
                            onChange={(e) => setDailyGoalHours(e.target.value)}
                            placeholder="예: 8"
                            className="w-28 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] text-center text-lg font-bold"
                        />
                        <span className="text-[var(--color-text-secondary)] font-medium">시간</span>
                        {dailyGoalHours && (
                            <span className="text-xs text-purple-400 font-bold ml-2">
                                = {parseFloat(dailyGoalHours) * 60}분 목표
                            </span>
                        )}
                    </div>
                </div>

                {/* Drowsiness threshold */}
                <div className="glass-card p-6">
                    <div className="flex items-center gap-2 mb-1">
                        <label className="block text-sm font-medium">졸음 감지 기준</label>
                        <HelpButton title="졸음 감지 기준" items={[
                            { description: '집중도 측정 중 눈이 감기거나 게슴츠레한 상태가 설정한 시간 이상 지속되면 졸음으로 판단해 알립니다.' },
                            { title: '알림 방식', description: '디바이스가 소리 모드면 소리, 진동 모드면 진동, 무음이면 화면 팝업으로 알립니다. 눈을 다시 뜨면 자동으로 사라집니다.' },
                            { title: '권장', description: '기본 15초. 너무 짧으면 잠깐 눈 감는 것에도 울릴 수 있어요.' },
                        ]} />
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-3">눈 감김이 몇 초 이상 지속되면 졸음으로 판단할지 설정합니다. (3~120초)</p>
                    <div className="flex items-center gap-3">
                        <input
                            type="number"
                            min="3"
                            max="120"
                            step="1"
                            value={drowsinessSec}
                            onChange={(e) => setDrowsinessSec(e.target.value)}
                            placeholder="15"
                            className="w-28 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] text-center text-lg font-bold"
                        />
                        <span className="text-[var(--color-text-secondary)] font-medium">초 이상 지속 시</span>
                    </div>
                </div>

                {/* Subjects with Hierarchy Management */}
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium">과목 및 하위 항목 관리</label>
                            <HelpButton title="과목 및 하위 항목" items={[
                                { description: '공부하는 과목 목록을 관리합니다. 공부 시작 시 과목을 선택하면 통계가 과목별로 집계됩니다.' },
                                { title: '하위 항목', description: '과목에 세부 분류를 추가할 수 있습니다. 예: 수학 > 미분, 적분 / 영어 > 문법, 독해. 타이머 화면에서 선택하면 더 세밀하게 시간을 관리할 수 있습니다.' },
                                { title: '삭제 주의', description: '과목을 삭제해도 기존 기록은 유지됩니다. 하지만 새로운 세션에서는 해당 과목을 선택할 수 없게 됩니다.' },
                            ]} />
                        </div>
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
                    <div className="flex items-center gap-2 mb-2">
                        <label className="block text-sm font-medium">유형 (쉼표로 구분)</label>
                        <HelpButton title="학습 유형 설정" items={[
                            { description: '공부 방식을 분류하는 태그입니다. 타이머 화면 상단에서 선택합니다.' },
                            { title: '순공 계산', description: '"자습"과 "테스트" 유형으로 기록된 세션만 순공 시간에 포함됩니다. 강의·수업 등은 총합에는 포함되지만 순공에서는 제외됩니다.' },
                            { title: '테스트 특수 기능', description: '"테스트" 유형 선택 시 카운트다운 타이머를 설정할 수 있습니다. 시험 시간을 미리 설정하고 시간 내에 문제를 풀 수 있습니다.' },
                            { title: '커스터마이즈', description: '원하는 유형명을 자유롭게 추가하되, 순공 집계가 필요하면 "자습"이나 "테스트"라는 단어를 포함시켜야 합니다.' },
                        ]} />
                    </div>
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
                    <div className="flex items-center gap-2 mb-2">
                        <label className="block text-sm font-medium">Gemini API Key</label>
                        <HelpButton title="Gemini AI 연동" items={[
                            { description: 'Google의 Gemini AI를 StudyMeter에 연결하여 AI 학습 도우미 기능을 사용할 수 있습니다.' },
                            { title: 'AI 학습 도우미', description: '"AI 도우미" 메뉴에서 공부 내용을 질문하거나, 학습 계획을 상담하거나, 개념 설명을 요청할 수 있습니다.' },
                            { title: 'API 키 발급', description: 'Google AI Studio(aistudio.google.com)에서 무료로 발급받을 수 있습니다. 키는 기기에만 저장되며 외부 서버로 전송되지 않습니다.' },
                        ]} />
                    </div>
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
                        disabled={geminiModels.length === 0}
                        className="w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] disabled:opacity-50"
                    >
                        {geminiModels.length === 0 ? (
                            <option value="">
                                {loadingModels ? '모델 목록 불러오는 중…' : 'API 키를 입력하면 모델 목록이 표시됩니다'}
                            </option>
                        ) : (
                            geminiModels.map((model) => (
                                <option key={model.name} value={model.name}>
                                    {model.displayName}{model.description ? ` — ${model.description}` : ''}
                                </option>
                            ))
                        )}
                    </select>
                    {modelsError && (
                        <p className="text-xs text-red-400 mt-2">{modelsError}</p>
                    )}
                    {geminiModels.length > 0 && (
                        <p className="text-[10px] text-[var(--color-text-secondary)] opacity-50 mt-2">
                            API 에서 불러온 {geminiModels.length}개 모델 · 키마다 사용 가능 목록이 다를 수 있습니다
                        </p>
                    )}
                </div>

                {/* 태블릿 자체 측정 설정 */}
                <div className="glass-card p-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium">태블릿 자체 측정</label>
                            <HelpButton title="집중도 측정 — 태블릿" items={[
                                { description: 'Android 앱에서 전면 카메라를 이용해 얼굴·시선·생체신호를 분석하고 실시간 집중 점수를 측정합니다.' },
                                { title: '시선 캘리브레이션', description: '9개 지점을 응시하면 시선 추적이 개인화됩니다. 책 모드(하향 시선)와 모니터 모드(정면 시선) 중 환경에 맞게 선택하세요.' },
                                { title: '점수 개인화', description: '세션 종료 후 별점 평가를 여러 번 하면 나의 집중 패턴에 맞게 점수 기준이 조정됩니다.' },
                                { title: '웹 버전', description: '앱이 아닌 브라우저에서도 웹캠을 통해 간략한 집중도 측정을 사용할 수 있습니다.' },
                            ]} />
                        </div>
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
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium">PC Focus 서버 연결</label>
                            <HelpButton title="PC Focus 서버 연결" items={[
                                { description: 'PC(노트북·데스크탑)의 웹캠을 이용해 집중도를 분석하는 별도 서버에 접속합니다.' },
                                { title: '사용 방법', description: 'PC에 Focus 분석 서버 프로그램을 실행하고, 같은 Wi-Fi에 연결된 상태에서 PC의 IP 주소를 입력하여 연결합니다.' },
                                { title: '언제 사용?', description: '태블릿을 책 받침으로 세워 두고 PC 카메라로 얼굴을 찍고 싶을 때, 또는 더 좋은 카메라 화질로 집중도를 측정하고 싶을 때 사용합니다.' },
                                { title: '캘리브레이션', description: '9개 지점을 순서대로 응시하며 캡처하면 시선 추적이 정교해집니다. 책/모니터 환경에 따라 모드를 선택하세요.' },
                            ]} />
                        </div>
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

                {/* 데이터 백업 / 복원 */}
                <div className="glass-card p-6 space-y-4">
                    <div className="flex items-center gap-2">
                        <Icon icon="mdi:database-arrow-down-outline" className="text-lg text-[var(--color-primary)]" />
                        <label className="text-sm font-medium">데이터 백업 / 복원</label>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                        모든 설정·공부 기록·일일 기록·메모를 하나의 JSON 파일로 저장합니다.
                        앱을 재설치하거나 기기를 바꿀 때 이 파일로 데이터를 그대로 옮길 수 있습니다.
                    </p>

                    <div className="flex gap-2">
                        <button
                            onClick={handleExportBackup}
                            disabled={exporting || importing}
                            className="flex-1 px-4 py-3 rounded-xl bg-indigo-500/10 text-indigo-400 font-medium text-sm hover:bg-indigo-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            <Icon icon="mdi:export-variant" className="text-base" />
                            {exporting ? '내보내는 중...' : '내보내기 (백업)'}
                        </button>
                        <button
                            onClick={() => backupInputRef.current?.click()}
                            disabled={exporting || importing}
                            className="flex-1 px-4 py-3 rounded-xl bg-green-500/10 text-green-400 font-medium text-sm hover:bg-green-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            <Icon icon="mdi:import" className="text-base" />
                            {importing ? '복원 중...' : '가져오기 (복원)'}
                        </button>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60 leading-relaxed">
                        ⚠️ 가져오기를 하면 현재 기기의 데이터가 백업 파일 내용으로 모두 교체됩니다.
                    </p>
                    <input
                        ref={backupInputRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={handleImportFile}
                        className="hidden"
                    />
                </div>

                {/* Save Button */}
                <button
                    onClick={handleSave}
                    className="w-full btn btn-primary text-lg py-4 flex items-center justify-center gap-2"
                >
                    {saved ? <><Icon icon="mdi:check-bold" className="text-xl" /> 저장됨!</> : '저장하기'}
                </button>

                {/* 개발자 & 버전 정보 */}
                <div className="mt-4 pt-8 border-t border-[var(--color-border)] flex flex-col gap-3">
                    <button
                        onClick={() => navigate('/developer')}
                        className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 hover:from-indigo-500/20 hover:via-purple-500/20 hover:to-pink-500/20 border border-indigo-400/25 hover:border-indigo-400/45 transition-all group"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0 ring-2 ring-indigo-400/20">
                                Y
                            </div>
                            <div className="text-left">
                                <p className="text-xs font-black text-[var(--color-text-secondary)] leading-tight">개발자 / Yoo Seung Hyeok</p>
                                <p className="text-sm font-bold gradient-text leading-tight">개발자 이야기 &amp; 개발자 도구 →</p>
                            </div>
                        </div>
                        <motion.span
                            animate={{ x: [0, 5, 0] }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                            className="flex-shrink-0"
                        >
                            <Icon icon="mdi:chevron-right" className="text-xl text-indigo-400 opacity-70 group-hover:opacity-100 transition-all" />
                        </motion.span>
                    </button>

                    {devAdmin && (
                        <button
                            onClick={() => navigate('/admin')}
                            className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white flex-shrink-0">
                                    <Icon icon="mdi:shield-crown" className="text-base" />
                                </div>
                                <p className="text-sm font-bold text-left">관리자 페이지</p>
                            </div>
                            <Icon icon="mdi:chevron-right" className="text-xl text-[var(--color-text-secondary)] opacity-50 group-hover:opacity-100 transition-all" />
                        </button>
                    )}

                    <div className="text-center flex flex-col items-center gap-0.5">
                        <p
                            onClick={handleVersionTap}
                            className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-50 cursor-default select-none"
                        >
                            StudyMeter v{__APP_VERSION__}
                        </p>
                        <p className="text-[10px] text-[var(--color-text-secondary)] font-mono opacity-30">
                            Build: {new Date(__BUILD_DATE__).toLocaleString('ko-KR', {
                                year: 'numeric', month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                            })}
                        </p>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {showDevAccess && (
                    <DevAccessModal
                        onClose={() => setShowDevAccess(false)}
                        onAuthed={() => {
                            setDevAdmin(true)
                            setShowDevAccess(false)
                            navigate('/admin')
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    )
}
