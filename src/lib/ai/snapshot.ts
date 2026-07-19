/**
 * snapshot.ts — AI 프롬프트에 넣을 공부 데이터 요약 텍스트 생성.
 *
 * 모든 앰비언트 기능(리포트·일기 초안·답장·코멘트)이 이 요약을 원료로 쓴다.
 * 요약은 로컬에서 계산되며, AI 없이도 유효한 수치이므로 규칙 기반 폴백에도 재사용된다.
 */
import {
    db,
    computeDiaryStats,
    formatDurationHourMinute,
    getEvalScore,
    getDiaryRange,
    type DiaryStats,
    formatDateYYYYMMDD,
} from '../db';

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
        const sessions = await db.sessions.where('date').equals(date).sortBy('startTime');
        const lines = sessions.map(s => {
            const score = getEvalScore(s.evaluation);
            const tags = s.evaluation?.tags?.length ? ` 태그:${s.evaluation.tags.join(',')}` : '';
            const memo = s.evaluation?.memo ? ` 메모:"${s.evaluation.memo}"` : '';
            const time = new Date(s.startTime).toTimeString().slice(0, 5);
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
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
