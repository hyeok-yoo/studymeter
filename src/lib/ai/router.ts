/**
 * router.ts — AI 역할(role) → 모델 라우팅.
 *
 * 원칙:
 *  - 기능은 모델을 직접 고르지 않고 역할(deep/interactive/ambient)만 선언한다.
 *  - 역할 기본값은 별칭(-latest) 우선: 모델 세대가 바뀌어도 앱 수정 없이 따라간다.
 *  - 쿼터 숫자는 저장하지 않는다. 429 를 만나면 그 모델을 "오늘 소진"으로 마킹하고
 *    체인의 다음 후보로 넘어간다 (Gemini 무료 쿼터는 태평양 시간 자정 리셋).
 *  - 능력 제약(함수 호출 등)이 쿼터보다 우선한다: 미지원 모델은 후보에서 제외.
 */
import type { AiRole, Settings } from '../db';
import type { GeminiModel } from '../gemini';
import { fetchGeminiModels } from '../gemini';

export interface RoleProfile {
    /** 우선 별칭/ID (목록에 존재하는 것만 사용) */
    preferredIds: Array<string | RegExp>;
    /** 함수 호출이 필요한 경우 지원 모델로만 체인 구성 */
    needsFunctionCalling?: boolean;
    thinkingLevel: 'off' | 'low' | 'high';
}

/** 역할별 프로파일. 별칭 기본값: deep=flash-latest, interactive=flash-lite-latest, ambient=Gemma 4 31B */
export const ROLE_PROFILES: Record<AiRole, RoleProfile> = {
    deep: {
        preferredIds: ['gemini-flash-latest', /gemini-.*flash(?!-lite)/],
        thinkingLevel: 'high',
    },
    interactive: {
        preferredIds: ['gemini-flash-lite-latest', /gemini-.*flash-lite/, 'gemini-flash-latest'],
        thinkingLevel: 'low',
    },
    ambient: {
        preferredIds: [/gemma-?4.*31b/i, /gemma/i, 'gemini-flash-lite-latest'],
        thinkingLevel: 'off',
    },
};

/** 이름 기반 능력 추정: Gemma 계열은 함수 호출·그라운딩 미지원으로 간주. */
export function supportsFunctionCalling(modelId: string): boolean {
    return !/gemma/i.test(modelId);
}

// ── 소진(429) 마킹: 태평양 시간 자정 리셋 ──────────────────────────────────

const EXHAUSTED_KEY = 'studymeter_ai_exhausted';

/** 다음 태평양 시간(America/Los_Angeles) 자정의 epoch ms. */
export function nextPacificMidnight(now = new Date()): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
    const h = get('hour') % 24, m = get('minute'), s = get('second');
    const elapsedMs = ((h * 60 + m) * 60 + s) * 1000;
    const dayMs = 24 * 60 * 60 * 1000;
    return now.getTime() + (dayMs - elapsedMs);
}

function loadExhausted(): Record<string, number> {
    try {
        const map: Record<string, number> = JSON.parse(localStorage.getItem(EXHAUSTED_KEY) || '{}');
        const now = Date.now();
        let changed = false;
        for (const [k, until] of Object.entries(map)) {
            if (until <= now) { delete map[k]; changed = true; }
        }
        if (changed) localStorage.setItem(EXHAUSTED_KEY, JSON.stringify(map));
        return map;
    } catch {
        return {};
    }
}

/** 모델을 오늘 소진으로 마킹 (429 수신 시 라우터/서비스가 호출). */
export function markModelExhausted(modelId: string): void {
    try {
        const map = loadExhausted();
        map[modelId] = nextPacificMidnight();
        localStorage.setItem(EXHAUSTED_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
}

export function isModelExhausted(modelId: string): boolean {
    return loadExhausted()[modelId] !== undefined;
}

// ── 모델 목록 캐시 (세션당 1회 fetch) ───────────────────────────────────────

let modelListCache: { key: string; models: GeminiModel[] } | null = null;

export async function getModelList(apiKey: string): Promise<GeminiModel[]> {
    if (modelListCache?.key === apiKey) return modelListCache.models;
    try {
        const models = await fetchGeminiModels(apiKey);
        modelListCache = { key: apiKey, models };
        return models;
    } catch {
        return modelListCache?.models ?? [];
    }
}

// ── 체인 구성 ───────────────────────────────────────────────────────────────

function matchInList(pattern: string | RegExp, models: GeminiModel[]): string | null {
    if (typeof pattern === 'string') {
        return models.some(m => m.name === pattern) ? pattern : null;
    }
    const found = models.find(m => pattern.test(m.name));
    return found ? found.name : null;
}

/**
 * 역할의 후보 모델 체인(우선순위 순, 중복 제거)을 만든다.
 * 1) 사용자 오버라이드(설정) → 2) 프로파일 선호 목록 중 존재하는 것 →
 * 3) 최후 보루: 목록의 아무 flash 계열.
 * 소진 마킹된 모델은 체인 뒤로 보내지 않고 제외한다 (전부 소진이면 원래 체인 그대로 반환해
 * 호출 측에서 마지막 시도가 가능하게 한다).
 */
export async function buildModelChain(role: AiRole, settings: Settings): Promise<string[]> {
    const profile = ROLE_PROFILES[role];
    const apiKey = settings.geminiApiKey ?? '';
    const models = await getModelList(apiKey);

    const chain: string[] = [];
    const push = (id: string | null) => {
        if (id && !chain.includes(id)) chain.push(id);
    };

    // 1) 사용자 오버라이드
    const override = settings.aiRoleModels?.[role];
    if (override && override.trim()) push(override.trim());

    // 2) 프로파일 선호 목록
    for (const pattern of profile.preferredIds) {
        if (models.length === 0 && typeof pattern === 'string') {
            // 목록을 못 받았으면 별칭 문자열은 그대로 신뢰 (Gemini API 가 해석)
            push(pattern);
        } else {
            push(matchInList(pattern, models));
        }
    }

    // 3) 최후 보루
    push(matchInList(/flash/i, models));

    // 능력 제약 필터
    let candidates = chain;
    if (profile.needsFunctionCalling) {
        candidates = candidates.filter(supportsFunctionCalling);
    }

    // 소진 필터 (전부 소진이면 필터 없이 반환 — 마지막 기회)
    const alive = candidates.filter(id => !isModelExhausted(id));
    return alive.length > 0 ? alive : candidates;
}

/** 함수 호출이 필요한 상황에서 사용할 체인 (역할 프로파일과 무관하게 강제 필터). */
export async function buildFunctionCallingChain(role: AiRole, settings: Settings): Promise<string[]> {
    const chain = await buildModelChain(role, settings);
    const filtered = chain.filter(supportsFunctionCalling);
    if (filtered.length > 0) return filtered;
    // Gemma 만 남는 극단적 상황: gemini 계열 별칭을 그대로 시도
    return ['gemini-flash-lite-latest', 'gemini-flash-latest'];
}
