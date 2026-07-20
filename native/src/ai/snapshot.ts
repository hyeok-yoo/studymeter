/**
 * snapshot.ts — AI 프롬프트에 넣을 공부 데이터 요약 텍스트 생성. (React Native 포팅)
 *
 * 웹 src/lib/ai/snapshot.ts 를 이식하되 Dexie 쿼리를 dao 호출로 재구성한다.
 * 날짜 문자열은 datetime 헬퍼(formatDateYYYYMMDD / formatTimeHHMM)로만 만든다
 * (toISOString 은 UTC 라 KST 에서 하루/시간이 어긋날 수 있어 금지).
 *
 * 웹 db.ts 의 computeDiaryStats / collectSessionTags / suggestDiaryScore 는 네이티브
 * dao 에 없으므로, 여기서 dao.getSessionsByDate 기반으로 함께 재구성해 노출한다.
 * (functions.ts 도 이 헬퍼들을 재사용한다.)
 */
import {
    formatDateYYYYMMDD,
    formatDurationHourMinute,
    formatTimeHHMM,
    getDiaryRange,
    getSessionsByDate,
} from '../data/dao';
import { getEvalScore, type DiaryStats } from '../data/schema';

// ── 통계 헬퍼 (웹 db.ts 포팅) ────────────────────────────────────────────────

/** 특정 날짜의 자동 집계 스냅샷을 계산한다. 웹 computeDiaryStats 포팅. */
export async function computeDiaryStats(date: string, dailyGoalMs?: number): Promise<DiaryStats> {
    const sessions = await getSessionsByDate(date);
    const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);
    const selfStudyMs = sessions
        .filter(s => s.type === '자습' || s.type === '테스트')
        .reduce((sum, s) => sum + s.duration, 0);
    const scores = sessions
        .map(s => getEvalScore(s.evaluation))
        .filter((v): v is number => v !== null);
    const drowsyCount = sessions.reduce((sum, s) => sum + (s.drowsyCount ?? 0), 0);
    const bySubjectMap = new Map<string, number>();
    for (const s of sessions) {
        bySubjectMap.set(s.subject, (bySubjectMap.get(s.subject) ?? 0) + s.duration);
    }
    return {
        totalMs,
        selfStudyMs,
        goalPct: dailyGoalMs && dailyGoalMs > 0 ? Math.round((totalMs / dailyGoalMs) * 100) : null,
        sessionCount: sessions.length,
        avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
        drowsyCount,
        bySubject: Array.from(bySubjectMap.entries())
            .map(([subject, ms]) => ({ subject, ms }))
            .sort((a, b) => b.ms - a.ms),
    };
}

/** 세션 태그를 하루 태그로 승계 (중복 제거). 웹 collectSessionTags 포팅. */
export async function collectSessionTags(date: string): Promise<string[]> {
    const sessions = await getSessionsByDate(date);
    const tags = new Set<string>();
    for (const s of sessions) {
        for (const t of s.evaluation?.tags ?? []) tags.add(t);
    }
    return Array.from(tags);
}

/**
 * 일기 점수 자동 제안 (1-10). 웹 suggestDiaryScore 포팅.
 * 세션 평균 점수를 기본으로, 목표 달성률로 보정하고 졸음 횟수만큼 감점한다.
 */
export function suggestDiaryScore(stats: DiaryStats): number {
    let score: number;
    if (stats.avgScore !== null) {
        score = stats.avgScore;
    } else if (stats.goalPct !== null) {
        score = 3 + (Math.min(stats.goalPct, 120) / 120) * 7;
    } else if (stats.totalMs > 0) {
        score = 6;
    } else {
        score = 5;
    }
    if (stats.goalPct !== null) {
        if (stats.goalPct >= 100) score += 1;
        else if (stats.goalPct < 50) score -= 1;
    }
    score -= Math.min(2, stats.drowsyCount * 0.5);
    return Math.max(1, Math.min(10, Math.round(score)));
}

