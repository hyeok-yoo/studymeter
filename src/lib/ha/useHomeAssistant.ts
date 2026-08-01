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
import { clampColorTempKelvin, type LightPresetValue } from './presets';
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
    /** 색온도 + 밝기를 turn_on 한 번에 실어 보낸다 (과목 프리셋) */
    applyLightPreset(preset: LightPresetValue, entityIds?: string[]): Promise<void>;
    moveDesk(position: number): Promise<void>;
    setClimateTemperature(target: number): Promise<void>;
    setClimateMode(mode: string): Promise<void>;
    /** 바람 세기 — 고를 수 있는 값은 엔티티의 fan_modes 가 알려준다 */
    setFanMode(mode: string): Promise<void>;
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
    /**
     * 최신 상태의 거울. 프리셋 클램프는 조명의 min/max_color_temp_kelvin 을 봐야 하는데,
     * states 를 actions 의존성에 넣으면 값이 바뀔 때마다 액션 객체가 통째로 새로 만들어진다.
     */
    const statesRef = useRef<HaStateMap>({});
    useEffect(() => {
        statesRef.current = states;
    }, [states]);

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

    const actions = useMemo<HaActions>(() => {
        // color_temp(mireds)는 2026.3 에서 제거됐다 — 켈빈만 쓴다.
        // 조명마다 낼 수 있는 켈빈 범위가 다르므로 각자 클램프하고, 같은 값이 된 것끼리
        // 묶어서 호출한다 (보통 한 번으로 끝난다).
        const applyLightPreset = (preset: LightPresetValue, ids?: string[]) =>
            guard(async () => {
                const targets = ids ?? (config?.entities.lights ?? [])
                    .filter(l => l.supportsColorTemp)
                    .map(l => l.entityId);
                if (!targets.length) return;

                const byKelvin = new Map<number, string[]>();
                for (const id of targets) {
                    const k = clampColorTempKelvin(preset.colorTempK, statesRef.current[id]);
                    const bucket = byKelvin.get(k);
                    if (bucket) bucket.push(id);
                    else byKelvin.set(k, [id]);
                }

                const { brightnessPct } = preset;
                for (const [k, entityIds] of byKelvin) {
                    await callService(localUrl, token, 'light', 'turn_on', {
                        entity_id: entityIds,
                        color_temp_kelvin: k,
                        ...(brightnessPct != null
                            ? { brightness_pct: Math.round(Math.max(1, Math.min(100, brightnessPct))) }
                            : {}),
                    });
                }
            });

        return {
            toggleLight: (entityId) =>
                guard(() => callService(localUrl, token, 'light', 'toggle', { entity_id: entityId })),

            setLightBrightness: (entityId, pct) =>
                guard(() => callService(localUrl, token, 'light', 'turn_on', {
                    entity_id: entityId,
                    brightness_pct: Math.round(Math.max(1, Math.min(100, pct))),
                })),

            applyColorTemp: (kelvin, ids) => applyLightPreset({ colorTempK: kelvin }, ids),

            applyLightPreset,

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

            setFanMode: (mode) =>
                guard(async () => {
                    const climate = config?.entities.climate;
                    if (!climate) return;
                    await callService(localUrl, token, 'climate', 'set_fan_mode', {
                        entity_id: climate,
                        fan_mode: mode,
                    });
                }),

            sendSessionEvent: (action, payload = {}) =>
                guard(() => fireEvent(localUrl, token, 'studymeter_session', { action, ...payload })),
        };
    }, [guard, localUrl, token, config?.entities]);

    return { connection, states, actions, lastError };
}
