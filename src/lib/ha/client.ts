/**
 * client.ts — Home Assistant REST 클라이언트 (제어 + 탐색 전용).
 *
 * 상태 "구독" 은 socket.ts 가 맡는다. REST 는 사람이 버튼을 눌렀을 때만 쓰므로
 * HA 에 상시 부하를 주지 않는다.
 */
import type { HaEntityOption, HaEntityState } from './types';

/** 집 판정은 빨리 실패해야 화면이 안 멈춘다. */
const PING_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 8000;

interface HaRestState {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
}

function normalizeBase(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

async function request<T>(
    baseUrl: string,
    token: string,
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${normalizeBase(baseUrl)}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(init.headers ?? {}),
            },
        });
        if (res.status === 401 || res.status === 403) {
            throw new HaAuthError('토큰이 거부되었습니다');
        }
        if (!res.ok) {
            throw new Error(`HA ${res.status} ${res.statusText}`);
        }
        // 서비스 호출은 빈 배열을 주기도 한다
        const text = await res.text();
        return (text ? JSON.parse(text) : null) as T;
    } finally {
        clearTimeout(timer);
    }
}

/** 토큰이 틀린 경우 — 재시도해도 소용없으니 따로 구분한다. */
export class HaAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'HaAuthError';
    }
}

/**
 * 도달 확인. 성공하면 "이 URL 로 HA 를 쓸 수 있다" 는 뜻이고,
 * 로컬 URL 로 성공했다면 곧 "집에 있다" 는 뜻이다.
 */
export async function ping(baseUrl: string, token: string): Promise<boolean> {
    if (!baseUrl.trim() || !token.trim()) return false;
    try {
        await request<{ message: string }>(baseUrl, token, '/api/', {}, PING_TIMEOUT_MS);
        return true;
    } catch (e) {
        if (e instanceof HaAuthError) throw e;
        return false;
    }
}

function toOption(s: HaRestState): HaEntityOption {
    const domain = s.entity_id.split('.')[0] ?? '';
    const modes = s.attributes.supported_color_modes;
    const supportsColorTemp = Array.isArray(modes) && modes.includes('color_temp');
    return {
        entityId: s.entity_id,
        name: (s.attributes.friendly_name as string) || s.entity_id,
        domain,
        deviceClass: s.attributes.device_class as string | undefined,
        supportsColorTemp,
    };
}

/** 설정 화면의 엔티티 선택기용 목록. 설정을 열 때 한 번만 부른다. */
export async function fetchEntityOptions(baseUrl: string, token: string): Promise<HaEntityOption[]> {
    const states = await request<HaRestState[]>(baseUrl, token, '/api/states');
    return (states ?? []).map(toOption).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 단건 상태 조회 — 소켓이 붙기 전 초기 표시에만 쓴다. */
export async function fetchState(
    baseUrl: string,
    token: string,
    entityId: string,
): Promise<HaEntityState | null> {
    try {
        const s = await request<HaRestState>(baseUrl, token, `/api/states/${entityId}`);
        if (!s) return null;
        return { entityId: s.entity_id, state: s.state, attributes: s.attributes ?? {} };
    } catch {
        return null;
    }
}

/** 서비스 호출 — 조명·에어컨·책상 제어가 전부 이 경로를 탄다. */
export async function callService(
    baseUrl: string,
    token: string,
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    await request(baseUrl, token, `/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

/**
 * 커스텀 이벤트 발신. HA 자동화가 event_type 하나로 받아
 * 세션 시작/종료에 반응할 수 있게 한다.
 */
export async function fireEvent(
    baseUrl: string,
    token: string,
    eventType: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    await request(baseUrl, token, `/api/events/${eventType}`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}
