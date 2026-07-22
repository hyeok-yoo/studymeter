/**
 * ChecklistCard.tsx — 홈 화면 체크리스트 카드.
 *
 * 오늘(day) / 이번 주(week) / 이번 달(month) 탭으로 범위를 바꿔가며 할 일을 관리한다.
 * useLiveQuery 로 실시간 반영되며, 완료 항목은 취소선 처리 후 하단으로 정렬된다
 * (getTodos 가 이미 done 항목을 뒤로 정렬해서 반환).
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '@iconify/react'
import type { TodoScope } from '../lib/db'
import { getTodos, addTodo, toggleTodo, deleteTodo, clearCompletedTodos, currentPeriodKey } from '../lib/db'
import Pressable from './ui/Pressable'
import { spring, fadeRise, staggerItem } from '../lib/motion'

const SCOPE_TABS: Array<{ scope: TodoScope; label: string }> = [
    { scope: 'day', label: '오늘' },
    { scope: 'week', label: '이번 주' },
    { scope: 'month', label: '이번 달' },
]

const SCOPE_PLACEHOLDER: Record<TodoScope, string> = {
    day: '오늘 할 일 추가...',
    week: '이번 주 할 일 추가...',
    month: '이번 달 할 일 추가...',
}

export default function ChecklistCard() {
    const [scope, setScope] = useState<TodoScope>('day')
    const [input, setInput] = useState('')
    const [adding, setAdding] = useState(false)

    const periodKey = currentPeriodKey(scope)
    const todos = useLiveQuery(() => getTodos(scope, periodKey), [scope, periodKey])

    const doneCount = todos?.filter(t => t.done).length ?? 0
    const totalCount = todos?.length ?? 0

    const handleAdd = async () => {
        const text = input.trim()
        if (!text || adding) return
        setAdding(true)
        try {
            await addTodo(scope, periodKey, text)
            setInput('')
        } finally {
            setAdding(false)
        }
    }

    const handleClearCompleted = async () => {
        await clearCompletedTodos(scope, periodKey)
    }

    return (
        <motion.section variants={staggerItem} className="glass-card p-6 md:p-8">
            <div className="flex items-center gap-2 mb-5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
                    <Icon icon="mdi:checkbox-marked-circle-outline" className="text-lg text-white" />
                </div>
                <h2 className="text-lg font-black text-[var(--color-text)]">체크리스트</h2>
                {totalCount > 0 && (
                    <span className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-400/20 tabular-nums">
                        {doneCount}/{totalCount} 완료
                    </span>
                )}
            </div>

            {/* 범위 탭 */}
            <div className="relative flex gap-1 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-1 mb-4">
                {SCOPE_TABS.map((tab) => {
                    const active = tab.scope === scope
                    return (
                        <button
                            key={tab.scope}
                            type="button"
                            onClick={() => setScope(tab.scope)}
                            className="relative flex-1 rounded-lg py-2 px-3 text-sm font-medium transition-colors active:scale-[0.97]"
                        >
                            {active && (
                                <motion.div
                                    layoutId="checklist-scope-picker"
                                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600"
                                    transition={spring.default}
                                />
                            )}
                            <span className={`relative z-10 ${active ? 'text-white' : 'text-[var(--color-text-secondary)]'}`}>
                                {tab.label}
                            </span>
                        </button>
                    )
                })}
            </div>

            {/* 입력 */}
            <div className="flex items-center gap-2 mb-4">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                    placeholder={SCOPE_PLACEHOLDER[scope]}
                    className="flex-1 px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-emerald-400/60 text-[var(--color-text)] text-sm"
                />
                <Pressable
                    onClick={handleAdd}
                    disabled={!input.trim() || adding}
                    pressScale={0.94}
                    className="px-4 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                    <Icon icon="mdi:plus" className="text-base" /> 추가
                </Pressable>
            </div>

            {/* 목록 */}
            <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                    {(todos ?? []).map((todo) => (
                        <motion.div
                            key={todo.id}
                            variants={fadeRise}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            layout
                            className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-colors ${todo.done
                                ? 'bg-black/[0.02] dark:bg-white/[0.02] border-transparent'
                                : 'bg-black/[0.03] dark:bg-white/5 border-white/10'
                                }`}
                        >
                            <Pressable
                                type="button"
                                onClick={() => toggleTodo(todo.id!)}
                                pressScale={0.85}
                                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${todo.done
                                    ? 'bg-emerald-500 border-emerald-500'
                                    : 'border-[var(--color-border)] hover:border-emerald-400'
                                    }`}
                            >
                                {todo.done && <Icon icon="mdi:check-bold" className="text-xs text-white" />}
                            </Pressable>
                            <span
                                className={`flex-1 text-sm font-medium ${todo.done
                                    ? 'line-through text-[var(--color-text-secondary)] opacity-50'
                                    : 'text-[var(--color-text)]'
                                    }`}
                            >
                                {todo.text}
                            </span>
                            <Pressable
                                type="button"
                                onClick={() => deleteTodo(todo.id!)}
                                pressScale={0.85}
                                className="opacity-40 hover:opacity-100 flex items-center justify-center p-1 flex-shrink-0"
                                aria-label="삭제"
                            >
                                <Icon icon="mdi:close" className="text-base text-[var(--color-text-secondary)]" />
                            </Pressable>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {todos && todos.length === 0 && (
                    <p className="text-center text-xs text-[var(--color-text-secondary)] opacity-50 py-6 italic">
                        아직 할 일이 없습니다. 위에서 추가해 보세요.
                    </p>
                )}
            </div>

            {doneCount > 0 && (
                <div className="flex justify-end mt-3">
                    <Pressable
                        onClick={handleClearCompleted}
                        pressScale={0.94}
                        className="text-[11px] px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--color-text-secondary)] font-bold flex items-center gap-1.5"
                    >
                        <Icon icon="mdi:broom" className="text-sm" /> 완료 항목 정리
                    </Pressable>
                </div>
            )}
        </motion.section>
    )
}
