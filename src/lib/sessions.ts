/**
 * sessions.ts — 세션 배열 집계의 원시 연산.
 *
 * "과목별로 duration 을 더하되 자습·테스트만 순공으로 따로 센다"는 루프가
 * db/Records/Study 에 네 번 복사돼 있었다. 규칙은 하나뿐이므로 구현도 하나만 둔다.
 */
import type { StudySession } from './db';

/** 순공(純工)으로 세는 학습 유형. 규칙이 바뀌는 지점은 이 배열 하나뿐이다. */
export const SELF_STUDY_TYPES: readonly string[] = ['자습', '테스트'];

export const isSelfStudy = (type: string): boolean => SELF_STUDY_TYPES.includes(type);

export interface Totals {
    /** 전체 학습 시간 (ms) */
    total: number;
    /** 그중 순공(자습·테스트) 시간 (ms) */
    selfStudy: number;
}

/** 세션들의 총합/순공 합계. */
export const sumTotals = (sessions: StudySession[]): Totals =>
    sessions.reduce<Totals>(
        (a, s) => ({
            total: a.total + s.duration,
            selfStudy: a.selfStudy + (isSelfStudy(s.type) ? s.duration : 0),
        }),
        { total: 0, selfStudy: 0 },
    );

/** key 별로 묶어 총합/순공을 낸다 — 과목별·날짜별 집계의 공통 구현. */
export function groupTotals<K>(
    sessions: StudySession[],
    key: (s: StudySession) => K,
): Map<K, Totals> {
    const out = new Map<K, Totals>();
    for (const s of sessions) {
        const k = key(s);
        const t = out.get(k) ?? { total: 0, selfStudy: 0 };
        t.total += s.duration;
        if (isSelfStudy(s.type)) t.selfStudy += s.duration;
        out.set(k, t);
    }
    return out;
}

/** 지정한 필드 기준 총 학습 시간 (ms). */
export const sumDuration = (sessions: StudySession[]): number =>
    sessions.reduce((sum, s) => sum + s.duration, 0);
