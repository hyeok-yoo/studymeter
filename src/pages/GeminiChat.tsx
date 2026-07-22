import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { db, formatDuration, formatDateYYYYMMDD, getTodayDate } from '../lib/db'
import {
    generateContent,
    fetchGeminiModels,
    buildFunctionResponseContent,
    QuotaExceededError,
    type GeminiModel,
    type GroundingSource,
    type GeminiContent,
    type GeminiReply,
} from '../lib/gemini'
import { buildChatFunctionDeclarations, executeChatFunction } from '../lib/ai/functions'
import { buildModelChain, supportsFunctionCalling, supportsGrounding, markModelExhausted, markModelCooldown } from '../lib/ai/router'
import { buildSystemInstruction } from '../lib/ai/prompts'
import AiMarkdown from '../components/AiMarkdown'
import Pressable from '../components/ui/Pressable'
import { fadeRise, staggerContainer, staggerItem } from '../lib/motion'

interface GeminiChatProps {
    settings: Settings
}

/** 어시스턴트 메시지 안에서 실행된 함수 호출 하나 (표시용). */
interface FunctionActivityItem {
    name: string
    label: string
    error?: boolean
}

interface Message {
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
    grounding?: GroundingSource[]
    functionActivity?: FunctionActivityItem[]
    attachments?: DisplayAttachment[]
}

/** 대화 히스토리(contents)로 유지할 최대 항목 수. 넘으면 오래된 턴부터 자른다. */
const MAX_HISTORY_ENTRIES = 40
/** 함수 호출 루프 최대 라운드(모델 호출 횟수). */
const MAX_FUNCTION_ROUNDS = 4

function trimHistory(contents: GeminiContent[]): GeminiContent[] {
    if (contents.length <= MAX_HISTORY_ENTRIES) return contents
    let trimmed = contents.slice(contents.length - MAX_HISTORY_ENTRIES)
    // Gemini contents 는 관례적으로 'user' 턴으로 시작해야 하므로 앞머리를 맞춘다.
    while (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1)
    return trimmed
}

const WRITE_ERROR_LABELS: Record<string, string> = {
    log_session: '기록 실패',
    save_diary: '일기 저장 실패',
    save_weekly_diary: '주간 일기 저장 실패',
    add_todo: '할 일 추가 실패',
    complete_todo: '할 일 완료 실패',
    save_learning_note: '학습 노트 저장 실패',
}

/** 조회/저장 함수 실행 결과를 사람이 읽을 짧은 칩 문구로 변환한다. */
function describeFunctionActivity(name: string, result: Record<string, unknown>): FunctionActivityItem {
    const error = typeof result.error === 'string'
    if (error) {
        const prefix = WRITE_ERROR_LABELS[name] ?? '조회 실패'
        return { name, label: `${prefix}: ${result.error}`, error: true }
    }
    switch (name) {
        case 'log_session':
            return { name, label: `${result.saved ?? '세션'} 기록됨` }
        case 'save_diary':
            return { name, label: `일기 저장됨${result.date ? ` (${result.date})` : ''}` }
        case 'save_weekly_diary':
            return { name, label: `주간 일기 저장됨${result.week_start ? ` (${result.week_start})` : ''}` }
        case 'add_todo':
            return { name, label: `할 일 추가됨: ${result.saved ?? ''}` }
        case 'complete_todo':
            return { name, label: `할 일 완료: ${result.completed ?? ''}` }
        case 'save_learning_note':
            return { name, label: `학습 노트 저장됨${result.saved ? ` (${result.saved})` : ''}` }
        case 'list_todos':
            return { name, label: '할 일 조회' }
        case 'search_learning_notes':
            return { name, label: `학습 노트 검색 (${result.count ?? 0}건)` }
        case 'get_study_data':
            return { name, label: '공부 기록 조회' }
        case 'get_diary':
            return { name, label: '일기 조회' }
        default:
            return { name, label: name }
    }
}

