/**
 * UserMessagePopup.tsx — 관리자가 보낸 메시지를 일반 사용자 화면에 띄우는 전역 팝업.
 *
 * App 루트에 마운트된다. 동작:
 *  - 마운트 시 + 약 45초마다 getUnreadAdminMessages() 로 안 읽은 관리자 메시지를 확인한다.
 *  - 메시지가 있으면 큐로 하나씩 표시하고, 아래 답장 입력창(보내기)으로 sendMessageFromUser() 한다.
 *  - 표시한 관리자 메시지는 읽음 처리(markAdminMessagesRead)한다.
 *  - 소유자이거나 메시지가 없으면 아무것도 렌더링하지 않는다.
 *  - Firebase 미설정/오프라인이어도 절대 크래시하지 않는다.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Icon } from '@iconify/react'
import { materialize } from '../lib/motion'
import Pressable from './ui/Pressable'

const POLL_INTERVAL = 45 * 1000

type TelemetryModule = typeof import('../lib/telemetry')
type ChatMessage = import('../lib/telemetry').ChatMessage

export default function UserMessagePopup() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
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
      if (typeof tel.isOwner === 'function' && tel.isOwner()) return
      const unread = await tel.getUnreadAdminMessages()
      if (unread.length > 0) {
        setMessages(unread)
        setOpen(true)
        setSent(false)
        // 표시하는 즉시 읽음 처리 (팝업을 봤다고 간주)
        tel.markAdminMessagesRead(unread.map((m) => m.id)).catch(() => {})
      }
    } catch {
      // 무시
    }
  }, [getTel])

  useEffect(() => {
    let cancelled = false
    // 첫 진입은 살짝 지연시켜 로그인/폰트 로딩과 겹치지 않게 한다
    const kickoff = setTimeout(() => { if (!cancelled) poll() }, 2500)
    const interval = setInterval(() => { if (!cancelled) poll() }, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }, [poll])

  async function handleSend() {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const tel = await getTel()
      if (tel) await tel.sendMessageFromUser(text)
      setReply('')
      setSent(true)
    } catch {
      // 무시
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    setOpen(false)
    setReply('')
    setSent(false)
    setMessages([])
  }

  if (!open || messages.length === 0) return null

  const timeLabel = (m: ChatMessage) => {
    try {
      return m.createdAt?.toDate?.().toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }) ?? ''
    } catch { return '' }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-lg"
            onClick={handleClose}
          />
          <motion.div
            variants={materialize}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative w-full max-w-md liquid-modal shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-indigo-400/10 to-transparent" />
            <div className="relative p-6 sm:p-8 flex flex-col gap-4 max-h-[85vh]">
              <header className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 flex-shrink-0">
                  <Icon icon="mdi:message-badge" className="text-xl text-white" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-[var(--color-text)] leading-tight">관리자 메시지</h2>
                  <p className="text-[11px] font-bold text-[var(--color-text-secondary)]">
                    {messages.length > 1 ? `${messages.length}개의 새 메시지` : '새 메시지가 도착했어요'}
                  </p>
                </div>
              </header>

              {/* 관리자 메시지 목록 */}
              <div className="overflow-y-auto no-scrollbar flex flex-col gap-2.5 pr-1">
                {messages.map((m) => (
                  <div key={m.id} className="flex flex-col gap-1">
                    <div className="self-start max-w-[85%] rounded-2xl rounded-tl-sm bg-white/8 border border-white/10 px-4 py-2.5">
                      <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{m.text}</p>
                    </div>
                    {timeLabel(m) && (
                      <span className="text-[10px] text-[var(--color-text-secondary)] opacity-50 pl-1">{timeLabel(m)}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* 답장 입력 */}
              {sent ? (
                <div className="flex items-center gap-2 text-sm font-bold text-green-400 justify-center py-2">
                  <Icon icon="mdi:check-circle" className="text-lg" />
                  답장을 보냈어요
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="답장을 입력하세요…"
                    rows={2}
                    maxLength={2000}
                    className="w-full px-4 py-3 rounded-2xl bg-white/10 border border-white/20 text-sm text-[var(--color-text)] placeholder-[var(--color-text-secondary)]/50 focus:outline-none focus:border-[var(--color-primary)] resize-none"
                  />
                  <Pressable
                    onClick={handleSend}
                    disabled={sending || !reply.trim()}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-500/25 disabled:opacity-40"
                  >
                    {sending ? '보내는 중…' : '보내기'}
                  </Pressable>
                </div>
              )}

              <button
                onClick={handleClose}
                className="text-xs font-bold text-[var(--color-text-secondary)] opacity-60 hover:opacity-100 transition-opacity py-1"
              >
                닫기
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
