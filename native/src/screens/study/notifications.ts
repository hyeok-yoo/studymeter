/**
 * notifications.ts — 공부 중 지속(ongoing/sticky) 알림.
 *
 * 웹은 네이티브 브리지(Java Now Bar)로 sticky 알림을 띄웠다. Expo SDK 57 에서는
 * expo-notifications 로 같은 의도를 구현한다:
 *   - Android 채널을 IMPORTANCE.LOW 로 만들어 소리/헤드업 없이 상태바에만 조용히 상주.
 *   - content.sticky = true → Android setOngoing(true): 스와이프로 지워지지 않는 상주 알림.
 *   - autoDismiss = false → 탭해도 자동으로 사라지지 않는다(앱만 포그라운드로 복귀).
 *   - 같은 identifier 로 다시 scheduleNotificationAsync(trigger: null) → 기존 알림을
 *     "교체"(갱신)한다. 새 알림이 아니라 같은 알림이 갱신되므로 알림이 쌓이지 않는다.
 *
 * 갱신은 과도하지 않게 — 호출자(StudyScreen)가 시작/일시정지/재개 시점과 1분 간격
 * 타이머로만 present() 를 호출한다. (근거: expo-notifications 문서의 sticky/autoDismiss
 * 속성과 setNotificationChannelAsync/scheduleNotificationAsync trigger:null 즉시 표시.)
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'study-ongoing';
/** 항상 같은 식별자로 표시 → 갱신 시 새 알림이 아니라 기존 알림을 교체한다. */
const NOTIF_ID = 'study-ongoing-session';

let handlerReady = false;
let channelReady = false;

/** 포그라운드에서도 알림이 보이도록 핸들러 1회 설정. */
function ensureHandler(): void {
  if (handlerReady) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false, // 헤드업 배너 없이 조용히 (지속 알림이라 배너는 방해됨)
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerReady = true;
}

/** Android 알림 채널 1회 생성(LOW: 소리/헤드업 없음). */
async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: '공부 세션',
    importance: Notifications.AndroidImportance.LOW,
    sound: undefined,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

/** 알림 권한 요청. 허용되면 true. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    ensureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

export interface OngoingNotifOptions {
  subject: string;
  subItem?: string;
  type: string;
  /** 현재 세션 경과(ms). */
  elapsedMs: number;
  isRunning: boolean;
  /** 액센트 색(#RRGGBB). */
  color?: string;
}

/** ms → "H시간 M분" (분 단위, 지속 알림은 초까지 갱신하지 않는다). */
function formatMinuteLabel(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

/**
 * 지속 알림을 표시/갱신한다. 같은 NOTIF_ID 로 즉시(trigger:null) 표시하므로
 * 기존 알림이 교체된다. 실패는 조용히 무시(권한 미허용 등).
 */
export async function presentOngoing(opts: OngoingNotifOptions): Promise<void> {
  try {
    ensureHandler();
    await ensureChannel();
    const label = opts.subItem ? `${opts.subject} › ${opts.subItem}` : opts.subject;
    const status = opts.isRunning ? '공부 중' : '일시정지됨';
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID,
      content: {
        title: `${label} · ${opts.type}`,
        body: `${status} · ${formatMinuteLabel(opts.elapsedMs)}`,
        sticky: true, // Android setOngoing(true) — 스와이프로 안 지워짐
        autoDismiss: false,
        color: opts.color,
      },
      // Android: 채널을 지정해 즉시 표시(ChannelAwareTriggerInput). iOS: null=즉시.
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    /* ignore — 알림은 보조 기능이므로 실패해도 타이머는 계속 */
  }
}

/** 지속 알림 제거(세션 종료 시). */
export async function clearOngoing(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIF_ID);
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID);
  } catch {
    /* ignore */
  }
}
