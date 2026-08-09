import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings, SubjectItem, AiRole, AiThinkingLevel, EvalTag, AiSystemPrompts, Dday } from '../lib/db'
import { db, getDefaultDdays, getTodayDate } from '../lib/db'
import { exportBackup, importBackup } from '../lib/backup'
import { useModal } from '../lib/ModalContext'
import { useFocusSync } from '../lib/focusSync'
import { useFocusNative } from '../lib/useFocusNative'
import { TabletCamera } from '../components/TabletCamera'
import { HelpButton } from '../components/HelpButton'
import DevAccessModal from '../components/DevAccessModal'
import { ChangelogHistoryModal } from '../components/ChangelogModal'
import { APP_VERSION } from '../lib/changelog'
import HaSettingsSection from '../components/HaSettingsSection'
import { isOwner } from '../lib/telemetry'
import { NativeBridge } from '../lib/NativeBridge'
import { fetchGeminiModels, type GeminiModel } from '../lib/gemini'
import { PROMPT_LABELS, DEFAULT_PROMPTS, getPrompt, type PromptKey } from '../lib/ai/prompts'
import { getModelList, isModelExhausted } from '../lib/ai/router'
import { getTodayUsage } from '../lib/ai/budget'
import { DEFAULT_EVAL_TAGS, TAG_CATEGORY_LABELS } from '../lib/tags'
import Pressable from '../components/ui/Pressable'
import Segmented from '../components/ui/Segmented'
import { SectionLabel, Row, Toggle } from '../components/ui/Section'
import { input, badge } from '../components/ui/styles'
import { spring, fadeRise, staggerContainer, staggerItem } from '../lib/motion'

/**
 * 섹션 헤더 — 라벨(+도움말) 왼쪽 · 액션 오른쪽.
 * 공용 SectionHeader 는 라벨에서 px-1.5/mb-2 를 떼어 내 정렬이 미세하게 달라지므로,
 * 픽셀을 그대로 두기 위해 이 화면의 조립 방식만 여기서 묶는다.
 */
function SectionHead({ label, help, action }: {
    label: React.ReactNode
    help?: React.ReactNode
    action?: React.ReactNode
}) {
    return (
        <div className="flex items-center justify-between px-1.5 mb-2">
            <div className="flex items-center gap-2">
                <SectionLabel>{label}</SectionLabel>
                {help}
            </div>
            {action}
        </div>
    )
}

// Tailwind 가 클래스명을 정적으로 스캔하므로 색 토큰은 조합하지 말고 통째로 적어 둔다.
const PILL_TONE = {
    indigo: 'bg-indigo-500/10 text-indigo-400',
    purple: 'bg-purple-500/10 text-purple-400',
    green: 'bg-green-500/10 text-green-400',
    red: 'bg-red-500/10 text-red-400',
} as const

