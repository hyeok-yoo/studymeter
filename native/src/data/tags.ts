/**
 * tags.ts — 평가 태그 프리셋 + 최근 사용 랭킹 (React Native 포팅).
 *
 * 웹 src/lib/tags.ts 미러. 세션 평가와 하루 일기가 공유하는 태그 어휘를 정의하고,
 * 설정(Settings.evalTags)의 숨김/커스텀 오버라이드를 반영한다.
 *
 * 웹은 localStorage 로 "최근 사용" 랭킹을 동기적으로 읽지만, RN 에는 동기 저장소가
 * 없다. 그래서 여기서는:
 *  - 모듈 로드 시 AsyncStorage 에서 1회 비동기로 읽어 메모리 캐시(recentTagsCache)를 채운다.
 *  - getTopTags 는 그 메모리 캐시만 보고 항상 동기로 응답한다(초기 로드 전엔 프리셋 순서).
 *  - recordTagUsage 는 캐시를 즉시 갱신하고, 디스크 저장은 fire-and-forget 한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EvalTag, Settings } from './schema';

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
  return list.filter((t) => !t.hidden);
}

/** 특정 범위(session/day)에 노출할 태그. */
export function getTagsForScope(settings: Settings, scope: 'session' | 'day'): EvalTag[] {
  return getEffectiveTags(settings).filter((t) => t.scope === scope || t.scope === 'both');
}

const RECENT_TAGS_KEY = 'studymeter_recent_tags';
const RECENT_MAX = 30;

let recentTagsCache: string[] = [];

/**
 * 캐시 최초 적재 프라미스. 모듈 로드 시 자동 실행(fire-and-forget)된다.
 * 부팅 직후 정확한 "최근 사용" 순서가 중요한 화면이라면 이 프라미스를 await 해
 * getTopTags 호출 전에 캐시가 채워졌음을 보장할 수 있다(선택 사항).
 */
export const recentTagsReady: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(RECENT_TAGS_KEY);
    recentTagsCache = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    recentTagsCache = [];
  }
})();

/** 최근 사용 태그 기록 — 메모리 캐시는 즉시 갱신, 디스크 저장은 비동기(fire-and-forget). */
export function recordTagUsage(tags: string[]): void {
  if (tags.length === 0) return;
  const next = [...tags, ...recentTagsCache.filter((t) => !tags.includes(t))].slice(0, RECENT_MAX);
  recentTagsCache = next;
  void AsyncStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(next)).catch(() => {
    /* ignore — 다음 기록 시 재시도됨 */
  });
}

/**
 * 노출할 태그를 우선순위로 정렬해 상위 N개를 반환한다.
 * 우선순위: 자동 프리필 대상(preselected) > 최근 사용 > 프리셋 순서.
 * 항상 동기 — 메모리 캐시(recentTagsCache)만 참조한다.
 */
export function getTopTags(
  settings: Settings,
  scope: 'session' | 'day',
  limit: number,
  preselected: string[] = []
): EvalTag[] {
  const all = getTagsForScope(settings, scope);
  const recent = recentTagsCache;
  const rank = (t: EvalTag) => {
    if (preselected.includes(t.name)) return -1000;
    const r = recent.indexOf(t.name);
    return r === -1 ? 1000 + all.indexOf(t) : r;
  };
  return [...all].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}
