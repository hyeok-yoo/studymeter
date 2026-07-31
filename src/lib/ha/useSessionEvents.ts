/**
 * useSessionEvents — 공부 세션의 변화를 HA 로 흘려보낸다.
 *
 * RoomPanel 의 useHomeAssistant 와 따로 두는 이유:
 *  이벤트 발신은 REST 한 방이면 끝나고 상태 구독이 필요 없다. 여기서 훅을
 *  또 쓰면 같은 화면에서 WebSocket 이 두 개 열린다.
 *
 * 실패는 삼킨다. 집 밖이거나 HA 가 꺼져 있어도 공부는 계속돼야 하고,
 * 알림 하나 못 보냈다고 타이머를 방해할 이유가 없다.
 */
import { useCallback, useEffect, useRef } from 'react';
import { fireEvent } from './client';
import { isHaConfigured, type HaConfig } from './types';

export const SESSION_EVENT = 'studymeter_session';

export type SessionAction = 'start' | 'pause' | 'resume' | 'subject_change' | 'end';

export interface SessionPayload {
    subject: string;
    type: string;
    subItem?: string;
    /** 카운트다운(테스트) 총 시간 ms. 0이면 일반 세션 */
    countdownMs?: number;
    /** 세션 경과 ms — end 에서 특히 의미가 있다 */
    elapsedMs?: number;
}

export function useSessionEvents(config: HaConfig | undefined) {
    // 최신 설정을 ref 로 들고 있어야 send 가 매번 새로 만들어지지 않는다
    const cfgRef = useRef(config);
    useEffect(() => {
        cfgRef.current = config;
    }, [config]);

    return useCallback((action: SessionAction, payload: SessionPayload) => {
        const cfg = cfgRef.current;
        if (!isHaConfigured(cfg)) return;
        void fireEvent(cfg.localUrl, cfg.token, SESSION_EVENT, { action, ...payload })
            .catch(() => {
                // 집 밖·HA 다운·CORS 미설정 — 어느 쪽이든 공부를 막지 않는다
            });
    }, []);
}
