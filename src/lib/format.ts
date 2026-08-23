/**
 * format.ts — 표시 포맷의 단일 소스.
 *
 * 이전에는 같은 포맷터가 페이지마다 조금씩 다르게 재구현돼 있었다
 * (Records 3개, EditRecords 1개, Study 3개, Admin/GeminiChat/DataManagement 각 1개…).
 * 아래 두 개의 조합기(`split`, `toDate`) 위에 모든 표기를 얹어, 표기 규칙을
 * 바꿀 곳이 언제나 한 곳뿐이게 한다.
 */

const pad = (n: number | string, len = 2) => String(n).padStart(len, '0');

/** ms → [시, 분, 초]. round=true 면 초 단위 반올림 후 분해한다. 부호는 버린다. */
const split = (ms: number, round = false) => {
    const t = (round ? Math.round : Math.floor)(Math.abs(ms) / 1000);
    return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60] as const;
};

/** 'YYYY-MM-DD' | Date | timestamp → Date. 날짜 문자열은 로컬 자정으로 고정한다. */
export const toDate = (v: Date | string | number): Date =>
    typeof v === 'string' ? new Date(`${v}T00:00:00`) : new Date(v);

// ── 기간(duration) ──────────────────────────────────────────────────────────

/** HH:MM:SS — 스톱워치 표기 */
export const hms = (ms: number): string => {
    const [h, m, s] = split(ms);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

/**
 * HH:MM:SS.s — 0.1초까지 흐르는 메인 타이머.
 *
 * 반올림은 반드시 분해 **전에** 한다. 초만 따로 `toFixed(1)` 하면 59.95초가
 * "60.0" 으로 올라가 매 분마다 "00:00:60.0" 이 한 틱씩 보였다.
 */
export const hmsDecimal = (ms: number): string => {
    const ds = Math.round(Math.abs(ms) / 100); // 데시초(0.1s) 단위로 먼저 확정
    const h = Math.floor(ds / 36_000);
    const m = Math.floor((ds % 36_000) / 600);
    const s = (ds % 600) / 10;
    return `${pad(h)}:${pad(m)}:${pad(s.toFixed(1), 4)}`;
};

/**
 * "3h 5m" 계열 표기 — 앱에 흩어져 있던 다섯 가지 변형을 옵션 세 개로 흡수한다.
 *  기본      → 시간이 0이면 "5m"          (통계 합계)
 *  round     → 초 단위 반올림 후 분해       (세션 길이)
 *  sign      → 항상 +/- 를 붙임            (전주 대비 증감)
 *  always    → 시간이 0이어도 "0h 5m"      (주간 진행 바)
 *  compact   → 분이 0이면 "3h"            (달력 셀)
 */
export const hm = (
    ms: number,
    { round = false, sign = false, always = false, compact = false } = {},
): string => {
    const [h, m] = split(ms, round);
    const s = sign ? (ms >= 0 ? '+' : '-') : '';
    if (!h && !always) return `${s}${m}m`;
    if (compact && !m) return `${s}${h}h`;
    return `${s}${h}h ${m}m`;
};

/** MM:SS — 초 단위 입력(ETA·카운트다운) */
export const mmss = (seconds: number): string =>
    `${pad(Math.floor(seconds / 60))}:${pad(Math.floor(seconds % 60))}`;

// ── 시각·날짜 ───────────────────────────────────────────────────────────────

/** HH:mm — 타임스탬프의 시각 */
export const hhmm = (ts: number): string => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 'HH:mm' → 자정 기준 오프셋(ms). 형식이 어긋나면 null. */
export const parseHhmm = (v: string): number | null => {
    const [h, m] = v.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? (h * 60 + m) * 60_000 : null;
};

/** YYYY-MM-DD (로컬 기준) */
export const ymd = (date: Date): string =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** 날짜에 일수를 더한 YYYY-MM-DD */
export const addDays = (v: Date | string, days: number): string => {
    const d = toDate(v);
    d.setDate(d.getDate() + days);
    return ymd(d);
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 한국어 날짜 표기.
 *  'plain'  → 8월 2일
 *  'paren'  → 8월 2일 (토)
 *  'full'   → 8월 2일 토요일
 *  'slash'  → 8/2
 */
export const koDate = (
    v: Date | string | number,
    style: 'plain' | 'paren' | 'full' | 'slash' = 'plain',
): string => {
    const d = toDate(v);
    if (style === 'slash') return `${d.getMonth() + 1}/${d.getDate()}`;
    const md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
    if (style === 'paren') return `${md} (${WEEKDAYS[d.getDay()]})`;
    if (style === 'full') return `${md} ${WEEKDAYS[d.getDay()]}요일`;
    return md;
};

/** M/D HH:mm — 목록의 보조 타임스탬프 */
export const dateTimeShort = (ts: number): string => `${koDate(ts, 'slash')} ${hhmm(ts)}`;

/** "3초 전" / "5분 전" — 진행 중인 세션 안에서만 쓰이므로 분까지만 센다. */
export const ago = (ts: number): string => {
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? `${s}초 전` : `${Math.floor(s / 60)}분 전`;
};

// ── 기타 ────────────────────────────────────────────────────────────────────

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1024 진법 바이트 표기 — B 단위는 정수, 그 이상은 소수 첫째 자리. */
export const bytes = (n: number): string => {
    if (!Number.isFinite(n) || n < 1) return '0 B';
    const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), BYTE_UNITS.length - 1);
    const value = n / 1024 ** exp;
    return `${exp === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exp]}`;
};
