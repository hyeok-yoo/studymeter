/**
 * budget.ts — 앰비언트 AI 소프트 예산 + 사용량 카운터.
 *
 * 정확한 쿼터는 모른다(429 가 알려준다). 여기의 예산은 "귀한 모델을 아껴 쓰는"
 * 앱 자체 상한이다. 카운터는 설정 화면의 투명성 표시에도 쓰인다.
 * 저장: localStorage, 공부일(3am 기준) 단위로 리셋.
 */
import { getTodayDate } from '../db';

const USAGE_KEY = 'studymeter_ai_usage';

interface UsageData {
    date: string;
    /** 기능(kind)별 호출 수 */
    byKind: Record<string, number>;
    /** 모델별 호출 수 */
    byModel: Record<string, number>;
}

/** 기능별 하루 소프트 상한. 없는 kind 는 무제한. */
const DAILY_CAPS: Record<string, number> = {
    'session-comment': 15,
    'diary-draft': 4,
    'diary-reply': 4,
    'morning-report': 3,
    'weekly-report': 2,
    'stats-summary': 3,
};

function load(): UsageData {
    const today = getTodayDate();
    try {
        const data: UsageData = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null');
        if (data && data.date === today) return data;
    } catch { /* ignore */ }
    return { date: today, byKind: {}, byModel: {} };
}

function save(data: UsageData): void {
    try {
        localStorage.setItem(USAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

/** 이 kind 를 지금 호출해도 되는가 (소프트 상한 이내인가). */
export function canSpend(kind: string): boolean {
    const cap = DAILY_CAPS[kind];
    if (cap === undefined) return true;
    return (load().byKind[kind] ?? 0) < cap;
}

/** 호출 1회 기록. */
export function recordSpend(kind: string, model: string): void {
    const data = load();
    data.byKind[kind] = (data.byKind[kind] ?? 0) + 1;
    data.byModel[model] = (data.byModel[model] ?? 0) + 1;
    save(data);
}

/** 오늘 사용량 (설정 화면 표시용). */
export function getTodayUsage(): { byKind: Record<string, number>; byModel: Record<string, number> } {
    const { byKind, byModel } = load();
    return { byKind, byModel };
}
