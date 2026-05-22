import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Settings } from '../lib/db'
import { db, formatDuration, getTodayDate } from '../lib/db'

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
            let modelName = settings.geminiModel || 'gemini-2.0-flash'
            let isFallback = false

            console.log('Using model:', modelName)

            const callApi = async (model: string) => {
                return await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.geminiApiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: fullPrompt }] }]
                        })
                    }
                )
            }

            let response = await callApi(modelName)

            // If Quota Exceeded (429) and we are not already using Flash
            if (response.status === 429 && !modelName.includes('flash')) {
                console.log('Quota exceeded for', modelName, 'switching to fallback...')
                modelName = 'gemini-2.0-flash'
                isFallback = true
                response = await callApi(modelName)
            }

            const data = await response.json()
            console.log('API Response:', data)

            if (data.error) {
                const errorMessage = data.error.code === 429
                    ? `❌ 일일 사용량이 초과되었습니다.\n내일 다시 시도하거나, 설정에서 'Pay-as-you-go'가 활성화된 프로젝트의 API 키를 사용해주세요.`
                    : `❌ API 오류: ${data.error.message}\n\n모델: ${modelName}`

                setMessages(prev => [...prev, { role: 'assistant', content: errorMessage }])
                return
            }

            let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 받지 못했습니다. (candidates가 없음)'

            if (isFallback) {
                reply += '\n\n💡 **Tip:** 선택하신 모델의 할당량이 초과되어 **Flash 모델**로 자동 전환하여 답변했습니다.'
            }

            setMessages(prev => [...prev, { role: 'assistant', content: reply }])
        } catch (error) {
            setMessages(prev => [...prev, { role: 'assistant', content: '오류가 발생했습니다. API 키를 확인해주세요.' }])
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