/** 캘리브레이션·파이프라인·백업에서 반복되는 "아이콘 + 라벨" 액션 버튼 */
function ActionPill({ tone, icon, label, onClick, disabled }: {
    tone: keyof typeof PILL_TONE
    icon: string
    label: React.ReactNode
    onClick: () => void
    disabled?: boolean
}) {
    return (
        <Pressable
            onClick={onClick}
            disabled={disabled}
            className={`flex-1 px-4 py-3 rounded-xl ${PILL_TONE[tone]} font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
        >
            <Icon icon={icon} className="text-base" />
            {label}
        </Pressable>
    )
}

/** 테마를 문서에 적용한다. 'system' 이면 OS 설정을 따른다. */
function applyTheme(theme: 'light' | 'dark' | 'system') {
    const dark = theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : theme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
}

type ThinkingChoice = AiThinkingLevel | 'auto'

const ROLE_ROWS: Array<{ role: AiRole; label: string; autoLabel: string }> = [
    { role: 'deep', label: '심층 분석', autoLabel: '자동 (추천: gemini-flash-latest)' },
    { role: 'interactive', label: '대화·기록', autoLabel: '자동 (추천: gemini-flash-lite-latest)' },
    { role: 'ambient', label: '백그라운드 코멘트', autoLabel: '자동 (추천: Gemma 4 31B)' },
]

// 태블릿(네이티브)·PC Focus 양쪽에서 같은 두 버튼이 반복된다.
const CALIB_SCENARIOS = [
    { mode: 'book', tone: 'indigo', icon: 'mdi:book-open-outline', label: '책 캘리브레이션' },
    { mode: 'monitor', tone: 'purple', icon: 'mdi:monitor-outline', label: '모니터 캘리브레이션' },
] as const satisfies ReadonlyArray<{ mode: 'book' | 'monitor'; tone: keyof typeof PILL_TONE; icon: string; label: string }>

const TAG_CATEGORY_ORDER: EvalTag['category'][] = ['obstacle', 'condition', 'good', 'context', 'day']
const TAG_SCOPE_LABELS: Record<EvalTag['scope'], string> = { session: '세션', day: '하루', both: '양쪽' }

// 공용 `input` 토큰과 크기가 어긋나는 입력들. 폭·정렬만 호출부에서 덧붙인다.
const FIELD_BASE = 'bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]'
/** 목표 시간 · 졸음 기준의 큰 숫자 상자 */
const NUMBER_FIELD = `w-28 px-4 py-3 rounded-xl ${FIELD_BASE} text-center text-lg font-bold`
/** D-day 행 (이모지/제목/날짜가 폭만 다르다) */
const DDAY_FIELD = `py-2.5 rounded-lg ${FIELD_BASE}`
/** 커스텀 태그 추가 줄 */
const TAG_FIELD = `px-3 py-2 rounded-lg ${FIELD_BASE} text-sm`
/** 역할별 모델 오버라이드 (select 와 fallback input 이 같은 모양) */
const ROLE_FIELD = `w-full px-4 py-2.5 rounded-xl ${FIELD_BASE} text-sm`

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
    const [ddays, setDdays] = useState<Dday[]>(settings.ddays ?? getDefaultDdays())
    const [saved, setSaved] = useState(false)
    const [geminiModels, setGeminiModels] = useState<GeminiModel[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const [modelsError, setModelsError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const backupInputRef = useRef<HTMLInputElement>(null)
    const [exporting, setExporting] = useState(false)
    const [importing, setImporting] = useState(false)

    // ── AI 통합 설정 ──────────────────────────────────────────────────────────
    const [advancedMode, setAdvancedMode] = useState(!!settings.advancedMode)
    const [aiAmbientEnabled, setAiAmbientEnabled] = useState(settings.aiAmbientEnabled ?? true)
    const [morningReportEnabled, setMorningReportEnabled] = useState(settings.morningReportEnabled ?? true)
    const [endSignalEnabled, setEndSignalEnabled] = useState(settings.endSignalEnabled ?? true)
    const [aiRoleModels, setAiRoleModels] = useState<Partial<Record<AiRole, string>>>(settings.aiRoleModels ?? {})
    const [aiGroundingDefault, setAiGroundingDefault] = useState(settings.aiGroundingDefault !== false)
    const [aiThinkingLevels, setAiThinkingLevels] = useState<Partial<Record<AiRole, AiThinkingLevel>>>(settings.aiThinkingLevels ?? {})
    const [aiSystemPromptsState, setAiSystemPromptsState] = useState<Record<PromptKey, string>>(() => {
        const init = {} as Record<PromptKey, string>
        for (const key of Object.keys(PROMPT_LABELS) as PromptKey[]) {
            init[key] = getPrompt(settings, key)
        }
        return init
    })
    const [roleModelList, setRoleModelList] = useState<GeminiModel[]>([])
    const [loadingRoleModels, setLoadingRoleModels] = useState(false)

    // ── 평가 태그 관리 ────────────────────────────────────────────────────────
    const [evalTagsState, setEvalTagsState] = useState<EvalTag[]>(() =>
        settings.evalTags && settings.evalTags.length > 0
            ? settings.evalTags.map(t => ({ ...t }))
            : DEFAULT_EVAL_TAGS.map(t => ({ ...t }))
    )
    const [evalTagsDirty, setEvalTagsDirty] = useState(false)
    const [newTagName, setNewTagName] = useState('')
    const [newTagCategory, setNewTagCategory] = useState<EvalTag['category']>('obstacle')
    const [newTagScope, setNewTagScope] = useState<EvalTag['scope']>('both')

    // 숨겨진 개발자 진입: 버전명 5회 탭
    const [showDevAccess, setShowDevAccess] = useState(false)
    const [showChangelog, setShowChangelog] = useState(false)
    const [devAdmin, setDevAdmin] = useState(isOwner())
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

    // 역할별 모델 오버라이드용 목록 (라우터의 캐시를 그대로 사용/예열)
    useEffect(() => {
        if (!geminiApiKey || geminiApiKey.length < 10) {
            setRoleModelList([])
            return
        }
        let cancelled = false
        setLoadingRoleModels(true)
        getModelList(geminiApiKey)
            .then((models) => { if (!cancelled) setRoleModelList(models) })
            .finally(() => { if (!cancelled) setLoadingRoleModels(false) })
        return () => { cancelled = true }
    }, [geminiApiKey])

    /** 설정 한 조각을 저장하고 상위 상태에 즉시 반영한다. */
    const patch = useCallback((fields: Partial<Settings>) => {
        if (settings.id != null) db.settings.update(settings.id, fields)
        onSettingsChange({ ...settings, ...fields })
    }, [settings, onSettingsChange])

    // 고급 모드 / 앰비언트 AI / 아침 리포트 토글은 즉시 저장 (테마 토글과 동일한 패턴)
    const handleToggleAdvancedMode = () => {
        const next = !advancedMode
        setAdvancedMode(next)
        // Study 탭의 졸음·자세 상세 지표도 같은 스위치로 통합 (구 개발자 도구 토글)
        localStorage.setItem('sm_advanced_features', next ? 'true' : 'false')
        patch({ advancedMode: next })
    }

    const handleToggleAmbient = () => {
        setAiAmbientEnabled(!aiAmbientEnabled)
        patch({ aiAmbientEnabled: !aiAmbientEnabled })
    }

    const handleToggleMorningReport = () => {
        setMorningReportEnabled(!morningReportEnabled)
        patch({ morningReportEnabled: !morningReportEnabled })
    }

    const handleToggleEndSignal = () => {
        const next = !endSignalEnabled
        setEndSignalEnabled(next)
        patch({ endSignalEnabled: next })
        NativeBridge.setEndSignalEnabled(next)
    }

    const handleToggleGrounding = () => {
        setAiGroundingDefault(!aiGroundingDefault)
        patch({ aiGroundingDefault: !aiGroundingDefault })
    }

    // ── 평가 태그 관리 핸들러 ────────────────────────────────────────────────
    const handleToggleTagHidden = (idx: number) => {
        setEvalTagsState(prev => {
            const next = [...prev]
            next[idx] = { ...next[idx], hidden: !next[idx].hidden }
            return next
        })
        setEvalTagsDirty(true)
    }

    const handleRemoveCustomTag = async (idx: number) => {
        const tag = evalTagsState[idx]
        const confirmed = await showConfirm('태그 삭제', `'${tag.name}' 태그를 삭제하시겠습니까?`)
        if (!confirmed) return
        setEvalTagsState(prev => prev.filter((_, i) => i !== idx))
        setEvalTagsDirty(true)
    }

    const handleAddTag = () => {
        const name = newTagName.trim()
        if (!name) return
        setEvalTagsState(prev => [...prev, { name, category: newTagCategory, scope: newTagScope, custom: true }])
        setEvalTagsDirty(true)
        setNewTagName('')
    }

    const handleRestoreDefaultTags = () => {
        setEvalTagsState(prev => prev.map(t => t.custom ? t : { ...t, hidden: false }))
        setEvalTagsDirty(true)
    }

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
            patch({ profilePicture: base64 })  // 저장 버튼을 기다리지 않고 즉시 반영
        }
        reader.readAsDataURL(file)
    }

    const handleRemoveProfilePicture = () => {
        setProfilePicture('')
        patch({ profilePicture: undefined })
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

    // ── D-day 관리 ────────────────────────────────────────────────────────────
    const handleAddDday = () => {
        const id = `dday-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
        setDdays(prev => [...prev, { id, label: '', date: getTodayDate(), emoji: '📌' }])
    }

    const handleRemoveDday = async (idx: number) => {
        const confirmed = await showConfirm('D-day 삭제', `'${ddays[idx].label || '제목 없음'}' 항목을 삭제하시겠습니까?`)
        if (!confirmed) return
        setDdays(prev => prev.filter((_, i) => i !== idx))
    }

    const handleDdayChange = (idx: number, patch: Partial<Dday>) => {
        setDdays(prev => {
            const next = [...prev]
            next[idx] = { ...next[idx], ...patch }
            return next
        })
    }

    const handleSave = async () => {
        const goalHours = parseFloat(dailyGoalHours)
        const drowsySec = parseInt(drowsinessSec, 10)

        // 역할별 모델 오버라이드: 빈 값은 저장하지 않는다 (= 자동)
        const roleModelOverrides: Partial<Record<AiRole, string>> = Object.fromEntries(
            ROLE_ROWS
                .map(({ role }) => [role, (aiRoleModels[role] || '').trim()] as const)
                .filter(([, v]) => v)
        )

        // 시스템 프롬프트: 기본값과 동일하거나 공백이면 저장하지 않는다 (= 기본값 사용)
        const promptOverrides: AiSystemPrompts = Object.fromEntries(
            (Object.keys(PROMPT_LABELS) as PromptKey[])
                .map((key) => [key, (aiSystemPromptsState[key] || '').trim()] as const)
                .filter(([key, val]) => val && val !== DEFAULT_PROMPTS[key].trim())
        )

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
            drowsinessThresholdSec: (!isNaN(drowsySec) && drowsySec > 0) ? Math.min(120, Math.max(3, drowsySec)) : 15,
            advancedMode,
            aiAmbientEnabled,
            morningReportEnabled,
            aiGroundingDefault,
            aiThinkingLevels: Object.keys(aiThinkingLevels).length > 0 ? aiThinkingLevels : undefined,
            aiRoleModels: Object.keys(roleModelOverrides).length > 0 ? roleModelOverrides : undefined,
            aiSystemPrompts: Object.keys(promptOverrides).length > 0 ? promptOverrides : undefined,
            evalTags: evalTagsDirty ? evalTagsState : settings.evalTags,
            ddays: ddays.filter(d => d.label.trim() && d.date),
        }

        await db.settings.put(newSettings)
        onSettingsChange(newSettings)
        applyTheme(theme)

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
        <motion.div
            className="max-w-2xl mx-auto"
            initial="initial"
            animate="animate"
            variants={staggerContainer}
        >
            <motion.h1 variants={staggerItem} className="text-3xl font-bold gradient-text text-display mb-8">설정</motion.h1>

            <div className="space-y-6">
                {/* 프로필 */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>프로필</SectionLabel>
                    <div className="glass-card overflow-hidden">
                        <Row first>
                            <div className="flex items-center gap-4">
                                {profilePicture ? (
                                    <img
                                        src={profilePicture}
                                        alt="프로필"
                                        className="w-16 h-16 rounded-full object-cover shadow-lg border-4 border-[var(--color-primary)]"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                                        {userName.charAt(0)}
                                    </div>
                                )}
                                <div className="flex flex-col gap-1.5">
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleProfilePictureChange}
                                        className="hidden"
                                    />
                                    <div className="flex gap-2">
                                        <Pressable
                                            onClick={() => fileInputRef.current?.click()}
                                            className="px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white font-medium text-xs flex items-center gap-1.5"
                                        >
                                            <Icon icon="mdi:camera-outline" className="text-sm" /> 사진 변경
                                        </Pressable>
                                        {profilePicture && (
                                            <Pressable
                                                onClick={handleRemoveProfilePicture}
                                                className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-500 font-medium text-xs flex items-center gap-1.5"
                                            >
                                                <Icon icon="mdi:trash-can-outline" className="text-sm" /> 삭제
                                            </Pressable>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-70">최대 500KB</p>
                                </div>
                            </div>
                        </Row>
                        <Row>
                            <label className="text-sm font-medium text-[var(--color-text)] whitespace-nowrap">사용자 이름</label>
                            <input
                                type="text"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                className="flex-1 max-w-[60%] px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] text-right"
                            />
                        </Row>
                    </div>
                </motion.div>

                {/* 학습 목표 */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>학습 목표</SectionLabel>
                    <div className="glass-card overflow-hidden">
                        <div className="px-5 py-4">
                            <div className="flex items-center gap-2 mb-1">
                                <label className="block text-sm font-medium text-[var(--color-text)]">일일 목표 시간</label>
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
                                    className={NUMBER_FIELD}
                                />
                                <span className="text-[var(--color-text-secondary)] font-medium">시간</span>
                                {dailyGoalHours && (
                                    <span className="text-xs text-purple-400 font-bold ml-2">
                                        = {parseFloat(dailyGoalHours) * 60}분 목표
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="px-5 py-4 border-t border-[var(--color-border)]">
                            <div className="flex items-center gap-2 mb-1">
                                <label className="block text-sm font-medium text-[var(--color-text)]">졸음 감지 기준</label>
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
                                    className={NUMBER_FIELD}
                                />
                                <span className="text-[var(--color-text-secondary)] font-medium">초 이상 지속 시</span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* D-day 관리 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="D-day"
                        help={<HelpButton title="D-day" items={[
                            { description: '수능·모의고사·시험 등 목표일까지 남은 날짜를 홈 화면 상단에 항상 보여줍니다.' },
                            { title: '개수 제한 없음', description: '기본 3개(수능·모의평가·기말고사)가 채워져 있지만, 자유롭게 추가·수정·삭제할 수 있습니다.' },
                            { title: '이모지', description: '항목을 구분하기 쉽도록 이모지를 하나 붙일 수 있습니다. (선택)' },
                        ]} />}
                        action={<Pressable
                            onClick={handleAddDday}
                            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold"
                        >
                            + D-day 추가
                        </Pressable>}
                    />

                    <div className="glass-card p-6 space-y-3">
                        {ddays.length === 0 && (
                            <p className="text-xs text-[var(--color-text-secondary)] opacity-50 italic text-center py-2">
                                등록된 D-day가 없습니다. 위 버튼으로 추가해 보세요.
                            </p>
                        )}
                        {ddays.map((d, idx) => (
                            <div key={d.id} className="glass-card-elevated p-4 flex flex-wrap items-center gap-2.5">
                                <input
                                    type="text"
                                    value={d.emoji ?? ''}
                                    onChange={(e) => handleDdayChange(idx, { emoji: e.target.value })}
                                    placeholder="🎯"
                                    maxLength={4}
                                    className={`w-12 px-2 ${DDAY_FIELD} text-center text-lg`}
                                />
                                <input
                                    type="text"
                                    value={d.label}
                                    onChange={(e) => handleDdayChange(idx, { label: e.target.value })}
                                    placeholder="예: 수능"
                                    className={`flex-1 min-w-[7rem] px-3 ${DDAY_FIELD} text-sm font-medium`}
                                />
                                <input
                                    type="date"
                                    value={d.date}
                                    onChange={(e) => handleDdayChange(idx, { date: e.target.value })}
                                    className={`px-3 ${DDAY_FIELD} text-sm`}
                                />
                                <Pressable
                                    onClick={() => handleRemoveDday(idx)}
                                    pressScale={0.94}
                                    className="text-[10px] px-2.5 py-2 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center gap-1"
                                >
                                    <Icon icon="mdi:trash-can-outline" className="text-sm" /> 삭제
                                </Pressable>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* 과목 및 하위 항목 관리 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="과목 및 하위 항목"
                        help={<HelpButton title="과목 및 하위 항목" items={[
                            { description: '공부하는 과목 목록을 관리합니다. 공부 시작 시 과목을 선택하면 통계가 과목별로 집계됩니다.' },
                            { title: '하위 항목', description: '과목에 세부 분류를 추가할 수 있습니다. 예: 수학 > 미분, 적분 / 영어 > 문법, 독해. 타이머 화면에서 선택하면 더 세밀하게 시간을 관리할 수 있습니다.' },
                            { title: '삭제 주의', description: '과목을 삭제해도 기존 기록은 유지됩니다. 하지만 새로운 세션에서는 해당 과목을 선택할 수 없게 됩니다.' },
                        ]} />}
                        action={<Pressable
                            onClick={handleAddSubject}
                            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold"
                        >
                            + 과목 추가
                        </Pressable>}
                    />

                    <div className="glass-card p-6 space-y-4">
                        {localSubjects.map((subject, sIdx) => (
                            <div key={sIdx} className="glass-card-elevated p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="font-bold text-indigo-400">{subject.name}</span>
                                    <div className="flex items-center gap-2">
                                        <Pressable
                                            onClick={() => handleAddSubItem(sIdx)}
                                            pressScale={0.94}
                                            className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10"
                                        >
                                            + 하위 항목
                                        </Pressable>
                                        <Pressable
                                            onClick={() => handleRemoveSubject(sIdx)}
                                            pressScale={0.94}
                                            className="text-[10px] px-2 py-1 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20"
                                        >
                                            삭제
                                        </Pressable>
                                    </div>
                                </div>

                                {subject.children && subject.children.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {subject.children.map((child, cIdx) => (
                                            <div key={cIdx} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/10 text-indigo-300 text-xs font-medium border border-indigo-500/20">
                                                <span>{child}</span>
                                                <Pressable
                                                    onClick={() => handleRemoveSubItem(sIdx, cIdx)}
                                                    pressScale={0.85}
                                                    className="opacity-40 hover:opacity-100 flex items-center justify-center p-0.5"
                                                >
                                                    <Icon icon="mdi:close" className="text-sm" />
                                                </Pressable>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-50 italic">하위 항목이 없습니다.</p>
                                )}
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* 학습 유형 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="학습 유형 (쉼표로 구분)"
                        help={<HelpButton title="학습 유형 설정" items={[
                            { description: '공부 방식을 분류하는 태그입니다. 타이머 화면 상단에서 선택합니다.' },
                            { title: '순공 계산', description: '"자습"과 "테스트" 유형으로 기록된 세션만 순공 시간에 포함됩니다. 강의·수업 등은 총합에는 포함되지만 순공에서는 제외됩니다.' },
                            { title: '테스트 특수 기능', description: '"테스트" 유형 선택 시 카운트다운 타이머를 설정할 수 있습니다. 시험 시간을 미리 설정하고 시간 내에 문제를 풀 수 있습니다.' },
                            { title: '커스터마이즈', description: '원하는 유형명을 자유롭게 추가하되, 순공 집계가 필요하면 "자습"이나 "테스트"라는 단어를 포함시켜야 합니다.' },
                        ]} />}
                    />
                    <div className="glass-card p-6">
                        <input
                            type="text"
                            value={types}
                            onChange={(e) => setTypes(e.target.value)}
                            placeholder="자습, 수업, 테스트, ..."
                            className={input}
                        />
                    </div>
                </motion.div>

                {/* 테마 */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>테마</SectionLabel>
                    <div className="glass-card p-4">
                        <Segmented
                            layoutId="theme-picker"
                            value={theme}
                            onChange={(t) => {
                                setTheme(t)
                                applyTheme(t)   // 저장 버튼을 누르기 전에도 바로 보이도록
                                patch({ theme: t })
                            }}
                            options={[
                                { value: 'light', label: <><Icon icon="mdi:white-balance-sunny" className="text-base" /> 라이트</> },
                                { value: 'dark', label: <><Icon icon="mdi:weather-night" className="text-base" /> 다크</> },
                                { value: 'system', label: <><Icon icon="mdi:remote-desktop" className="text-base" /> 시스템</> },
                            ]}
                        />
                    </div>
                </motion.div>

                {/* 홈 어시스턴트 */}
                <HaSettingsSection settings={settings} onSettingsChange={onSettingsChange} />

                {/* Gemini AI */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>Gemini AI</SectionLabel>
                    <div className="glass-card overflow-hidden">
                        <div className="px-5 py-4">
                            <div className="flex items-center gap-2 mb-2">
                                <label className="block text-sm font-medium text-[var(--color-text)]">API Key</label>
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
                                className={input}
                            />
                            <p className="text-sm text-[var(--color-text-secondary)] mt-2">
                                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] hover:underline">
                                    Google AI Studio에서 API 키 발급받기 →
                                </a>
                            </p>
                        </div>

                        <div className="px-5 py-4 border-t border-[var(--color-border)]">
                            <div className="flex items-center justify-between mb-3">
                                <label className="text-sm font-medium text-[var(--color-text)]">모델 설정</label>
                                {loadingModels && <span className="text-[10px] text-[var(--color-text-secondary)] animate-pulse">동기화 중...</span>}
                            </div>

                            <select
                                value={geminiModel}
                                onChange={(e) => setGeminiModel(e.target.value)}
                                disabled={geminiModels.length === 0}
                                className={`${input} disabled:opacity-50`}
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

                            {/* 선택한 모델의 능력치 (API 제공 + 추정) */}
                            {(() => {
                                const m = geminiModels.find((x) => x.name === geminiModel)
                                if (!m) return null
                                return (
                                    <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            {m.supportsThinking && (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-purple-500/15 text-purple-400 border border-purple-400/20 flex items-center gap-1">
                                                    <Icon icon="mdi:brain" className="text-xs" /> 단계적 추론 (Thinking)
                                                </span>
                                            )}
                                            {m.supportsGrounding && (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-400/20 flex items-center gap-1">
                                                    <Icon icon="mdi:google" className="text-xs" /> Google 검색 그라운딩
                                                </span>
                                            )}
                                            {m.version && (
                                                <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-white/5 text-[var(--color-text-secondary)]">
                                                    v{m.version}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-secondary)] opacity-70">
                                            {m.inputTokenLimit != null && (
                                                <span>입력 한도: {m.inputTokenLimit.toLocaleString()} 토큰</span>
                                            )}
                                            {m.outputTokenLimit != null && (
                                                <span>출력 한도: {m.outputTokenLimit.toLocaleString()} 토큰</span>
                                            )}
                                            {m.temperature != null && (
                                                <span>기본 온도: {m.temperature}{m.maxTemperature != null ? ` (최대 ${m.maxTemperature})` : ''}</span>
                                            )}
                                        </div>
                                        {m.description && (
                                            <p className="text-[10px] text-[var(--color-text-secondary)] opacity-60 leading-relaxed">
                                                {m.description}
                                            </p>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </motion.div>

                {/* AI 동작 */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>AI 동작</SectionLabel>
                    <div className="glass-card overflow-hidden">
                        <Row first>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-[var(--color-text)]">고급 모드</label>
                                    <HelpButton title="고급 모드" items={[
                                        { description: '역할별 AI 모델 오버라이드, 시스템 프롬프트 편집, AI 사용량 표시를 노출하고, Study 탭에 졸음·자세 상세 지표를 표시합니다.' },
                                        { title: '누구를 위한 기능?', description: '기본값만으로도 충분히 잘 동작합니다. 세부적으로 모델을 고르거나 프롬프트를 튜닝하고 싶을 때만 켜세요.' },
                                    ]} />
                                </div>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">역할별 모델·프롬프트 편집 + 졸음·자세 상세 지표</p>
                            </div>
                            <Toggle enabled={advancedMode} onChange={handleToggleAdvancedMode} />
                        </Row>

                        <Row>
                            <div className="flex-1 min-w-0">
                                <label className="text-sm font-medium text-[var(--color-text)]">앰비언트 AI</label>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">아침 리포트·일기 답장·세션 코멘트를 자동 생성합니다.</p>
                            </div>
                            <Toggle enabled={aiAmbientEnabled} onChange={handleToggleAmbient} />
                        </Row>

                        <Row>
                            <div className="flex-1 min-w-0">
                                <label className="text-sm font-medium text-[var(--color-text)]">아침 리포트</label>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">그날 처음 앱을 열 때 홈 화면에 어제·주간 분석을 자동으로 준비합니다. (백그라운드 실행·알림 없음)</p>
                            </div>
                            <Toggle enabled={morningReportEnabled} onChange={handleToggleMorningReport} />
                        </Row>

                        {NativeBridge.isNative() && (
                            <Row>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <label className="text-sm font-medium text-[var(--color-text)]">세션 종료 알림</label>
                                        <HelpButton title="세션 종료 알림" items={[
                                            { description: '공부를 끝내면 "공부 세션 종료 · 세션 1:12:30 · 오늘 4:05:12" 알림이 한 번 뜹니다. 무음이고 10초 뒤 저절로 사라집니다.' },
                                            { title: '자동화에 쓰기', description: 'Tasker·MacroDroid 같은 도구에서 "공부 세션 종료"라는 단어가 포함된 알림을 조건으로 걸면, 세션이 끝나는 순간 앱 차단을 풀거나 다른 동작을 이어붙일 수 있습니다.' },
                                        ]} />
                                    </div>
                                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">세션이 끝날 때 오늘 누적을 한 줄로 알려줍니다. (무음 · 10초 후 자동 사라짐)</p>
                                </div>
                                <Toggle enabled={endSignalEnabled} onChange={handleToggleEndSignal} />
                            </Row>
                        )}

                        <Row>
                            <div className="flex-1 min-w-0">
                                <label className="text-sm font-medium text-[var(--color-text)]">웹 검색(Google 그라운딩)</label>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-1">AI가 최신 정보를 Google 검색으로 근거 삼아 답합니다. (지원하는 모델에서만 자동 적용)</p>
                            </div>
                            <Toggle enabled={aiGroundingDefault} onChange={handleToggleGrounding} />
                        </Row>
                    </div>
                </motion.div>

                {/* 고급 모드 전용 섹션들 — opacity/y 로 부드럽게 펼침/접힘 */}
                <AnimatePresence initial={false}>
                    {advancedMode && (
                        <motion.div
                            key="advanced-sections"
                            variants={fadeRise}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            className="space-y-6"
                        >
                            {/* 역할별 모델 오버라이드 */}
                            <div>
                                <SectionLabel>역할별 AI 설정</SectionLabel>
                                <div className="glass-card p-6 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-[var(--color-text)]">역할별 모델 오버라이드</label>
                                        {loadingRoleModels && <span className="text-[10px] text-[var(--color-text-secondary)] animate-pulse">동기화 중...</span>}
                                    </div>
                                    <p className="text-xs text-[var(--color-text-secondary)]">비워두면 역할에 맞는 모델이 자동으로 선택됩니다.</p>

                                    {ROLE_ROWS.map(({ role, label, autoLabel }) => (
                                        <div key={role} className="space-y-2">
                                            <p className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</p>
                                            {roleModelList.length > 0 ? (
                                                <select
                                                    value={aiRoleModels[role] || ''}
                                                    onChange={(e) => setAiRoleModels(prev => ({ ...prev, [role]: e.target.value }))}
                                                    className={ROLE_FIELD}
                                                >
                                                    <option value="">{autoLabel}</option>
                                                    {roleModelList.map((m) => (
                                                        <option key={m.name} value={m.name}>
                                                            {m.displayName}{isModelExhausted(m.name) ? ' · 오늘 소진' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={aiRoleModels[role] || ''}
                                                    onChange={(e) => setAiRoleModels(prev => ({ ...prev, [role]: e.target.value }))}
                                                    placeholder={autoLabel}
                                                    className={`${ROLE_FIELD} font-mono`}
                                                />
                                            )}
                                            {/* 역할별 추론(thinking) 강도 — segmented control */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap">추론 강도</span>
                                                <div className="flex-1">
                                                    <Segmented<ThinkingChoice>
                                                        layoutId={`thinking-${role}`}
                                                        size="sm"
                                                        value={(aiThinkingLevels[role] ?? 'auto') as ThinkingChoice}
                                                        onChange={(v) => {
                                                            if (v === 'auto') {
                                                                setAiThinkingLevels(prev => { const n = { ...prev }; delete n[role]; return n })
                                                            } else {
                                                                setAiThinkingLevels(prev => ({ ...prev, [role]: v }))
                                                            }
                                                        }}
                                                        options={[
                                                            { value: 'off', label: '끔' },
                                                            { value: 'low', label: '낮음' },
                                                            { value: 'medium', label: '중간' },
                                                            { value: 'high', label: '높음' },
                                                            { value: 'auto', label: '자동' },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-70">추론 강도: 높을수록 답변 품질↑·속도↓. Gemini 3 계열은 낮음/중간/높음, 2.5 계열은 예산으로 자동 변환됩니다.</p>
                                </div>
                            </div>

                            {/* 오늘 AI 사용량 */}
                            {(() => {
                                const usage = getTodayUsage()
                                const kindEntries = Object.entries(usage.byKind)
                                const modelEntries = Object.entries(usage.byModel)
                                return (
                                    <div>
                                        <SectionLabel>AI 사용량</SectionLabel>
                                        <div className="glass-card p-6 space-y-3">
                                            <label className="text-sm font-medium text-[var(--color-text)]">오늘 AI 사용량</label>
                                            {kindEntries.length === 0 && modelEntries.length === 0 ? (
                                                <p className="text-xs text-[var(--color-text-secondary)]">오늘 아직 AI 호출 기록이 없습니다.</p>
                                            ) : (
                                                <>
                                                    {kindEntries.length > 0 && (
                                                        <div>
                                                            <p className="text-[10px] text-[var(--color-text-secondary)] mb-1.5 opacity-70">기능별</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {kindEntries.map(([kind, count]) => (
                                                                    <span key={kind} className={badge}>
                                                                        {kind} × {count}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {modelEntries.length > 0 && (
                                                        <div>
                                                            <p className="text-[10px] text-[var(--color-text-secondary)] mb-1.5 opacity-70">모델별</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {modelEntries.map(([model, count]) => (
                                                                    <span key={model} className="text-[10px] font-medium px-2 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-400/20 font-mono">
                                                                        {model} × {count}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )
                            })()}

                            {/* 시스템 프롬프트 편집 */}
                            <div>
                                <SectionHead
                                    label="시스템 프롬프트"
                                    help={<HelpButton title="시스템 프롬프트 편집" items={[
                                        { description: 'AI 기능별로 실제 전달되는 시스템 지시문을 직접 확인하고 수정할 수 있습니다.' },
                                        { title: '공통 페르소나', description: '모든 AI 기능 앞에 항상 붙는 공통 말투 지시입니다.' },
                                        { title: '기본값 복원', description: '수정한 내용을 앱 기본 프롬프트로 되돌립니다. 비워두거나 기본값과 같으면 저장 시 자동으로 기본값을 사용합니다.' },
                                    ]} />}
                                />
                                <div className="glass-card p-6 space-y-3">
                                    {(Object.keys(PROMPT_LABELS) as PromptKey[]).map((key) => {
                                        const current = aiSystemPromptsState[key] ?? ''
                                        const isModified = current.trim() !== DEFAULT_PROMPTS[key].trim()
                                        return (
                                            <details key={key} className="glass-card-elevated p-3">
                                                <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)] flex items-center gap-2 select-none">
                                                    {isModified && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
                                                    {PROMPT_LABELS[key]}
                                                </summary>
                                                <textarea
                                                    value={current}
                                                    onChange={(e) => setAiSystemPromptsState(prev => ({ ...prev, [key]: e.target.value }))}
                                                    rows={6}
                                                    className="w-full mt-3 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                                                />
                                                <div className="flex justify-end mt-2">
                                                    <Pressable
                                                        onClick={() => setAiSystemPromptsState(prev => ({ ...prev, [key]: DEFAULT_PROMPTS[key] }))}
                                                        pressScale={0.94}
                                                        className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10"
                                                    >
                                                        기본값 복원
                                                    </Pressable>
                                                </div>
                                            </details>
                                        )
                                    })}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* 평가 태그 관리 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="평가 태그 관리"
                        help={<HelpButton title="평가 태그 관리" items={[
                            { description: '세션 평가와 하루 일기에서 선택하는 태그 목록입니다. 필요 없는 태그는 숨기고, 원하는 태그를 직접 추가할 수 있습니다.' },
                            { title: '숨기기', description: '기본 태그는 삭제할 수 없지만 숨겨서 목록에서 보이지 않게 할 수 있습니다.' },
                            { title: '커스텀 태그', description: '직접 추가한 태그는 삭제할 수 있습니다.' },
                        ]} />}
                        action={<Pressable
                            onClick={handleRestoreDefaultTags}
                            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 font-bold"
                        >
                            기본 태그 복원
                        </Pressable>}
                    />

                    <div className="glass-card p-6 space-y-4">
                        <div className="space-y-4">
                            {TAG_CATEGORY_ORDER.map((cat) => {
                                const rows = evalTagsState
                                    .map((tag, idx) => ({ tag, idx }))
                                    .filter(({ tag }) => tag.category === cat)
                                if (rows.length === 0) return null
                                return (
                                    <div key={cat}>
                                        <p className="text-[10px] font-bold text-[var(--color-text-secondary)] opacity-70 mb-1.5">{TAG_CATEGORY_LABELS[cat]}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {rows.map(({ tag, idx }) => (
                                                <div
                                                    key={`${tag.name}-${idx}`}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${tag.hidden
                                                        ? 'bg-white/5 text-[var(--color-text-secondary)] border-white/5 opacity-50'
                                                        : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                                                        }`}
                                                >
                                                    <span>{tag.name}</span>
                                                    {tag.custom && (
                                                        <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 opacity-70">커스텀</span>
                                                    )}
                                                    <Pressable
                                                        onClick={() => handleToggleTagHidden(idx)}
                                                        pressScale={0.85}
                                                        className="opacity-60 hover:opacity-100 flex items-center justify-center p-0.5"
                                                        title={tag.hidden ? '보이기' : '숨기기'}
                                                    >
                                                        <Icon icon={tag.hidden ? 'mdi:eye-off-outline' : 'mdi:eye-outline'} className="text-sm" />
                                                    </Pressable>
                                                    {tag.custom && (
                                                        <Pressable
                                                            onClick={() => handleRemoveCustomTag(idx)}
                                                            pressScale={0.85}
                                                            className="opacity-60 hover:opacity-100 flex items-center justify-center p-0.5"
                                                            title="삭제"
                                                        >
                                                            <Icon icon="mdi:close" className="text-sm" />
                                                        </Pressable>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="pt-3 border-t border-[var(--color-border)] space-y-2">
                            <p className="text-xs font-medium text-[var(--color-text-secondary)]">커스텀 태그 추가</p>
                            <div className="flex flex-wrap gap-2">
                                <input
                                    type="text"
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    placeholder="태그 이름"
                                    className={`flex-1 min-w-[120px] ${TAG_FIELD}`}
                                />
                                <select
                                    value={newTagCategory}
                                    onChange={(e) => setNewTagCategory(e.target.value as EvalTag['category'])}
                                    className={TAG_FIELD}
                                >
                                    {TAG_CATEGORY_ORDER.map((cat) => (
                                        <option key={cat} value={cat}>{TAG_CATEGORY_LABELS[cat]}</option>
                                    ))}
                                </select>
                                <select
                                    value={newTagScope}
                                    onChange={(e) => setNewTagScope(e.target.value as EvalTag['scope'])}
                                    className={TAG_FIELD}
                                >
                                    {(Object.keys(TAG_SCOPE_LABELS) as Array<EvalTag['scope']>).map((scope) => (
                                        <option key={scope} value={scope}>{TAG_SCOPE_LABELS[scope]}</option>
                                    ))}
                                </select>
                                <Pressable
                                    onClick={handleAddTag}
                                    disabled={!newTagName.trim()}
                                    className="px-4 py-2 rounded-lg bg-indigo-500/10 text-indigo-400 font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    + 추가
                                </Pressable>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 태블릿 자체 측정 설정 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="집중도 측정 — 태블릿"
                        help={<HelpButton title="집중도 측정 — 태블릿" items={[
                            { description: 'Android 앱에서 전면 카메라를 이용해 얼굴·시선·생체신호를 분석하고 실시간 집중 점수를 측정합니다.' },
                            { title: '시선 캘리브레이션', description: '9개 지점을 응시하면 시선 추적이 개인화됩니다. 책 모드(하향 시선)와 모니터 모드(정면 시선) 중 환경에 맞게 선택하세요.' },
                            { title: '점수 개인화', description: '세션 종료 후 별점 평가를 여러 번 하면 나의 집중 패턴에 맞게 점수 기준이 조정됩니다.' },
                            { title: '웹 버전', description: '앱이 아닌 브라우저에서도 웹캠을 통해 간략한 집중도 측정을 사용할 수 있습니다.' },
                        ]} />}
                    />
                    <div className="glass-card p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-[var(--color-text)]">상태</span>
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${isNative ? 'bg-green-400' : 'bg-[var(--color-border)]'}`} />
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
                                    <p className="text-[10px] text-[var(--color-text-secondary)] opacity-70 mb-3">
                                        캘리브레이션 화면이 열립니다. 빨간 점을 차례로 응시하고 버튼을 눌러 9개 지점을 캡처하세요.
                                    </p>
                                    <div className="flex gap-2">
                                        {CALIB_SCENARIOS.map(({ mode, tone, icon, label }) => (
                                            <ActionPill
                                                key={mode}
                                                tone={tone}
                                                icon={icon}
                                                label={label}
                                                onClick={() => handleNativeCalibration(mode)}
                                                disabled={nativeCalibRunning || nativeStatus === 'starting'}
                                            />
                                        ))}
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
                                        <p className="text-xs text-[var(--color-text)]">
                                            누적 세션: <span className="font-bold">{trainingState.session_count}회</span>
                                        </p>
                                        <p className="text-[10px] text-[var(--color-text-secondary)] opacity-70 mt-0.5">
                                            {trainingState.is_calibrated
                                                ? '✓ 개인화 점수 적용 중'
                                                : `${Math.max(0, 3 - trainingState.session_count)}회 더 평가 필요`}
                                        </p>
                                    </div>
                                    {isNative && (
                                        <Pressable
                                            onClick={resetScoreCalibration}
                                            pressScale={0.94}
                                            className="text-[10px] px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 font-bold"
                                        >
                                            초기화
                                        </Pressable>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-[var(--color-text-secondary)]">
                                    측정 세션 종료 후 집중도를 평가하면 점수가 당신에게 맞게 조정됩니다.
                                </p>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* PC Focus 연결 설정 */}
                <motion.div variants={staggerItem}>
                    <SectionHead
                        label="PC Focus 연결"
                        help={<HelpButton title="PC Focus 서버 연결" items={[
                            { description: 'PC(노트북·데스크탑)의 웹캠을 이용해 집중도를 분석하는 별도 서버에 접속합니다.' },
                            { title: '사용 방법', description: 'PC에 Focus 분석 서버 프로그램을 실행하고, 같은 Wi-Fi에 연결된 상태에서 PC의 IP 주소를 입력하여 연결합니다.' },
                            { title: '언제 사용?', description: '태블릿을 책 받침으로 세워 두고 PC 카메라로 얼굴을 찍고 싶을 때, 또는 더 좋은 카메라 화질로 집중도를 측정하고 싶을 때 사용합니다.' },
                            { title: '캘리브레이션', description: '9개 지점을 순서대로 응시하며 캡처하면 시선 추적이 정교해집니다. 책/모니터 환경에 따라 모드를 선택하세요.' },
                        ]} />}
                    />
                    <div className="glass-card p-6 space-y-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-[var(--color-text)]">서버 연결</span>
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
                                placeholder="예: 192.168.0.14 (IP만 입력해도 자동 보강)"
                                className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)] text-sm font-mono"
                            />
                            <Pressable
                                onClick={handleSaveServerUrl}
                                className="px-4 py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm whitespace-nowrap"
                            >
                                저장
                            </Pressable>
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
                                        <div className="w-2 h-2 rounded-full bg-[var(--color-border)]" />
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
                                <ActionPill
                                    tone="indigo"
                                    icon="mdi:play"
                                    label="시작"
                                    onClick={sendPipelineStart}
                                    disabled={!connected || (pipelineState?.running === true)}
                                />
                                <ActionPill
                                    tone="red"
                                    icon="mdi:stop"
                                    label="정지"
                                    onClick={sendPipelineStop}
                                    disabled={!connected || (pipelineState?.running !== true)}
                                />
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
                            <AnimatePresence mode="wait">
                                {currentCalibMode !== null && captureCount < 9 && (
                                    <motion.div
                                        key="calib-progress"
                                        variants={fadeRise}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3 mb-3"
                                    >
                                        <p className="text-xs font-bold text-indigo-400 mb-1">
                                            {captureCount + 1}/9 — <span className="text-[var(--color-text)]">{CALIB_LABELS[captureCount]}</span>을(를) 바라보세요
                                        </p>
                                        <p className="text-[10px] text-[var(--color-text-secondary)] opacity-70">
                                            {currentCalibMode === 'book' ? '책' : '모니터'}의 해당 위치를 응시한 뒤 캡처 버튼을 누르세요
                                        </p>
                                    </motion.div>
                                )}
                                {currentCalibMode === null && captureCount >= 9 && (
                                    <motion.div
                                        key="calib-done"
                                        variants={fadeRise}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-3"
                                    >
                                        <p className="text-xs font-bold text-green-400">캘리브레이션 완료!</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* 캘리 중 카메라 자동 활성 (video_frame PC 전송) */}
                            {currentCalibMode !== null && (
                                <div style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1, overflow: 'hidden' }}>
                                    <TabletCamera sendVideoFrame={sendVideoFrame} connected={connected} fps={15} autoStart />
                                </div>
                            )}

                            <div className="flex gap-2 mb-3">
                                {CALIB_SCENARIOS.map(({ mode, tone, icon, label }) => (
                                    <ActionPill
                                        key={mode}
                                        tone={tone}
                                        icon={icon}
                                        label={label}
                                        onClick={() => handleCalibrateStart(mode)}
                                        disabled={!connected}
                                    />
                                ))}
                            </div>

                            <div className="flex items-center gap-3">
                                <ActionPill
                                    tone="green"
                                    icon="mdi:camera-iris"
                                    label="캡처"
                                    onClick={handleCalibrateCapture}
                                    disabled={!connected || captureCount >= 9}
                                />
                                <div className="flex items-center gap-2 min-w-[90px]">
                                    <div className="flex gap-0.5">
                                        {Array.from({ length: 9 }).map((_, i) => (
                                            <motion.div
                                                key={i}
                                                className="w-2 h-2 rounded-full"
                                                animate={{ backgroundColor: i < captureCount ? '#4ade80' : 'var(--color-border)' }}
                                                transition={spring.snappy}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-xs text-[var(--color-text-secondary)] font-mono ml-1">{captureCount}/9</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* 데이터 백업 / 복원 */}
                <motion.div variants={staggerItem}>
                    <SectionLabel>데이터</SectionLabel>
                    <div className="glass-card p-6 space-y-4">
                        <div className="flex items-center gap-2">
                            <Icon icon="mdi:database-arrow-down-outline" className="text-lg text-[var(--color-primary)]" />
                            <label className="text-sm font-medium text-[var(--color-text)]">데이터 백업 / 복원</label>
                        </div>
                        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                            모든 설정·공부 기록·일일 기록·메모를 하나의 JSON 파일로 저장합니다.
                            앱을 재설치하거나 기기를 바꿀 때 이 파일로 데이터를 그대로 옮길 수 있습니다.
                        </p>

                        <div className="flex gap-2">
                            <ActionPill
                                tone="indigo"
                                icon="mdi:export-variant"
                                label={exporting ? '내보내는 중...' : '내보내기 (백업)'}
                                onClick={handleExportBackup}
                                disabled={exporting || importing}
                            />
                            <ActionPill
                                tone="green"
                                icon="mdi:import"
                                label={importing ? '복원 중...' : '가져오기 (복원)'}
                                onClick={() => backupInputRef.current?.click()}
                                disabled={exporting || importing}
                            />
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
                </motion.div>

                {/* 데이터 관리 (용량 확인 · 정리 · 삭제) */}
                <motion.div variants={staggerItem}>
                    <Pressable
                        onClick={() => navigate('/data')}
                        pressScale={0.98}
                        className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl glass-card hover:bg-white/5 border border-[var(--color-border)]"
                    >
                        <div className="flex items-center gap-3">
                            <Icon icon="mdi:database-cog-outline" className="text-xl text-[var(--color-primary)] flex-shrink-0" />
                            <div className="text-left">
                                <p className="text-sm font-medium text-[var(--color-text)]">데이터 관리</p>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">저장소 사용량 확인 · 오래된 데이터 정리 · 항목별 삭제</p>
                            </div>
                        </div>
                        <Icon icon="mdi:chevron-right" className="text-xl text-[var(--color-text-secondary)] opacity-50 flex-shrink-0" />
                    </Pressable>
                </motion.div>

                {/* Save Button */}
                <motion.div variants={staggerItem}>
                    <Pressable
                        onClick={handleSave}
                        pressScale={0.98}
                        className="w-full btn btn-primary text-lg py-4 flex items-center justify-center gap-2"
                    >
                        {saved ? <><Icon icon="mdi:check-bold" className="text-xl" /> 저장됨!</> : '저장하기'}
                    </Pressable>
                </motion.div>

                {/* 개발자 & 버전 정보 */}
                <motion.div variants={staggerItem} className="mt-4 pt-8 border-t border-[var(--color-border)] flex flex-col gap-3">
                    <Pressable
                        onClick={() => navigate('/developer')}
                        pressScale={0.98}
                        className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 hover:from-indigo-500/20 hover:via-purple-500/20 hover:to-pink-500/20 border border-indigo-400/25 hover:border-indigo-400/45"
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
                        <Icon icon="mdi:chevron-right" className="text-xl text-indigo-400 opacity-70 flex-shrink-0" />
                    </Pressable>

                    {devAdmin && (
                        <Pressable
                            onClick={() => navigate('/admin')}
                            pressScale={0.98}
                            className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white flex-shrink-0">
                                    <Icon icon="mdi:shield-crown" className="text-base" />
                                </div>
                                <p className="text-sm font-bold text-left text-[var(--color-text)]">관리자 페이지</p>
                            </div>
                            <Icon icon="mdi:chevron-right" className="text-xl text-[var(--color-text-secondary)] opacity-50" />
                        </Pressable>
                    )}

                    <Pressable
                        onClick={() => setShowChangelog(true)}
                        pressScale={0.98}
                        className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0">
                                <Icon icon="mdi:history" className="text-base" />
                            </div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-[var(--color-text)] leading-tight">업데이트 내역</p>
                                <p className="text-[11px] font-bold text-[var(--color-text-secondary)] leading-tight">
                                    v{APP_VERSION}까지 새로워진 점 모두 보기
                                </p>
                            </div>
                        </div>
                        <Icon icon="mdi:chevron-right" className="text-xl text-[var(--color-text-secondary)] opacity-50" />
                    </Pressable>

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
                </motion.div>
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

            <ChangelogHistoryModal open={showChangelog} onClose={() => setShowChangelog(false)} />
        </motion.div>
    )
}
