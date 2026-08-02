/**
 * styles.ts — 여러 곳에서 그대로 반복되던 유틸리티 클래스 조합.
 *
 * ⚠️ 알려진 문제: `--color-surface` 는 index.css 에 **정의돼 있지 않다**
 * (정의된 것은 `--color-surface-elevated` 뿐). 따라서 `bg-[var(--color-surface)]`
 * 는 지금 투명으로 렌더된다. Settings 가 원래 쓰던 문자열을 그대로 옮겨 둔 것이라
 * 이 파일을 쓰는 쪽의 겉모습은 이전과 동일하지만, 고칠 때는 index.css 에
 * `--color-surface` 를 라이트/다크 양쪽에 정의하는 한 줄이면 전부 같이 고쳐진다.
 * (그 전까지 어두운 배경 위의 폼은 `fieldOnGlass` 를 쓴다.)
 */

/** 텍스트/숫자/셀렉트 입력 공통 — 설정 화면 기준 */
export const input =
    'w-full px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

/** 유리 카드 위에 얹는 촘촘한 입력 — 실제로 칠해지는 배경이 필요한 곳 */
export const fieldOnGlass =
    'px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm outline-none focus:ring-2 focus:ring-indigo-500';

/** 카드 헤더 아래의 작은 대문자 캡션 */
export const caption = 'text-[10px] font-black uppercase tracking-widest opacity-40';

/** 정보성 배지 (모델명·상태 등) */
export const badge =
    'text-[10px] font-medium px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-400/20';
