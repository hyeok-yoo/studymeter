/**
 * tags.ts — 평가 태그 프리셋 + 설정 병합 유틸.
 *
 * 태그는 세션 평가와 하루 일기의 공용 어휘다. 기본 프리셋을 넉넉히 제공하고,
 * 설정(Settings.evalTags)에서 숨김/커스텀 추가가 가능하다.
 * 태그가 곧 약점 리포트의 원료이므로, 이름은 통계로 묶기 좋게 짧고 명확하게 유지한다.
 */
import type { EvalTag, Settings } from './db';

export const DEFAULT_EVAL_TAGS: EvalTag[] = [
    // 방해 요인 (세션+하루)
    { name: '졸음', category: 'obstacle', scope: 'both' },
    { name: '딴생각', category: 'obstacle', scope: 'both' },
    { name: '폰', category: 'obstacle', scope: 'both' },
    { name: '소음', category: 'obstacle', scope: 'session' },
    { name: '잡담', category: 'obstacle', scope: 'session' },
    { name: '급한 마음', category: 'obstacle', scope: 'both' },
    { name: '시작 미룸', category: 'obstacle', scope: 'both' },
    // 컨디션 (주로 하루)
    { name: '피곤', category: 'condition', scope: 'both' },
    { name: '배고픔', category: 'condition', scope: 'session' },
    { name: '몸 안좋음', category: 'condition', scope: 'both' },
    { name: '컨디션 최상', category: 'condition', scope: 'both' },
    { name: '잠 부족', category: 'condition', scope: 'day' },
    { name: '불안', category: 'condition', scope: 'day' },
    { name: '기분 좋음', category: 'condition', scope: 'day' },
    // 잘한 것
    { name: '완전 몰입', category: 'good', scope: 'both' },
    { name: '끝까지 완주', category: 'good', scope: 'both' },
    { name: '개념 잡힘', category: 'good', scope: 'session' },
    { name: '오답 정리함', category: 'good', scope: 'session' },
    { name: '계획대로 함', category: 'good', scope: 'day' },
    { name: '루틴 지킴', category: 'good', scope: 'day' },
    // 상황
    { name: '학원', category: 'context', scope: 'both' },
    { name: '인강', category: 'context', scope: 'session' },
    { name: '스터디카페', category: 'context', scope: 'both' },
    { name: '새벽 공부', category: 'context', scope: 'both' },
    { name: '이동 중', category: 'context', scope: 'session' },
];

export const TAG_CATEGORY_LABELS: Record<EvalTag['category'], string> = {
    obstacle: '방해 요인',
    condition: '컨디션',
    good: '잘한 것',
    context: '상황',
    day: '하루',
};

/** 설정과 병합된 유효 태그 목록 (숨김 제외). */
export function getEffectiveTags(settings: Settings): EvalTag[] {
    const list = settings.evalTags && settings.evalTags.length > 0 ? settings.evalTags : DEFAULT_EVAL_TAGS;
    return list.filter(t => !t.hidden);
}

/** 특정 범위(session/day)에 노출할 태그. */
export function getTagsForScope(settings: Settings, scope: 'session' | 'day'): EvalTag[] {
    return getEffectiveTags(settings).filter(t => t.scope === scope || t.scope === 'both');
}

const RECENT_TAGS_KEY = 'studymeter_recent_tags';
const RECENT_MAX = 30;

/** 최근 사용 태그 기록 (노출 우선순위용). */
export function recordTagUsage(tags: string[]): void {
    if (tags.length === 0) return;
    try {
        const prev: string[] = JSON.parse(localStorage.getItem(RECENT_TAGS_KEY) || '[]');
        const next = [...tags, ...prev.filter(t => !tags.includes(t))].slice(0, RECENT_MAX);
        localStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
}

/**
 * 노출할 태그를 우선순위로 정렬해 상위 N개를 반환.
 * 우선순위: 자동 프리필 대상(preselected) > 최근 사용 > 프리셋 순서.
 */
export function getTopTags(settings: Settings, scope: 'session' | 'day', limit: number, preselected: string[] = []): EvalTag[] {
    const all = getTagsForScope(settings, scope);
    let recent: string[] = [];
    try {
        recent = JSON.parse(localStorage.getItem(RECENT_TAGS_KEY) || '[]');
    } catch { /* ignore */ }
    const rank = (t: EvalTag) => {
        if (preselected.includes(t.name)) return -1000;
        const r = recent.indexOf(t.name);
        return r === -1 ? 1000 + all.indexOf(t) : r;
    };
    return [...all].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}
