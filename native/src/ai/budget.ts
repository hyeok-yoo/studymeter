/**
 * budget.ts — 앰비언트 AI 소프트 예산 + 사용량 카운터. (React Native 포팅)
 *
 * 웹 src/lib/ai/budget.ts 를 그대로 이식하되 저장소를 localStorage → AsyncStorage 로
 * 바꾼다. AsyncStorage 는 비동기이므로 load/save/canSpend/recordSpend/getTodayUsage 가
 * 모두 Promise 를 반환하도록 시그니처가 바뀌었다 (호출부는 await 필요).
 *
 * 정확한 쿼터는 모른다(429 가 알려준다). 여기의 예산은 "귀한 모델을 아껴 쓰는"
 * 앱 자체 상한이다. 공부일(3am 기준) 단위로 리셋한다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTodayDate } from '../data/dao';

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

async function load(): Promise<UsageData> {
    const today = getTodayDate();
    try {
        const raw = await AsyncStorage.getItem(USAGE_KEY);
        const data: UsageData | null = raw ? JSON.parse(raw) : null;
        if (data && data.date === today) return data;
    } catch { /* ignore */ }
    return { date: today, byKind: {}, byModel: {} };
}

async function save(data: UsageData): Promise<void> {
    try {
        await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
}

/** 이 kind 를 지금 호출해도 되는가 (소프트 상한 이내인가). */
export async function canSpend(kind: string): Promise<boolean> {
    const cap = DAILY_CAPS[kind];
    if (cap === undefined) return true;
    return ((await load()).byKind[kind] ?? 0) < cap;
}

/** 호출 1회 기록. */
export async function recordSpend(kind: string, model: string): Promise<void> {
    const data = await load();
    data.byKind[kind] = (data.byKind[kind] ?? 0) + 1;
    data.byModel[model] = (data.byModel[model] ?? 0) + 1;
    await save(data);
}

/** 오늘 사용량 (설정 화면 표시용). */
export async function getTodayUsage(): Promise<{ byKind: Record<string, number>; byModel: Record<string, number> }> {
    const { byKind, byModel } = await load();
    return { byKind, byModel };
}
