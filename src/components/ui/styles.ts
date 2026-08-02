/**
 * styles.ts — 여러 곳에서 그대로 반복되던 유틸리티 클래스 조합.
 *
 * 같은 "입력 필드"가 페이지마다 다른 하드코딩 문자열로 존재했다
 * (Settings 는 CSS 변수, EditRecords 는 bg-white/5 …). 토큰을 한 곳에 모아
 * 테마가 실제로 한 벌이 되게 한다.
 */

/** 텍스트/숫자/셀렉트 입력 공통 */
export const input =
    'w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all';

/** 폼 안의 촘촘한 입력 (기록 편집 등) */
export const inputCompact =
    'px-4 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all';

/** 카드 헤더 아래의 작은 대문자 캡션 */
export const caption = 'text-[10px] font-black uppercase tracking-widest opacity-40';

/** 정보성 배지 (모델명·상태 등) */
export const badge =
    'text-[10px] font-medium px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-400/20';
