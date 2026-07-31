/**
 * useHomeAssistant.ts — 방 상태 구독 + 제어를 한 곳에 모은 훅.
 *
 * 수명:
 *  화면이 살아 있고 앱이 포그라운드일 때만 소켓을 연다. 백그라운드로 가면
 *  즉시 끊고, 돌아오면 다시 붙는다. 화면을 벗어나도 정리된다.
 *
 * 집 판정:
 *  로컬 URL 에 도달하면 'home'. 실패하면 'away' 이고, 이 경우 호출부는
 *  방 UI 자체를 렌더하지 않는다 (숨김이 아니라 마운트 안 함).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { HaSocket } from './socket';
import { callService, fireEvent, ping, HaAuthError } from './client';
import { isHaConfigured, type HaConfig, type HaConnection, type HaStateMap } from './types';

/** 설정에서 실제로 고른 엔티티만 구독한다 — 안 쓰는 건 트래픽도 만들지 않는다. */
function collectEntityIds(cfg: HaConfig): string[] {
    const e = cfg.entities;
    const ids = [
        ...e.lights.map(l => l.entityId),
        e.temperature,
        e.humidity,
        e.co2,
        e.illuminance,
        e.deskHeight,
        e.deskCover,
        e.climate,
    ].filter((v): v is string => !!v);
    return Array.from(new Set(ids));
}

export interface HaActions {
    toggleLight(entityId: string): Promise<void>;
    setLightBrightness(entityId: string, pct: number): Promise<void>;
    applyColorTemp(kelvin: number, entityIds?: string[]): Promise<void>;
    moveDesk(position: number): Promise<void>;
    setClimateTemperature(target: number): Promise<void>;
    setClimateMode(mode: string): Promise<void>;
    sendSessionEvent(action: string, payload?: Record<string, unknown>): Promise<void>;
}

export interface UseHomeAssistantResult {
    connection: HaConnection;
    states: HaStateMap;
    actions: HaActions;
    /** 마지막 제어 실패 메시지 — 토스트 없이 패널에 조용히 표시한다 */
    lastError: string | null;
}

export function useHomeAssistant(config: HaConfig | undefined): UseHomeAssistantResult {
    const [connection, setConnection] = useState<HaConnection>('disabled');
    const [states, setStates] = useState<HaStateMap>({});
    const [lastError, setLastError] = useState<string | null>(null);
    const socketRef = useRef<HaSocket | null>(null);

    const configured = isHaConfigured(config);
    const localUrl = config?.localUrl ?? '';
    const token = config?.token ?? '';

    // 구독 대상은 설정이 바뀔 때만 다시 계산한다
    const entityIds = useMemo(
        () => (configured ? collectEntityIds(config) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [configured, config ? JSON.stringify(config.entities) : ''],
    );

    useEffect(() => {
        if (!configured) {
            setConnection('disabled');
            setStates({});
            return;
        }

        let cancelled = false;
        let socket: HaSocket | null = null;
        let removeAppListener: (() => void) | undefined;
        let removeVisibility: (() => void) | undefined;

        const boot = async () => {
            setConnection('connecting');
            let reachable = false;
            try {
                reachable = await ping(localUrl, token);
            } catch (e) {
                if (e instanceof HaAuthError) {
                    if (!cancelled) {
                        setConnection('error');
                        setLastError('토큰이 거부되었습니다. 설정에서 다시 발급해 주세요.');
                    }
                    return;
                }
            }
            if (cancelled) return;

            if (!reachable) {
                // 로컬에 못 붙었다 = 집이 아니다. 원격 폴백으로 붙더라도 집은 아니므로
                // 방 제어 UI 는 띄우지 않는다.
                setConnection('away');
                setStates({});
                return;
            }

            setConnection('home');
            socket = new HaSocket(localUrl, token, entityIds);
            socketRef.current = socket;
            socket.onStates(next => {
                if (!cancelled) setStates(next);
            });
            socket.onStatus(status => {
                if (cancelled) return;
                if (status === 'auth-failed') {
                    setConnection('error');
                    setLastError('토큰이 거부되었습니다. 설정에서 다시 발급해 주세요.');
                }
            });
            socket.start();

            // 포그라운드일 때만 소켓을 유지한다
            if (Capacitor.isNativePlatform()) {
                const handle = await App.addListener('appStateChange', ({ isActive }) => {
                    if (isActive) socket?.start();
                    else socket?.stop();
                });
                removeAppListener = () => { void handle.remove(); };
            } else {
                const onVisibility = () => {
                    if (document.visibilityState === 'visible') socket?.start();
                    else socket?.stop();
                };
                document.addEventListener('visibilitychange', onVisibility);
                removeVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
            }
        };

        void boot();

        return () => {
            cancelled = true;
            removeAppListener?.();
            removeVisibility?.();
            socket?.stop();
            socketRef.current = null;
        };
    }, [configured, localUrl, token, entityIds]);

    const guard = useCallback(
        async (fn: () => Promise<void>) => {
            if (!configured) return;
            try {
                await fn();
                setLastError(null);
            } catch (e) {
                setLastError(e instanceof Error ? e.message : '제어에 실패했습니다');
            }
        },
        [configured],
    );

    const actions = useMemo<HaActions>(() => ({
        toggleLight: (entityId) =>
            guard(() => callService(localUrl, token, 'light', 'toggle', { entity_id: entityId })),

        setLightBrightness: (entityId, pct) =>
            guard(() => callService(localUrl, token, 'light', 'turn_on', {
                entity_id: entityId,
                brightness_pct: Math.round(Math.max(1, Math.min(100, pct))),
            })),

        // color_temp(mireds)는 2026.3 에서 제거됐다 — 켈빈만 쓴다
        applyColorTemp: (kelvin, ids) =>
            guard(async () => {
                const targets = ids ?? (config?.entities.lights ?? [])
                    .filter(l => l.supportsColorTemp)
                    .map(l => l.entityId);
                if (!targets.length) return;
                await callService(localUrl, token, 'light', 'turn_on', {
                    entity_id: targets,
                    color_temp_kelvin: Math.round(kelvin),
                });
            }),

        moveDesk: (position) =>
            guard(async () => {
                const cover = config?.entities.deskCover;
                if (!cover) return;
                await callService(localUrl, token, 'cover', 'set_cover_position', {
                    entity_id: cover,
                    position: Math.round(Math.max(0, Math.min(100, position))),
                });
            }),

        setClimateTemperature: (target) =>
            guard(async () => {
                const climate = config?.entities.climate;
                if (!climate) return;
                await callService(localUrl, token, 'climate', 'set_temperature', {
                    entity_id: climate,
                    temperature: target,
                });
            }),

        setClimateMode: (mode) =>
            guard(async () => {
                const climate = config?.entities.climate;
                if (!climate) return;
                await callService(localUrl, token, 'climate', 'set_hvac_mode', {
                    entity_id: climate,
                    hvac_mode: mode,
                });
            }),

        sendSessionEvent: (action, payload = {}) =>
            guard(() => fireEvent(localUrl, token, 'studymeter_session', { action, ...payload })),
    }), [guard, localUrl, token, config?.entities]);

    return { connection, states, actions, lastError };
}
