/**
 * diaryStats.ts — 일기 통계 집계 + 점수 제안 + 규칙 기반 초안 (웹 src/lib/db.ts 포팅).
 *
 * dao.ts 에는 computeDiaryStats 상당 함수가 없다(세션/일기 CRUD 만 있음). dao.ts 는
 * 다른 에이전트와 충돌 위험이 있어 수정하지 않기로 했으므로, 여기서 dao 의
 * getSessionsByDate 결과를 직접 집계해 "diary util" 로 제공한다.
 */
import { formatDurationHourMinute, getSessionsByDate } from '../../data/dao';
import { getEvalScore, type DiaryStats } from '../../data/schema';

const SELF_STUDY_TYPES = new Set(['자습', '테스트']);

export const EMPTY_DIARY_STATS: DiaryStats = {
  totalMs: 0,
  selfStudyMs: 0,
  goalPct: null,
  sessionCount: 0,
  avgScore: null,
  drowsyCount: 0,
  bySubject: [],
};

/** 특정 날짜의 자동 집계 스냅샷을 계산한다. 웹 computeDiaryStats 포팅. */
export async function computeDiaryStats(date: string, dailyGoalMs?: number): Promise<DiaryStats> {
  const sessions = await getSessionsByDate(date);
  const totalMs = sessions.reduce((sum, s) => sum + s.duration, 0);
  const selfStudyMs = sessions
    .filter((s) => SELF_STUDY_TYPES.has(s.type))
    .reduce((sum, s) => sum + s.duration, 0);
  const scores = sessions
    .map((s) => getEvalScore(s.evaluation))
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

/** 세션 태그를 하루 태그로 승계(중복 제거). 웹 collectSessionTags 포팅. */
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

/** AI 없이 쓰는 규칙 기반 초안. 웹 ruleBasedDiaryDraft 포팅 (AI 초안은 optional prop 으로 별도 주입). */
export function ruleBasedDiaryDraft(stats: DiaryStats): string {
  if (stats.totalMs === 0) return '오늘은 기록된 공부가 없다.';
  const top = stats.bySubject[0];
  const parts: string[] = [];
  parts.push(`${top ? top.subject + ' 중심으로 ' : ''}${formatDurationHourMinute(stats.totalMs)} 공부했다`);
  if (stats.goalPct !== null && stats.goalPct >= 100) parts.push('목표를 채웠다');
  else if (stats.drowsyCount > 0) parts.push(`졸음이 ${stats.drowsyCount}번 왔다`);
  return parts.join(', ') + '.';
}
