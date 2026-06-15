import { StatusBar, Style } from '@capacitor/status-bar';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface NowBarPlugin {
    startNowBar(options: { subject: string; startTime: number; isRunning: boolean; totalStudyMs: number; subjectStudyMs: number }): Promise<void>;
    stopNowBar(): Promise<void>;
    updateNowBar(options: { subject: string; startTime: number; isRunning: boolean; totalStudyMs: number; subjectStudyMs: number }): Promise<void>;
    checkPermissions(): Promise<{ display: PermissionState }>;
    requestPermissions(): Promise<{ display: PermissionState }>;
    addListener(eventName: 'timerAction', listenerFunc: (info: { action: string }) => void): Promise<import('@capacitor/core').PluginListenerHandle>;
}

const NowBar = registerPlugin<NowBarPlugin>('NowBar');

/** 디바이스 벨소리 모드 조회용 네이티브 플러그인. */
interface DeviceSoundPlugin {
    getRingerMode(): Promise<{ mode: 'normal' | 'vibrate' | 'silent' }>;
}

const DeviceSound = registerPlugin<DeviceSoundPlugin>('DeviceSound');

export type RingerMode = 'normal' | 'vibrate' | 'silent';

export const NativeBridge = {
    isNative: () => Capacitor.isNativePlatform(),

    /**
     * 상태바 색상 업데이트 (네이티브 전용)
     */
    async setStatusBarColor(color: string, isLight: boolean) {
        if (!this.isNative()) return;
        try {
            await StatusBar.setBackgroundColor({ color });
            await StatusBar.setStyle({
                style: isLight ? Style.Light : Style.Dark
            });
        } catch (e) {
            console.error('StatusBar update failed', e);
        }
    },

    /**
     * 화면 꺼짐 방지 활성화 (네이티브 전용)
     */
    async keepAwake() {
        if (!this.isNative()) return;
        try {
            await KeepAwake.keepAwake();
        } catch (e) {
            console.error('KeepAwake failed', e);
        }
    },

    /**
     * 화면 꺼짐 방지 해제 (네이티브 전용)
     */
    async allowSleep() {
        if (!this.isNative()) return;
        try {
            await KeepAwake.allowSleep();
        } catch (e) {
            console.error('AllowSleep failed', e);
        }
    },

    /**
     * 상단바 숨기기 (몰입형 모드)
     */
    async hideStatusBar() {
        if (!this.isNative()) return;
        try {
            await StatusBar.hide();
        } catch (e) {
            console.error('StatusBar hide failed', e);
        }
    },

    /**
     * 상단바 보이기
     */
    async showStatusBar() {
        if (!this.isNative()) return;
        try {
            await StatusBar.show();
        } catch (e) {
            console.error('StatusBar show failed', e);
        }
    },

    /**
     * Now Bar 알림 시작
     */
    async startNowBar(subject: string, startTime: number, isRunning: boolean, totalStudyMs: number = 0, subjectStudyMs: number = 0) {
        if (!this.isNative()) return;
        try {
            await NowBar.startNowBar({ subject, startTime, isRunning, totalStudyMs, subjectStudyMs });
        } catch (e) {
            console.error('StartNowBar failed', e);
        }
    },

    /**
     * Now Bar 알림 종료
     */
    async stopNowBar() {
        if (!this.isNative()) return;
        try {
            await NowBar.stopNowBar();
        } catch (e) {
            console.error('StopNowBar failed', e);
        }
    },

    /**
     * Now Bar 알림 업데이트 (과목 변경, 일시정지/재개 시)
     */
    async updateNowBar(subject: string, startTime: number, isRunning: boolean, totalStudyMs: number = 0, subjectStudyMs: number = 0) {
        if (!this.isNative()) return;
        try {
            await NowBar.updateNowBar({ subject, startTime, isRunning, totalStudyMs, subjectStudyMs });
        } catch (e) {
            console.error('UpdateNowBar failed', e);
        }
    },

    /**
     * 알림 권한 확인 및 요청
     */
    async requestNotificationPermission() {
        if (!this.isNative()) return true;
        try {
            const { display } = await NowBar.checkPermissions();
            if (display !== 'granted') {
                const { display: newDisplay } = await NowBar.requestPermissions();
                return newDisplay === 'granted';
            }
            return true;
        } catch (e) {
            console.error('Permission request failed', e);
            return false;
        }
    },
    
    /**
     * 디바이스 벨소리 모드 조회.
     * - 'normal'  : 소리 켜짐 → 졸음 경고를 소리로
     * - 'vibrate' : 진동 모드 → 진동으로
     * - 'silent'  : 무음 모드 → 출력 없음(팝업만)
     * 웹/비네이티브 또는 플러그인 미탑재 시 'normal' 로 폴백한다.
     */
    async getRingerMode(): Promise<RingerMode> {
        if (!this.isNative()) return 'normal';
        try {
            const { mode } = await DeviceSound.getRingerMode();
            return mode ?? 'normal';
        } catch (e) {
            console.error('getRingerMode failed', e);
            return 'normal';
        }
    },

    /**
     * 알림 액션 리스너 등록
     */
    async addTimerActionListener(callback: (action: string) => void) {
        if (!this.isNative()) return null;
        try {
            return await NowBar.addListener('timerAction', (info) => {
                callback(info.action);
            });
        } catch (e) {
            console.error('Add listener failed', e);
            return null;
        }
    }
};
