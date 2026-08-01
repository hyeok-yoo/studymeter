/**
 * presets.ts — 과목별 조명 프리셋 (기본 내장).
 *
 * 왜 기본값을 코드에 두는가:
 *  사용자가 과목마다 색온도를 직접 저장할 수 있지만, 처음 켰을 때 아무것도 없으면
 *  결국 감으로 고르게 된다. 아래 값은 조명·인지 연구에서 뽑은 출발점이고,
 *  사용자가 저장한 값이 있으면 언제나 그쪽이 이긴다.
 *
 * 여기에는 엔티티 ID 가 없다 — 프리셋은 "어떤 빛인지" 만 말하고,
 * "어느 조명인지" 는 전적으로 사용자 설정에서 온다.
 */
import type { HaEntityState } from './types';

/** 조명에 실제로 보낼 값. 밝기는 없을 수도 있다(사용자가 색온도만 저장한 경우). */
export interface LightPresetValue {
    colorTempK: number;
    brightnessPct?: number;
}

/** 과목명에 묶인 기본 프리셋. 기본값은 색온도와 밝기가 항상 함께 정해져 있다. */
export interface SubjectLightPresetDef extends LightPresetValue {
    /** 표시 이름 겸 기본 매칭 키 */
    subject: string;
    /** 밝기는 기본 프리셋에선 항상 있다 */
    brightnessPct: number;
    /** 과목명이 줄임말로 저장돼 있어도 찾히게 하는 별칭 (예: 사회문화 → 사문) */
    aliases?: string[];
}

/**
 * 기본 프리셋. 각 값의 근거는 옆 주석에 남긴다.
 * (수치는 "그 조명에서 가능한 범위" 안으로 clampColorTempKelvin 이 다시 깎는다)
 */
export const DEFAULT_SUBJECT_LIGHT_PRESETS: SubjectLightPresetDef[] = [
    // Mott et al. 2012: 고CCT가 읽기 유창성 향상. 80분 연속 독해라 6500K는 눈부심 피로 위험
    // → CCT는 중고역, 조도를 최대로 (Boyce: 작은 글씨 가독성은 조도가 지배 변수)
    { subject: '국어', colorTempK: 5000, brightnessPct: 100 },

    // Huiberts et al. 2015 / Keis et al. 2014: 청색강화광은 각성엔 유리하나 복잡 작업기억엔 역-U.
    // 중성백색 + 충분 조도
    { subject: '수학', colorTempK: 4300, brightnessPct: 90 },

    // 국어와 같은 독해 부하지만 70분으로 짧아 고CCT 각성 이득을 더 취한다
    { subject: '영어', colorTempK: 5300, brightnessPct: 95 },

    // 도표·자료해석 = 미세 시각 변별 과제 → 조도 최대가 핵심
    { subject: '사회문화', colorTempK: 5000, brightnessPct: 100, aliases: ['사문', '사회·문화', '사탐'] },

    // 모식도·그림 중심, 색 구분이 필요 → 중고역 CCT
    { subject: '지구과학', colorTempK: 4800, brightnessPct: 95, aliases: ['지구', '지과'] },

    // 저부하 반복 작업. 장시간 유지해도 피로가 덜 쌓이는 쪽으로 낮춘다
    { subject: '암기·복습', colorTempK: 4000, brightnessPct: 85, aliases: ['암기', '복습', '암기/복습'] },

    // Cajochen et al. 2005: 야간 단파장 노출이 멜라토닌 억제 → 취침 전 학습은 warm
    { subject: '야간', colorTempK: 3000, brightnessPct: 70, aliases: ['밤'] },

    // Choi & Suk 2016: 휴식기 저CCT가 회복에 유리
    { subject: '휴식', colorTempK: 2700, brightnessPct: 40, aliases: ['쉬는시간'] },
];

/** min/max_color_temp_kelvin 속성이 없는 조명에 쓸 보수적인 범위 (Hue 기준). */
const FALLBACK_KELVIN_MIN = 2000;
const FALLBACK_KELVIN_MAX = 6500;

function attrNumber(st: HaEntityState | undefined, key: string): number | undefined {
    const v = st?.attributes[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 조명이 실제로 낼 수 있는 범위로 켈빈을 깎는다.
 * 범위 밖 값을 그대로 보내면 HA 가 서비스 호출 자체를 에러로 되돌린다.
 */
export function clampColorTempKelvin(kelvin: number, st: HaEntityState | undefined): number {
    const min = attrNumber(st, 'min_color_temp_kelvin') ?? FALLBACK_KELVIN_MIN;
    const max = attrNumber(st, 'max_color_temp_kelvin') ?? FALLBACK_KELVIN_MAX;
    return Math.round(Math.max(min, Math.min(max, kelvin)));
}

/** 매칭용 정규화 — 공백/대소문자 차이로 프리셋을 놓치지 않게 한다. */
function normalize(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '');
}

function keysOf(def: SubjectLightPresetDef): string[] {
    return [def.subject, ...(def.aliases ?? [])].map(normalize);
}

/**
 * 과목명으로 기본 프리셋을 찾는다.
 * 1) 정확 일치(별칭 포함) → 2) 부분 문자열(양방향).
 * 양방향인 이유: "수학(미적분)" 처럼 뒤에 붙는 경우와 "지구" 처럼 줄여 쓰는 경우가 둘 다 있다.
 */
export function findDefaultPreset(subjectName: string): SubjectLightPresetDef | undefined {
    const name = normalize(subjectName);
    if (!name) return undefined;

    const exact = DEFAULT_SUBJECT_LIGHT_PRESETS.find(def => keysOf(def).includes(name));
    if (exact) return exact;

    return DEFAULT_SUBJECT_LIGHT_PRESETS.find(def =>
        keysOf(def).some(key => key.length >= 2 && (name.includes(key) || key.includes(name))),
    );
}
