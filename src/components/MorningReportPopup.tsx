/**
 * MorningReportPopup.tsx — 그날 첫 아침 브리핑이 준비되면 어떤 화면에서든(공부 중 포함)
 * 1회 띄우는 앱 전역 팝업.
 *
 * App 루트에 마운트된다. 동작:
 *  - 앰비언트 AI + 아침 리포트가 켜져 있을 때, 앱 실행 시 백그라운드(포그라운드 비동기)로
 *    generateMorningReport 를 호출한다 (캐시 우선, in-flight 공유로 홈 카드와 이중 호출 없음).
 *  - 내용이 준비되면 하루 1회(localStorage 플래그) 팝업으로 표시한다.
 *  - 졸음 경고(z-10000)보다 아래(z-9000)에 두어 안전 경고를 가리지 않는다.
 */
import { useState, useEffect } from 'react'
import { Icon } from '@iconify/react'
import type { Settings } from '../lib/db'
import { getTodayDate } from '../lib/db'
import { isAmbientAiEnabled, generateMorningReport, morningReportKindFor } from '../lib/ai/aiService'
import AiMarkdown from './AiMarkdown'
import Modal from './ui/Modal'
import Pressable from './ui/Pressable'

const SEEN_KEY_PREFIX = 'studymeter_morning_popup_'

interface MorningReportPopupProps {
    settings: Settings
}

export default function MorningReportPopup({ settings }: MorningReportPopupProps) {
    const [content, setContent] = useState<string | null>(null)
    const [open, setOpen] = useState(false)
    const today = getTodayDate()
    const kind = morningReportKindFor(today)
    const title = kind === 'weekly-report' ? '주간 리뷰가 도착했어요' : '오늘의 브리핑이 도착했어요'

    useEffect(() => {
        if (!isAmbientAiEnabled(settings) || settings.morningReportEnabled === false) return
        let seen = false
        try { seen = !!localStorage.getItem(SEEN_KEY_PREFIX + today) } catch { /* ignore */ }
        if (seen) return

        let cancelled = false
        ;(async () => {
            const report = await generateMorningReport(settings)
            if (cancelled || !report) return
            // 준비 완료 → 하루 1회 팝업
            try { localStorage.setItem(SEEN_KEY_PREFIX + today, '1') } catch { /* ignore */ }
            setContent(report)
            setOpen(true)
        })()
        return () => { cancelled = true }
        // 하루 1회 로직이므로 날짜가 바뀔 때만 다시 시도한다
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [today, settings.geminiApiKey, settings.aiAmbientEnabled, settings.morningReportEnabled])

    if (!open || !content) return null

    return (
        // 졸음 경고(10000)·다른 전역 팝업보다 아래에 오도록 9000 을 유지한다.
        <Modal
            open={open}
            onClose={() => setOpen(false)}
            width="max-w-md"
            zIndex={9000}
            scrim="bg-black/60 backdrop-blur-lg"
            className="overflow-hidden"
            ariaLabel={title}
        >
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-amber-400/10 to-transparent" />
            <div className="relative p-6 sm:p-8 flex flex-col gap-4 max-h-[80vh]">
                <header className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 flex-shrink-0">
                        <Icon icon={kind === 'weekly-report' ? 'mdi:chart-timeline-variant' : 'mdi:weather-sunset-up'} className="text-xl text-white" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-[var(--color-text)] leading-tight">{title}</h2>
                        <p className="text-[11px] font-bold text-[var(--color-text-secondary)]">홈 화면에서 언제든 다시 볼 수 있어요</p>
                    </div>
                </header>

                <div className="overflow-y-auto no-scrollbar text-sm text-[var(--color-text)]/90 pr-1">
                    <AiMarkdown>{content}</AiMarkdown>
                </div>

                <Pressable
                    onClick={() => setOpen(false)}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-amber-500/25"
                >
                    확인했어요
                </Pressable>
            </div>
        </Modal>
    )
}
