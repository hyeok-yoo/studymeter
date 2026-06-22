import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { db, formatDuration, getTodayDate } from '../lib/db'
import { generateContent, fetchGeminiModels, type GeminiModel, type GroundingSource } from '../lib/gemini'

interface GeminiChatProps {
    settings: Settings
}

interface Message {
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
    grounding?: GroundingSource[]
}

// 앱에 내장된 학습 코치 페르소나 + 출력 형식 규칙.
const SYSTEM_INSTRUCTION = `당신은 학습 관리 앱 "StudyMeter"에 내장된 한국어 학습 코치입니다.
역할: 공부 계획 수립, 개념 설명, 동기부여, 시간·집중 관리에 대해 학생을 돕습니다.

답변 규칙:
- 항상 한국어로, 친근하지만 군더더기 없이 간결하게 답합니다.
- 답변은 반드시 **마크다운**으로 구조화합니다. 핵심은 굵게, 절차는 번호 목록, 나열은 글머리표, 비교는 표, 코드/수식은 코드블록을 사용합니다.
- 사용자가 공부 기록 데이터를 함께 주면 그 수치를 근거로 구체적으로 분석하고 실천 가능한 조언을 답니다.
- 모르면 모른다고 말하고, 추측은 추측이라고 표시합니다. 사족이나 자기소개는 생략합니다.`

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
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [shareData, setShareData] = useState<'none' | 'day' | 'week'>('none')
    const [models, setModels] = useState<GeminiModel[]>([])
    const [useGrounding, setUseGrounding] = useState(false)
    const [useThinking, setUseThinking] = useState(true)

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
                .between(monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0], true, true)
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

    const sendMessage = async () => {
        if (!input.trim() || !settings.geminiApiKey || loading) return

        setLoading(true)
        const dataSummary = await getStudyDataSummary()
        const fullPrompt = dataSummary + input

        setMessages(prev => [...prev, { role: 'user', content: input }])
        setInput('')
        setShareData('none') // Reset after sending

        try {
            // 선택된 모델이 없으면 API 에서 사용 가능한 첫 모델을 사용 (모델명 하드코딩 없음)
            let modelName = settings.geminiModel
            if (!modelName) {
                const list = models.length ? models : await fetchGeminiModels(settings.geminiApiKey).catch(() => [])
                modelName = list[0]?.name ?? ''
            }
            if (!modelName) {
                setMessages(prev => [...prev, { role: 'assistant', content: '❌ 사용 가능한 모델이 없습니다. 설정에서 API 키와 모델을 확인해주세요.' }])
                return
            }

            const reply = await generateContent(settings.geminiApiKey, modelName, fullPrompt, {
                systemInstruction: SYSTEM_INSTRUCTION,
                useGrounding: useGrounding && activeModel.supportsGrounding,
                useThinking: useThinking && activeModel.supportsThinking,
                availableModels: models,
            })

            const content = reply.fellBack
                ? reply.text + '\n\n> 💡 선택한 모델의 할당량이 초과되어 더 가벼운 모델로 자동 전환해 답변했습니다.'
                : reply.text

            setMessages(prev => [...prev, {
                role: 'assistant',
                content,
                reasoning: reply.reasoning,
                grounding: reply.grounding,
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
                            <div className="text-center text-[var(--color-text-secondary)] py-12">
                                <span className="text-5xl block mb-4">✨</span>
                                <p>Gemini에게 자유롭게 질문해보세요!</p>
                                <p className="text-sm mt-2">공부 기록을 공유하려면 아래 📊 버튼을 눌러주세요.</p>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div
                                key={i}
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
                                                    <div className="md-content text-xs opacity-80 px-3 pb-3 pt-1 border-t border-white/5">
                                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.reasoning}</ReactMarkdown>
                                                    </div>
                                                </details>
                                            )}
                                            <div className="md-content">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                            </div>
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
                                        <p className="whitespace-pre-wrap">{msg.content}</p>
                                    )}
                                </div>
                            </div>
                        ))}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="glass-card p-4 rounded-2xl">
                                    <p className="animate-pulse">생각 중...</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Data Share Toggle + Input */}
                    <div className="flex flex-col gap-2">
                        {/* Options row */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-[var(--color-text-secondary)]">📊 기록 공유:</span>
                            <button
                                onClick={() => setShareData(shareData === 'day' ? 'none' : 'day')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${shareData === 'day'
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                    }`}
                            >
                                오늘
                            </button>
                            <button
                                onClick={() => setShareData(shareData === 'week' ? 'none' : 'week')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${shareData === 'week'
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                    }`}
                            >
                                이번 주
                            </button>

                            {activeModel.supportsGrounding && (
                                <button
                                    onClick={() => setUseGrounding((v) => !v)}
                                    className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${useGrounding
                                        ? 'bg-cyan-500/80 text-white'
                                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                        }`}
                                    title="Google 검색으로 최신 정보를 근거 삼아 답합니다"
                                >
                                    <Icon icon="mdi:google" className="text-xs" /> 검색
                                </button>
                            )}
                            {activeModel.supportsThinking && (
                                <button
                                    onClick={() => setUseThinking((v) => !v)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${useThinking
                                        ? 'bg-purple-500/80 text-white'
                                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
                                        } ${activeModel.supportsGrounding ? '' : 'ml-auto'}`}
                                    title="모델의 추론 과정을 함께 받아 펼쳐 볼 수 있습니다"
                                >
                                    <Icon icon="mdi:brain" className="text-xs" /> 추론
                                </button>
                            )}
                        </div>
                        {shareData !== 'none' && (
                            <span className="text-[10px] text-green-500 font-medium">
                                ✓ {shareData === 'day' ? '오늘' : '이번 주'} 기록이 다음 메시지에 포함됩니다
                            </span>
                        )}

                        {/* Input */}
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                                placeholder="메시지를 입력하세요..."
                                className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] text-[var(--color-text)]"
                            />
                            <button
                                onClick={sendMessage}
                                disabled={loading || !input.trim()}
                                className="btn btn-primary px-6 disabled:opacity-50"
                            >
                                전송
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
