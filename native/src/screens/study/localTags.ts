/**
 * localTags.ts — 세션 평가용 태그 8개 (하드코딩 임시본).
 *
 * 웹 src/lib/tags.ts 의 DEFAULT_EVAL_TAGS 중 scope 가 'session' 또는 'both' 인
 * 기본 태그에서 대표 8개를 뽑아 하드코딩한다. 다른 에이전트가 tags 모듈(data/tags.ts)을
 * 병렬 작업 중이므로 import 하지 않는다 — 통합 단계에서 이 파일을 교체/삭제한다.
 */
export const SESSION_EVAL_TAGS: string[] = [
  '졸음',
  '딴생각',
  '폰',
  '완전 몰입',
  '끝까지 완주',
  '개념 잡힘',
  '피곤',
  '인강',
];
