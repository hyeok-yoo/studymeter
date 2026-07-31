/**
 * types.ts — Home Assistant 연동 타입.
 *
 * 설계 원칙:
 *  - 엔티티 ID 는 절대 하드코딩하지 않는다. 전부 사용자가 설정에서 고른 값이다.
 *  - "집에 있는지" 는 로컬 URL 도달 여부로 판정한다. 원격 URL 로 붙은 경우는
 *    집이 아니므로 방 제어 UI 를 띄우지 않는다.
 */

/** 조명 하나의 매핑. 이름은 표시용이라 HA 의 friendly_name 을 그대로 받아둔다. */
export interface HaLightRef {
    entityId: string;
    name: string;
    /** 색온도 지원 여부 — 과목 프리셋 적용 대상 판정에 쓴다 */
    supportsColorTemp?: boolean;
}

/** 사용자가 설정에서 고른 엔티티들. 모두 선택 사항 — 고른 것만 UI 에 나온다. */
export interface HaEntityMap {
    lights: HaLightRef[];
    temperature?: string;
    humidity?: string;
    co2?: string;
    illuminance?: string;
    /** 책상 높이 "표시" 전용 센서 (제어는 deskCover 로 한다) */
    deskHeight?: string;
    /** 책상 제어용 cover */
    deskCover?: string;
    climate?: string;
}

/** 책상 프리셋 위치 (cover position %). 사용자 책상 실측값이 기본값이다. */
export interface HaDeskPositions {
    sit: number;
    stand: number;
}

export interface HaConfig {
    enabled: boolean;
    /** 집 판정 겸 주 통신 경로. 예: http://192.168.0.10:8123 (설정에서 입력) */
    localUrl: string;
    /** 선택적 폴백. 밖에서도 붙지만 이 경로로 붙으면 집으로 치지 않는다. */
    remoteUrl?: string;
    token: string;
    entities: HaEntityMap;
    desk: HaDeskPositions;
    /** CO2 경고 임계 (ppm) */
    co2Warn: number;
    /** 이슬점 경고 임계 (°C) — 습도 칩 색 판정에 쓴다 */
    dewPointWarn: number;
}

export const DEFAULT_HA_CONFIG: HaConfig = {
    enabled: false,
    localUrl: '',
    remoteUrl: '',
    token: '',
    entities: { lights: [] },
    desk: { sit: 12, stand: 68 },
    co2Warn: 1000,
    dewPointWarn: 18,
};

/** HA 엔티티의 현재 상태. WebSocket 압축 포맷을 펼쳐서 이 형태로 보관한다. */
export interface HaEntityState {
    entityId: string;
    state: string;
    attributes: Record<string, unknown>;
}

export type HaStateMap = Record<string, HaEntityState>;

/** 연결 단계. 'home' 이어야만 방 제어 UI 를 그린다. */
export type HaConnection =
    | 'disabled'      // 설정이 꺼져 있거나 미완성
    | 'connecting'
    | 'home'          // 로컬 URL 도달 = 집
    | 'away'          // 로컬 URL 실패 = 집 밖
    | 'error';        // 인증 실패 등 사용자가 고쳐야 하는 상태

/** 설정 화면의 엔티티 선택기에 넘길 후보. */
export interface HaEntityOption {
    entityId: string;
    name: string;
    domain: string;
    deviceClass?: string;
    supportsColorTemp?: boolean;
}

/** 설정이 제어를 시도할 수 있는 최소 조건을 갖췄는지. */
export function isHaConfigured(cfg: HaConfig | undefined): cfg is HaConfig {
    return !!cfg?.enabled && !!cfg.localUrl.trim() && !!cfg.token.trim();
}

/**
 * 이슬점 (Magnus 근사). 상대습도는 온도에 따라 의미가 달라지지만
 * 이슬점은 절대값이라 "끈적한지" 를 바로 말해준다.
 */
export function dewPoint(tempC: number, humidityPct: number): number | null {
    if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct) || humidityPct <= 0) return null;
    const a = 17.27;
    const b = 237.7;
    const gamma = Math.log(humidityPct / 100) + (a * tempC) / (b + tempC);
    return (b * gamma) / (a - gamma);
}
