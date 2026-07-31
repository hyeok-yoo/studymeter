/**
 * socket.ts — Home Assistant WebSocket 상태 구독.
 *
 * 왜 폴링이 아니라 소켓인가:
 *  폴링은 값이 안 변해도 주기마다 요청을 보낸다. subscribe_entities 는 값이
 *  바뀔 때만 델타를 보내므로 지연은 0 에 가깝고 유휴 시 트래픽은 0 이다.
 *  HA 가 저사양 호스트(시놀로지 VM) 위에 있어 이 차이가 그대로 체감된다.
 *
 * 수명 관리:
 *  앱이 백그라운드로 가면 stop() 으로 끊고, 돌아오면 start() 로 다시 붙는다.
 *  명시적으로 끊은 경우에는 자동 재연결하지 않는다 (24시간 연결 방지).
 */
import type { HaStateMap } from './types';

/** HA 압축 상태 포맷 — 대역폭을 아끼려고 키를 한 글자로 줄여 보낸다. */
interface CompressedState {
    s?: string;
    a?: Record<string, unknown>;
}

interface CompressedDelta {
    '+'?: CompressedState;
    '-'?: { a?: string[] };
}

interface SubscribeEvent {
    a?: Record<string, CompressedState>;
    c?: Record<string, CompressedDelta | CompressedState>;
    r?: string[];
}

type Listener = (states: HaStateMap) => void;
type StatusListener = (status: 'open' | 'closed' | 'auth-failed') => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

function toWsUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    const wsBase = trimmed.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${wsBase}/api/websocket`;
}

export class HaSocket {
    private ws: WebSocket | null = null;
    private msgId = 1;
    private states: HaStateMap = {};
    private listeners = new Set<Listener>();
    private statusListeners = new Set<StatusListener>();
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    /** stop() 으로 의도적으로 끊었는지 — true 면 재연결하지 않는다 */
    private stopped = true;
    private baseUrl: string;
    private token: string;
    private entityIds: string[];

    constructor(baseUrl: string, token: string, entityIds: string[]) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.entityIds = entityIds;
    }

    onStates(fn: Listener): () => void {
        this.listeners.add(fn);
        if (Object.keys(this.states).length) fn(this.states);
        return () => this.listeners.delete(fn);
    }

    onStatus(fn: StatusListener): () => void {
        this.statusListeners.add(fn);
        return () => this.statusListeners.delete(fn);
    }

    /** 구독 대상이 바뀌면(설정 변경) 재구독한다. */
    setEntityIds(ids: string[]) {
        const same = ids.length === this.entityIds.length && ids.every(id => this.entityIds.includes(id));
        if (same) return;
        this.entityIds = ids;
        if (!this.stopped) {
            this.closeSocket();
            this.connect();
        }
    }

    start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.reconnectAttempts = 0;
        this.connect();
    }

    stop() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.closeSocket();
        this.emitStatus('closed');
    }

    private closeSocket() {
        if (!this.ws) return;
        // 우리가 닫는 것이므로 onclose 의 재연결 경로를 타지 않게 핸들러를 먼저 뗀다
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        try {
            this.ws.close();
        } catch {
            /* 이미 닫힌 소켓 */
        }
        this.ws = null;
    }

    private connect() {
        if (this.stopped || !this.entityIds.length) return;
        let ws: WebSocket;
        try {
            ws = new WebSocket(toWsUrl(this.baseUrl));
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.ws = ws;

        ws.onmessage = (ev) => {
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(ev.data as string);
            } catch {
                return;
            }
            switch (msg.type) {
                case 'auth_required':
                    ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
                    break;
                case 'auth_ok':
                    this.reconnectAttempts = 0;
                    this.subscribe(ws);
                    this.emitStatus('open');
                    break;
                case 'auth_invalid':
                    // 토큰 문제는 재시도해도 같으므로 멈춘다
                    this.stopped = true;
                    this.emitStatus('auth-failed');
                    this.closeSocket();
                    break;
                case 'event':
                    this.applyEvent(msg.event as SubscribeEvent);
                    break;
            }
        };

        ws.onclose = () => {
            this.ws = null;
            this.emitStatus('closed');
            this.scheduleReconnect();
        };

        ws.onerror = () => {
            // onclose 가 이어서 오므로 재연결은 그쪽에서 처리한다
        };
    }

    private subscribe(ws: WebSocket) {
        ws.send(JSON.stringify({
            id: this.msgId++,
            type: 'subscribe_entities',
            entity_ids: this.entityIds,
        }));
    }

    private scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
        this.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    /**
     * 압축 이벤트를 펼쳐 상태 맵에 병합한다.
     *  a = 전체 스냅샷(구독 직후 1회), c = 변경 델타, r = 제거
     */
    private applyEvent(event: SubscribeEvent) {
        if (!event) return;
        let changed = false;
        const next: HaStateMap = { ...this.states };

        if (event.a) {
            for (const [entityId, s] of Object.entries(event.a)) {
                next[entityId] = {
                    entityId,
                    state: s.s ?? '',
                    attributes: s.a ?? {},
                };
                changed = true;
            }
        }

        if (event.c) {
            for (const [entityId, delta] of Object.entries(event.c)) {
                const prev = next[entityId] ?? { entityId, state: '', attributes: {} };
                const plus = ('+' in delta ? delta['+'] : delta) as CompressedState | undefined;
                const minus = ('-' in delta ? delta['-'] : undefined) as { a?: string[] } | undefined;

                const attributes = { ...prev.attributes, ...(plus?.a ?? {}) };
                for (const key of minus?.a ?? []) delete attributes[key];

                next[entityId] = {
                    entityId,
                    state: plus?.s ?? prev.state,
                    attributes,
                };
                changed = true;
            }
        }

        if (event.r) {
            for (const entityId of event.r) {
                delete next[entityId];
                changed = true;
            }
        }

        if (!changed) return;
        this.states = next;
        for (const fn of this.listeners) fn(this.states);
    }

    private emitStatus(status: 'open' | 'closed' | 'auth-failed') {
        for (const fn of this.statusListeners) fn(status);
    }
}