// 조회류 vs 저장류에 따라 칩 아이콘을 다르게 보여준다.
const WRITE_FUNCTIONS = new Set([
    'log_session', 'save_diary', 'save_weekly_diary', 'add_todo', 'complete_todo', 'save_learning_note',
])

/** 첨부 파일 하나 (전송 대기 중). data 는 raw base64 (data: 접두사 없음). */
interface StagedAttachment {
    name: string
    mimeType: string
    data: string
    isImage: boolean
}

/** 사용자 메시지 버블에 표시할 첨부 요약. */
interface DisplayAttachment {
    name: string
    isImage: boolean
    previewUrl?: string
}

/** File 을 raw base64 로 읽는다 (data: 접두사 제거). */
function readFileAsBase64(file: File): Promise<{ mimeType: string; data: string }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : ''
            const comma = result.indexOf(',')
            resolve({
                mimeType: file.type || 'application/octet-stream',
                data: comma >= 0 ? result.slice(comma + 1) : result,
            })
        }
        reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'))
        reader.readAsDataURL(file)
    })
}

function deriveActiveCaps(model: GeminiModel | undefined, name: string) {
    if (model) return model
    // 목록을 아직 못 받았을 때 이름만으로 능력 추정
    return {
        name,
        displayName: name,
        description: '',
        supportsThinking: /2\.5/.test(name),
        supportsGrounding: /gemini-2\.\d/.test(name),
    } as GeminiModel
}

