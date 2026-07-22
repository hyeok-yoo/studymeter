/**
 * FounderInbox.tsx — 소유자(파운더) 전용 인박스. 앱 메인 화면 어디서든 사용자가 보낸
 * 메시지를 확인하고 답장할 수 있는 플로팅 버튼 + 패널.
 *
 * App 루트에 마운트되며, 소유자가 아니면 아무것도 렌더링하지 않는다.
 * 동작:
 *  - 우하단(모바일 탭바 위) 플로팅 버튼에 안 읽은 메시지 수 배지 표시.
 *  - 탭하면 패널이 열려 최근 사용자 메시지(이름 · 내용 · 시간)를 나열한다.
 *  - 메시지를 탭하면 그 사용자의 스레드(getMessagesForUser)와 답장창(sendMessageToUser)이 열린다.
 *  - 약 45초마다 폴링. Firebase 미설정/오프라인이어도 크래시하지 않는다.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import Pressable from './ui/Pressable'

const POLL_INTERVAL = 45 * 1000

type TelemetryModule = typeof import('../lib/telemetry')
type ChatMessage = import('../lib/telemetry').ChatMessage

function timeLabel(m: ChatMessage): string {
  try {
    return m.createdAt?.toDate?.().toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }) ?? ''
  } catch { return '' }
}

export default function FounderInbox() {
  const location = useLocation()
  const [isOwner, setIsOwner] = useState(false)
  const [recent, setRecent] = useState<ChatMessage[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  // 답장 대상 사용자 (deviceId + 표시 이름)
  const [active, setActive] = useState<{ deviceId: string; name: string } | null>(null)
  const telRef = useRef<TelemetryModule | null>(null)

  const getTel = useCallback(async (): Promise<TelemetryModule | null> => {
    if (telRef.current) return telRef.current
    try {
      const tel = await import('../lib/telemetry')
      telRef.current = tel
      return tel
    } catch {
      return null
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const tel = await getTel()
      if (!tel) return
      const owner = typeof tel.isOwner === 'function' && tel.isOwner()
      setIsOwner(owner)
      if (!owner) return
      const msgs = await tel.getRecentUserMessages(50)
      setRecent(msgs)
    } catch {
      // 무시
    }
  }, [getTel])

  useEffect(() => {
    let cancelled = false
    const kickoff = setTimeout(() => { if (!cancelled) poll() }, 2500)
    const interval = setInterval(() => { if (!cancelled) poll() }, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }, [poll])

  const unreadCount = recent.filter((m) => !m.readByAdmin).length

  // 우하단 인박스 아이콘은 메인(홈) 화면에서만 노출한다. (폴링은 계속 돌아 안 읽음 수는 최신 유지)
  if (!isOwner || location.pathname !== '/') return null

  return createPortal(
    <>
      {/* 플로팅 버튼 (모바일 탭바 위) */}
      <Pressable
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-24 sm:bottom-6 right-4 z-[8000] w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-xl shadow-indigo-500/30 flex items-center justify-center text-white"
        aria-label="파운더 인박스"
      >
        <Icon icon="mdi:message-text" className="text-2xl" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center border-2 border-[var(--color-bg)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Pressable>

      {/* 인박스 패널 */}
      <AnimatePresence>
        {panelOpen && (
          <div className="fixed inset-0 z-[8100] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setPanelOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="relative w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="p-5 border-b border-white/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                  <Icon icon="mdi:inbox-full" className="text-lg text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-black gradient-text leading-tight">받은 메시지</h2>
                  <p className="text-[11px] font-bold text-[var(--color-text-secondary)] opacity-60">
                    안 읽음 {unreadCount}개 · 최근 {recent.length}개
                  </p>
                </div>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all"
                >
                  <Icon icon="mdi:close" className="text-xl" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto p-4">
                {recent.length === 0 ? (
                  <div className="text-center py-16 text-[var(--color-text-secondary)] opacity-50">
                    <Icon icon="mdi:message-off-outline" className="text-5xl mb-3" />
                    <p className="text-sm">받은 메시지가 없습니다.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recent.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setActive({ deviceId: m.deviceId, name: m.name || '사용자' })}
                        className={`text-left p-3.5 rounded-2xl transition-all flex items-start gap-3 ${
                          m.readByAdmin ? 'bg-white/5 hover:bg-white/10' : 'bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-400/20'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600">
                          {(m.name || '?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm truncate">{m.name || '사용자'}</span>
                            {!m.readByAdmin && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                            <span className="text-[10px] text-[var(--color-text-secondary)] opacity-50 ml-auto flex-shrink-0">{timeLabel(m)}</span>
                          </div>
                          <p className="text-xs text-[var(--color-text-secondary)] opacity-80 mt-0.5 truncate">{m.text}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 특정 사용자와의 대화(스레드 + 답장) */}
      <AnimatePresence>
        {active && (
          <ThreadModal
            deviceId={active.deviceId}
            name={active.name}
            getTel={getTel}
            onClose={() => { setActive(null); poll() }}
          />
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}

// ── 대화 스레드 모달 (소유자 ↔ 특정 사용자) ─────────────────────────────────

function ThreadModal({
  deviceId, name, getTel, onClose,
}: {
  deviceId: string
  name: string
  getTel: () => Promise<TelemetryModule | null>
  onClose: () => void
}) {
  const [thread, setThread] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  // 스레드를 불러와 상태에 반영하고, 안 읽은 사용자 메시지를 읽음 처리한다.
  const reload = useCallback(async (): Promise<ChatMessage[]> => {
    const tel = await getTel()
    if (!tel) return []
    const msgs = await tel.getMessagesForUser(deviceId)
    const unreadIds = msgs.filter((m) => m.from === 'user' && !m.readByAdmin).map((m) => m.id)
    if (unreadIds.length > 0) tel.markUserMessagesRead(deviceId, unreadIds).catch(() => {})
    return msgs
  }, [deviceId, getTel])

  useEffect(() => {
    let cancelled = false
    reload()
      .then((msgs) => { if (!cancelled) setThread(msgs) })
      .catch(() => { if (!cancelled) setThread([]) })
    return () => { cancelled = true }
  }, [reload])

  async function handleSend() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const tel = await getTel()
      if (tel) await tel.sendMessageToUser(deviceId, body)
      setText('')
      setThread(await reload())
    } catch {
      // 무시
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[8200] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="relative w-full max-w-md glass-card rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 bg-gradient-to-br from-indigo-500 to-purple-600">
            {name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black truncate">{name}</h2>
            <p className="text-[10px] text-[var(--color-text-secondary)] opacity-50 font-mono truncate">{deviceId}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/10 transition-all">
            <Icon icon="mdi:close" className="text-xl" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {thread === null ? (
            <div className="text-center py-16 text-[var(--color-text-secondary)] opacity-50">
              <Icon icon="mdi:loading" className="text-4xl animate-spin" />
            </div>
          ) : thread.length === 0 ? (
            <div className="text-center py-16 text-[var(--color-text-secondary)] opacity-50">
              <Icon icon="mdi:message-outline" className="text-4xl mb-2" />
              <p className="text-sm">첫 메시지를 보내보세요.</p>
            </div>
          ) : (
            thread.map((m) => {
              const mine = m.from === 'admin'
              return (
                <div key={m.id} className={`flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    mine
                      ? 'rounded-tr-sm bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                      : 'rounded-tl-sm bg-white/8 border border-white/10 text-[var(--color-text)]'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-secondary)] opacity-50 px-1">{timeLabel(m)}</span>
                </div>
              )
            })
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="메시지를 입력하세요…"
            rows={1}
            maxLength={2000}
            className="flex-1 px-4 py-3 rounded-2xl bg-white/10 border border-white/20 text-sm text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)] resize-none max-h-32"
          />
          <Pressable
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 disabled:opacity-40 flex-shrink-0"
            aria-label="보내기"
          >
            <Icon icon={sending ? 'mdi:loading' : 'mdi:send'} className={`text-xl ${sending ? 'animate-spin' : ''}`} />
          </Pressable>
        </div>
      </motion.div>
    </div>
  )
}
