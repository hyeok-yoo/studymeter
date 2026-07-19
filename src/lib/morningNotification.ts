/**
 * morningNotification.ts — 아침 리포트 로컬 알림 스케줄러 (네이티브 전용).
 *
 * 매일 정해진 시각(morningReportHour, 기본 7시)에 "어제 분석이 준비됐어요" 알림을
 * 반복 예약한다. 웹/PWA 환경에서는 아무 것도 하지 않는다. 호출은 idempotent —
 * 매번 고정 id(9001)를 취소 후 다시 예약하므로 중복 알림이 쌓이지 않는다.
 */
import type { Settings } from './db';
import { NativeBridge } from './NativeBridge';

const MORNING_NOTIFICATION_ID = 9001;

export async function scheduleMorningReportNotification(settings: Settings): Promise<void> {
    if (!NativeBridge.isNative()) return;

    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');

        // 기존 예약은 항상 먼저 취소 (idempotent)
        await LocalNotifications.cancel({ notifications: [{ id: MORNING_NOTIFICATION_ID }] });

        // 알림 비활성화 상태면 취소만 하고 종료
        if (settings.morningReportEnabled === false) return;

        const perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') return;

        const hour = settings.morningReportHour ?? 7;

        await LocalNotifications.schedule({
            notifications: [
                {
                    id: MORNING_NOTIFICATION_ID,
                    title: '📊 어제 분석이 준비됐어요',
                    body: '탭해서 오늘의 브리핑을 확인하세요',
                    schedule: {
                        on: { hour, minute: 0 },
                        allowWhileIdle: true,
                    },
                },
            ],
        });
    } catch (e) {
        console.error('scheduleMorningReportNotification failed', e);
    }
}