// ── 스냅샷 텍스트 ────────────────────────────────────────────────────────────

function fmtStats(label: string, stats: DiaryStats): string {
    const lines = [
        `[${label}]`,
        `- 총 공부: ${formatDurationHourMinute(stats.totalMs)} (순공 ${formatDurationHourMinute(stats.selfStudyMs)})`,
    ];
    if (stats.goalPct !== null) lines.push(`- 목표 달성률: ${stats.goalPct}%`);
    lines.push(`- 세션 ${stats.sessionCount}개${stats.avgScore !== null ? `, 평균 점수 ${stats.avgScore}/10` : ''}`);
    if (stats.drowsyCount > 0) lines.push(`- 졸음 감지: ${stats.drowsyCount}회`);
    if (stats.bySubject.length > 0) {
        lines.push(`- 과목별: ${stats.bySubject.map(s => `${s.subject} ${formatDurationHourMinute(s.ms)}`).join(', ')}`);
    }
    return lines.join('\n');
}

/** 하루 요약 (세션 상세 포함 옵션). */
export async function buildDaySnapshot(date: string, dailyGoalMs?: number, withSessions = false): Promise<string> {
    const stats = await computeDiaryStats(date, dailyGoalMs);
    let text = fmtStats(`${date} 공부 데이터`, stats);
    if (withSessions && stats.sessionCount > 0) {
        // getSessionsByDate 는 startTime 오름차순 정렬 반환.
        const sessions = await getSessionsByDate(date);
        const lines = sessions.map(s => {
            const score = getEvalScore(s.evaluation);
            const tags = s.evaluation?.tags?.length ? ` 태그:${s.evaluation.tags.join(',')}` : '';
            const memo = s.evaluation?.memo ? ` 메모:"${s.evaluation.memo}"` : '';
            const time = formatTimeHHMM(s.startTime);
            return `  · ${time} ${s.subject}${s.subItem ? `>${s.subItem}` : ''} (${s.type}) ${formatDurationHourMinute(s.duration)}${score !== null ? ` ${score}/10` : ''}${tags}${memo}`;
        });
        text += `\n- 세션 상세:\n${lines.join('\n')}`;
    }
    return text;
}

/** 최근 N일 요약 (일별 한 줄 + 일기 태그/한마디). */
export async function buildRecentDaysSnapshot(endDate: string, days: number, dailyGoalMs?: number): Promise<string> {
    const end = new Date(endDate + 'T12:00:00');
    const lines: string[] = [`[최근 ${days}일 기록 (${endDate} 기준)]`];
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const startStr = formatDateYYYYMMDD(start); // 로컬 날짜 기준 (toISOString은 UTC라 KST에서 하루 어긋남)
    const diaries = new Map((await getDiaryRange(startStr, endDate)).map(d => [d.date, d]));

    for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = formatDateYYYYMMDD(d);
        const stats = await computeDiaryStats(dateStr, dailyGoalMs);
        const diary = diaries.get(dateStr);
        const parts = [
            `- ${dateStr}: ${formatDurationHourMinute(stats.totalMs)}`,
            stats.avgScore !== null ? `세션평균 ${stats.avgScore}` : '',
            diary ? `일기점수 ${diary.score}` : '',
            diary?.dayTags?.length ? `태그[${diary.dayTags.join(',')}]` : '',
            stats.drowsyCount > 0 ? `졸음${stats.drowsyCount}` : '',
            diary?.oneLiner ? `"${diary.oneLiner}"` : '',
        ].filter(Boolean);
        lines.push(parts.join(' · '));
    }
    return lines.join('\n');
}

/** 하루 통계 + 일기용 스냅샷을 함께 반환 (일기 카드가 사용). */
export async function buildDiaryContext(date: string, dailyGoalMs?: number): Promise<{ stats: DiaryStats; text: string }> {
    const stats = await computeDiaryStats(date, dailyGoalMs);
    const text = await buildDaySnapshot(date, dailyGoalMs, true);
    return { stats, text };
}