export default function GeminiChat({ settings }: GeminiChatProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [history, setHistory] = useState<GeminiContent[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [shareData, setShareData] = useState<'none' | 'day' | 'week'>('none')
    const [models, setModels] = useState<GeminiModel[]>([])
    const [useGrounding, setUseGrounding] = useState(settings.aiGroundingDefault !== false)
    const [useThinking, setUseThinking] = useState(true)
    const [attachments, setAttachments] = useState<StagedAttachment[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 함수 선언은 사용자의 과목·유형 목록(enum)을 반영해 동적으로 만든다.
    const functionDeclarations = useMemo(() => buildChatFunctionDeclarations(settings), [settings])

    const handleFilesChosen = async (files: FileList | null) => {
        if (!files || files.length === 0) return
        const staged: StagedAttachment[] = []
        for (const file of Array.from(files)) {
            const isImage = file.type.startsWith('image/')
            const isPdf = file.type === 'application/pdf'
            if (!isImage && !isPdf) continue
            try {
                const { mimeType, data } = await readFileAsBase64(file)
                staged.push({ name: file.name, mimeType, data, isImage })
            } catch {
                /* 개별 파일 읽기 실패는 무시 */
            }
        }
        if (staged.length) setAttachments((prev) => [...prev, ...staged])
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const removeAttachment = (index: number) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index))
    }

    // 사용 가능한 모델 목록을 받아 선택 모델의 능력치를 파악한다.
    useEffect(() => {
        if (!settings.geminiApiKey) return
        let cancelled = false
        fetchGeminiModels(settings.geminiApiKey)
            .then((list) => { if (!cancelled) setModels(list) })
            .catch(() => { /* 무시: 이름 기반 추정으로 대체 */ })
        return () => { cancelled = true }
    }, [settings.geminiApiKey])

    const activeModel = useMemo(() => {
        const found = models.find((m) => m.name === settings.geminiModel) ?? models[0]
        return deriveActiveCaps(found, settings.geminiModel || found?.name || '')
    }, [models, settings.geminiModel])

    const getStudyDataSummary = async () => {
        if (shareData === 'none') return ''

        const today = getTodayDate()

        if (shareData === 'day') {
            const sessions = await db.sessions.where('date').equals(today).toArray()
            const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0)
            const selfStudyTime = sessions.filter(s => s.type === '자습' || s.type === '테스트').reduce((sum, s) => sum + s.duration, 0)

            const bySubject = new Map<string, number>()
            sessions.forEach(s => {
                bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + s.duration)
            })

            return `[오늘 공부 데이터]
- 총 공부 시간: ${formatDuration(totalTime)}
- 순공 시간 (자습): ${formatDuration(selfStudyTime)}
- 세션 수: ${sessions.length}회
- 과목별: ${Array.from(bySubject.entries()).map(([k, v]) => `${k}: ${formatDuration(v)}`).join(', ')}

`
        } else {
            // Week - using Monday to Sunday
            const todayDate = new Date()
            const day = todayDate.getDay()
            const diff = day === 0 ? -6 : 1 - day
            const monday = new Date(todayDate)
            monday.setDate(todayDate.getDate() + diff)
            monday.setHours(0, 0, 0, 0)

            const sunday = new Date(monday)
            sunday.setDate(monday.getDate() + 6)

            const sessions = await db.sessions
                .where('date')
                // 로컬 날짜 기준 (toISOString은 UTC라 KST 자정~09시에 하루 어긋남)
                .between(formatDateYYYYMMDD(monday), formatDateYYYYMMDD(sunday), true, true)
                .toArray()

            const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0)
            const selfStudyTime = sessions.filter(s => s.type === '자습' || s.type === '테스트').reduce((sum, s) => sum + s.duration, 0)

            const bySubject = new Map<string, number>()
            sessions.forEach(s => {
                bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + s.duration)
            })

            return `[이번 주 공부 데이터 (월~일)]
- 총 공부 시간: ${formatDuration(totalTime)}
- 순공 시간 (자습): ${formatDuration(selfStudyTime)}
- 세션 수: ${sessions.length}회
- 과목별: ${Array.from(bySubject.entries()).map(([k, v]) => `${k}: ${formatDuration(v)}`).join(', ')}

`
        }
    }

    /**
     * 역할 기반 라우팅으로 모델을 골라 generateContent 를 호출한다.
     * - settings.geminiModel 이 지정돼 있으면 그 모델만 사용 (기존 동작 그대로: 내부 429 자동 폴백 허용).
     * - 없으면 buildModelChain('interactive', settings) 의 후보들을 순서대로 시도하고,
     *   429(QuotaExceededError) 를 만나면 markModelExhausted 로 표시 후 다음 후보로 넘어간다.
     * - 그라운딩과 함수 호출은 동시에 전달하지 않는다 (wantFunctions 가 꺼져 있으면 함수 선언 생략).
     */
    const callModelWithRouting = async (
        contents: GeminiContent[],
        wantFunctions: boolean,
    ): Promise<GeminiReply> => {
        const apiKey = settings.geminiApiKey ?? ''
        if (!apiKey) {
            throw new Error('API 키가 설정되어 있지 않습니다. 설정 페이지에서 확인해주세요.')
        }
        const explicitModel = settings.geminiModel?.trim()
        let chain: string[]
        if (explicitModel) {
            chain = [explicitModel]
        } else {
            chain = await buildModelChain('interactive', settings)
            if (chain.length === 0) {
                const list = models.length ? models : await fetchGeminiModels(apiKey).catch(() => [])
                chain = list[0] ? [list[0].name] : []
            }
        }
        if (chain.length === 0) {
            throw new Error('사용 가능한 모델이 없습니다. 설정에서 API 키와 모델을 확인해주세요.')
        }

        let lastErr: unknown = null
        for (let i = 0; i < chain.length; i++) {
            const candidate = chain[i]
            const isLast = i === chain.length - 1
            const useFn = wantFunctions && supportsFunctionCalling(candidate)
            try {
                // Gemini 3.x 는 그라운딩 + 함수 호출을 동시 지원한다. 각 후보 모델의 능력에 맞춰 게이팅.
                const reply = await generateContent(apiKey, candidate, '', {
                    systemInstruction: buildSystemInstruction(settings, 'chat'),
                    useGrounding: useGrounding && supportsGrounding(candidate),
                    useThinking: useThinking && activeModel.supportsThinking,
                    thinkingLevel: settings.aiThinkingLevels?.interactive,
                    availableModels: models,
                    contents,
                    functionDeclarations: useFn ? functionDeclarations : undefined,
                    // 후보가 더 남아있으면 우리가 직접 다음 후보로 넘어갈 수 있도록 자동 폴백을 끈다.
                    // 마지막 후보에서는 generateContent 자체의 1회 자동 폴백(flash 전환)을 허용한다.
                    noFallback: !isLast,
                })
                // 내부 자동 폴백은 429 성격을 모르므로 보수적으로 짧은 쿨다운만 건다
                if (reply.fellBack) markModelCooldown(candidate)
                return reply
            } catch (err) {
                if (err instanceof QuotaExceededError) {
                    // 일일 소진만 하루 차단, 분당(RPM) 한도는 짧은 쿨다운 후 자동 복구
                    if (err.scope === 'daily') markModelExhausted(candidate)
                    else markModelCooldown(candidate, err.retryAfterMs)
                    lastErr = err
                    continue
                }
                throw err
            }
        }
        if (lastErr instanceof QuotaExceededError && lastErr.scope === 'rate') {
            const secs = Math.max(5, Math.ceil((lastErr.retryAfterMs ?? 30_000) / 1000))
            throw new Error(`요청이 잠깐 몰렸어요 (분당 한도). 약 ${secs}초 후에 다시 보내주세요 — 일일 사용량 초과가 아닙니다.`)
        }
        throw lastErr instanceof Error ? lastErr : new Error('모든 모델의 할당량이 초과되었습니다.')
    }

    const sendMessage = async () => {
        if ((!input.trim() && attachments.length === 0) || !settings.geminiApiKey || loading) return

        setLoading(true)
        const dataSummary = await getStudyDataSummary()
        const fullPrompt = dataSummary + input
        const userMessage = input
        const staged = attachments

        // 사용자 메시지 parts: 텍스트(있으면) + 첨부(inlineData). 이미지·PDF 모두 inlineData 로 전달.
        const userParts: Array<Record<string, unknown>> = []
        if (fullPrompt.trim()) userParts.push({ text: fullPrompt })
        for (const att of staged) userParts.push({ inlineData: { mimeType: att.mimeType, data: att.data } })
        if (userParts.length === 0) userParts.push({ text: '' })

        const displayAttachments: DisplayAttachment[] = staged.map((att) => ({
            name: att.name,
            isImage: att.isImage,
            previewUrl: att.isImage ? `data:${att.mimeType};base64,${att.data}` : undefined,
        }))

        setMessages(prev => [...prev, {
            role: 'user',
            content: userMessage || (staged.length ? `(첨부 ${staged.length}개 전송)` : ''),
            attachments: displayAttachments.length ? displayAttachments : undefined,
        }])
        setInput('')
        setAttachments([]) // 전송 후 첨부 비우기
        setShareData('none') // Reset after sending

        try {
            // 함수 호출(자연어 자동 기록)은 항상 우선 활성화한다. Gemini 3.x 는 그라운딩과 함께 쓸 수 있어
            // 검색이 켜져 있어도 함수 선언을 생략하지 않는다 (모델별 지원은 callModelWithRouting 에서 게이팅).
            const wantFunctions = true

            let contents = trimHistory([...history, { role: 'user', parts: userParts }])
            const functionActivity: FunctionActivityItem[] = []
            let reply: GeminiReply | null = null

            for (let round = 0; round < MAX_FUNCTION_ROUNDS; round++) {
                reply = await callModelWithRouting(contents, wantFunctions)
                if (!reply.functionCalls?.length) break
                // 마지막 라운드에서도 함수 호출을 요청했다면, 더 이어갈 라운드가 없으니 여기서 종료.
                if (round === MAX_FUNCTION_ROUNDS - 1) break

                contents = reply.contents ?? contents
                const responses: Array<{ name: string; response: Record<string, unknown> }> = []
                for (const fc of reply.functionCalls) {
                    const fnResult = await executeChatFunction(fc.name, fc.args, settings)
                    responses.push({ name: fc.name, response: fnResult })
                    functionActivity.push(describeFunctionActivity(fc.name, fnResult))
                }
                contents = [...contents, buildFunctionResponseContent(responses)]
            }

            if (!reply) throw new Error('응답을 받지 못했습니다.')

            setHistory(trimHistory(reply.contents ?? contents))

            let content = reply.text
            if (!content && functionActivity.length) content = '(요청하신 작업을 완료했습니다.)'
            if (reply.fellBack) {
                content += '\n\n> 💡 선택한 모델의 할당량이 초과되어 더 가벼운 모델로 자동 전환해 답변했습니다.'
            }

            setMessages(prev => [...prev, {
                role: 'assistant',
                content,
                reasoning: reply!.reasoning,
                grounding: reply!.grounding,
                functionActivity: functionActivity.length ? functionActivity : undefined,
            }])
        } catch (err) {
            const msg = err instanceof Error ? err.message : '오류가 발생했습니다. API 키를 확인해주세요.'
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="animate-fade-in max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h1 className="text-3xl font-bold gradient-text">Gemini</h1>
                {settings.geminiApiKey && activeModel.name && (
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[var(--color-text-secondary)]">
                            {activeModel.displayName}
                        </span>
                        {activeModel.supportsThinking && (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-purple-500/15 text-purple-400 border border-purple-400/20 flex items-center gap-1">
                                <Icon icon="mdi:brain" className="text-xs" /> 추론
                            </span>
                        )}
                        {activeModel.supportsGrounding && (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-400/20 flex items-center gap-1">
                                <Icon icon="mdi:google" className="text-xs" /> 검색 가능
                            </span>
                        )}
                        {activeModel.outputTokenLimit && (
                            <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-white/5 text-[var(--color-text-secondary)] opacity-70">
                                출력 {Math.round(activeModel.outputTokenLimit / 1000)}K
                            </span>
                        )}
                    </div>
                )}
            </div>

            {!settings.geminiApiKey ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="glass-card p-8 text-center max-w-md">
                        <span className="text-5xl mb-4 block">🔑</span>
                        <h2 className="text-xl font-semibold mb-2">API 키가 필요합니다</h2>
                        <p className="text-[var(--color-text-secondary)]">
                            설정 페이지에서 Gemini API 키를 입력해주세요.
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                        {messages.length === 0 && (
                            <motion.div
                                variants={fadeRise}
                                initial="initial"
                                animate="animate"
                                className="text-center text-[var(--color-text-secondary)] py-12"
                            >
                                <span className="text-5xl block mb-4">✨</span>
                                <p className="font-bold text-[var(--color-text)]">오늘 공부한 걸 그냥 말해보세요</p>
                                <p className="text-sm mt-2 opacity-90">"학원에서 수학 2시간 듣고 좀 졸았어, 영어 단어도 1시간 했고"</p>
                                <p className="text-sm mt-1 opacity-70">→ 세션 기록과 오늘 일기까지 알아서 정리해드려요.</p>
                                <p className="text-sm mt-3 opacity-80">📎 모르는 문제 사진을 보내면 풀어드리고, 손글씨 일기·할 일 목록 사진은 앱에 옮겨 저장해드려요.</p>
                                <p className="text-xs mt-2 opacity-60">질문·개념 설명도 물어보세요. 📊 버튼으로 기록을 함께 공유할 수 있어요.</p>
                            </motion.div>
                        )}

                        {messages.map((msg, i) => (
                            <motion.div
                                key={i}
                                variants={fadeRise}
                                initial="initial"
                                animate="animate"
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user'
                                        ? 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] text-white'
                                        : 'glass-card'
                                        }`}
                                >
                                    {msg.role === 'assistant' ? (
                                        <>
                                            {msg.reasoning && (
                                                <details className="mb-3 rounded-xl bg-white/5 border border-white/10 overflow-hidden group">
                                                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-[var(--color-text-secondary)] flex items-center gap-1.5 list-none">
                                                        <Icon icon="mdi:chevron-right" className="text-base transition-transform group-open:rotate-90" />
                                                        <Icon icon="mdi:brain" className="text-sm text-purple-400" />
                                                        추론 과정 보기
                                                    </summary>
                                                    <AiMarkdown className="text-xs opacity-80 px-3 pb-3 pt-1 border-t border-white/5">
                                                        {msg.reasoning}
                                                    </AiMarkdown>
                                                </details>
                                            )}
                                            {msg.functionActivity && msg.functionActivity.length > 0 && (
                                                <motion.div
                                                    variants={staggerContainer}
                                                    initial="initial"
                                                    animate="animate"
                                                    className="flex flex-wrap gap-1.5 mb-2"
                                                >
                                                    {msg.functionActivity.map((fa, fi) => (
                                                        <motion.span
                                                            key={fi}
                                                            variants={staggerItem}
                                                            className={`text-[10px] font-medium px-2 py-1 rounded-full border flex items-center gap-1 ${fa.error
                                                                ? 'bg-red-500/15 text-red-400 border-red-400/30'
                                                                : 'bg-white/5 text-[var(--color-text-secondary)] border-white/10'
                                                                }`}
                                                        >
                                                            <span>{fa.error ? '⚠️' : WRITE_FUNCTIONS.has(fa.name) ? '🔧' : '📂'}</span>
                                                            <span>{fa.name}</span>
                                                            <span className="opacity-70">— {fa.label}</span>
                                                        </motion.span>
                                                    ))}
                                                </motion.div>
                                            )}
                                            <AiMarkdown>{msg.content}</AiMarkdown>
                                            {msg.grounding && msg.grounding.length > 0 && (
                                                <div className="mt-3 pt-2 border-t border-white/10">
                                                    <p className="text-[10px] font-bold text-[var(--color-text-secondary)] opacity-60 mb-1.5 flex items-center gap-1">
                                                        <Icon icon="mdi:google" className="text-xs" /> 검색 출처
                                                    </p>
                                                    <div className="flex flex-col gap-1">
                                                        {msg.grounding.map((g, gi) => (
                                                            <a
                                                                key={gi}
                                                                href={g.uri}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-xs text-cyan-400 hover:underline truncate flex items-center gap-1"
                                                            >
                                                                <Icon icon="mdi:link-variant" className="text-xs flex-shrink-0" />
                                                                <span className="truncate">{g.title}</span>
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {msg.attachments && msg.attachments.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mb-2">
                                                    {msg.attachments.map((att, ai) => (
                                                        att.previewUrl ? (
                                                            <img
                                                                key={ai}
                                                                src={att.previewUrl}
                                                                alt={att.name}
                                                                className="w-20 h-20 object-cover rounded-lg border border-white/20"
                                                            />
                                                        ) : (
                                                            <span
                                                                key={ai}
                                                                className="text-xs font-medium px-2 py-1 rounded-lg bg-white/15 border border-white/20 flex items-center gap-1 max-w-[10rem]"
                                                            >
                                                                <Icon icon="mdi:file-pdf-box" className="text-sm flex-shrink-0" />
                                                                <span className="truncate">{att.name}</span>
                                                            </span>
                                                        )
                                                    ))}
                                                </div>
                                            )}
                                            {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                                        </>
                                    )}
                                </div>
                            </motion.div>
                        ))}

                        <AnimatePresence>
                            {loading && (
                                <motion.div
                                    variants={fadeRise}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    className="flex justify-start"
                                >
                                    <div className="glass-card p-4 rounded-2xl">
                                        <p className="animate-pulse">생각 중...</p>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Data Share Toggle + Input — 하단에 고정된 떠 있는 입력 바 */}
                    <div className="material-chrome rounded-2xl p-3 flex flex-col gap-2">
                        {/* Options row */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-[var(--color-text-secondary)]">📊 기록 공유:</span>
                            <Pressable
                                onClick={() => setShareData(shareData === 'day' ? 'none' : 'day')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${shareData === 'day'
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                    }`}
                            >
                                오늘
                            </Pressable>
                            <Pressable
                                onClick={() => setShareData(shareData === 'week' ? 'none' : 'week')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${shareData === 'week'
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                    }`}
                            >
                                이번 주
                            </Pressable>

                            {activeModel.supportsGrounding && (
                                <Pressable
                                    onClick={() => setUseGrounding((v) => !v)}
                                    className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${useGrounding
                                        ? 'bg-cyan-500/80 text-white'
                                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                        }`}
                                    title="Google 검색으로 최신 정보를 근거 삼아 답합니다 (기록 저장/조회와 함께 사용 가능)"
                                >
                                    <Icon icon="mdi:google" className="text-xs" /> 검색
                                </Pressable>
                            )}
                            {activeModel.supportsThinking && (
                                <Pressable
                                    onClick={() => setUseThinking((v) => !v)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${useThinking
                                        ? 'bg-purple-500/80 text-white'
                                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                        } ${activeModel.supportsGrounding ? '' : 'ml-auto'}`}
                                    title="모델의 추론 과정을 함께 받아 펼쳐 볼 수 있습니다"
                                >
                                    <Icon icon="mdi:brain" className="text-xs" /> 추론
                                </Pressable>
                            )}
                        </div>
                        {shareData !== 'none' && (
                            <span className="text-[10px] text-green-500 font-medium">
                                ✓ {shareData === 'day' ? '오늘' : '이번 주'} 기록이 다음 메시지에 포함됩니다
                            </span>
                        )}

                        {/* Staged attachments */}
                        {attachments.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {attachments.map((att, ai) => (
                                    <div
                                        key={ai}
                                        className="relative group flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] max-w-[12rem]"
                                    >
                                        {att.isImage ? (
                                            <img
                                                src={`data:${att.mimeType};base64,${att.data}`}
                                                alt={att.name}
                                                className="w-9 h-9 object-cover rounded-md flex-shrink-0"
                                            />
                                        ) : (
                                            <Icon icon="mdi:file-pdf-box" className="text-2xl text-red-400 flex-shrink-0" />
                                        )}
                                        <span className="text-xs text-[var(--color-text-secondary)] truncate">{att.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(ai)}
                                            aria-label="첨부 제거"
                                            className="flex-shrink-0 w-5 h-5 rounded-full bg-black/30 text-white flex items-center justify-center hover:bg-black/50"
                                        >
                                            <Icon icon="mdi:close" className="text-xs" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Input */}
                        <div className="flex gap-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*,application/pdf"
                                multiple
                                className="hidden"
                                onChange={(e) => handleFilesChosen(e.target.files)}
                            />
                            <Pressable
                                onClick={() => fileInputRef.current?.click()}
                                disabled={loading}
                                className="px-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] flex items-center justify-center disabled:opacity-50"
                                title="사진 또는 PDF 첨부 (모르는 문제·손글씨 일기·할 일 목록)"
                            >
                                <Icon icon="mdi:paperclip" className="text-lg" />
                            </Pressable>
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                                placeholder="오늘 공부한 걸 말하거나 질문해보세요…"
                                className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                            />
                            <Pressable
                                onClick={sendMessage}
                                disabled={loading || (!input.trim() && attachments.length === 0)}
                                className="btn btn-primary px-6 disabled:opacity-50"
                            >
                                전송
                            </Pressable>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
