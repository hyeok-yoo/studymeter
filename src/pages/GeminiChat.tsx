import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Settings } from '../lib/db'
import { db, formatDuration, getTodayDate } from '../lib/db'
import { generateContent, fetchGeminiModels } from '../lib/gemini'

interface GeminiChatProps {
    settings: Settings
}

interface Message {
    role: 'user' | 'assistant'
    content: string
}

export default function GeminiChat({ settings }: GeminiChatProps) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [shareData, setShareData] = useState<'none' | 'day' | 'week'>('none')

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

위 데이터를 참고해서 답변해주세요.

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

위 데이터를 참고해서 답변해주세요.

`
        }
    }

    const sendMessage = async () => {
        if (!input.trim() || !settings.geminiApiKey) return

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
                const models = await fetchGeminiModels(settings.geminiApiKey).catch(() => [])
                modelName = models[0]?.name ?? ''
            }
            if (!modelName) {
                setMessages(prev => [...prev, { role: 'assistant', content: '❌ 사용 가능한 모델이 없습니다. 설정에서 API 키와 모델을 확인해주세요.' }])
                return
            }

            const { text, fellBack } = await generateContent(settings.geminiApiKey, modelName, fullPrompt)
            const reply = fellBack
                ? text + '\n\n💡 **Tip:** 선택한 모델의 할당량이 초과되어 더 가벼운 모델로 자동 전환해 답변했습니다.'
                : text

            setMessages(prev => [...prev, { role: 'assistant', content: reply }])
        } catch (err) {
            const msg = err instanceof Error ? err.message : '오류가 발생했습니다. API 키를 확인해주세요.'
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="animate-fade-in max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-3xl font-bold gradient-text">Gemini</h1>
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
                                        <div className="prose prose-sm dark:prose-invert max-w-none">
                                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                                        </div>
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
                        {/* Data Share Buttons */}
                        <div className="flex items-center gap-2">
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
                            {shareData !== 'none' && (
                                <span className="text-[10px] text-green-500 font-medium animate-pulse">
                                    ✓ {shareData === 'day' ? '오늘' : '이번 주'} 기록이 다음 메시지에 포함됩니다
                                </span>
                            )}
                        </div>

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
