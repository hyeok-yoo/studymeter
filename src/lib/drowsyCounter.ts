/**
 * drowsyCounter — 현재 세션 동안 졸음 경고가 몇 번 울렸는지 세는 모듈 카운터.
 * DrowsinessAlert(경고 발생 지점)가 올리고, 세션 저장 시 소비(consume)해
 * StudySession.drowsyCount 로 기록된다. 일기 자동 통계의 원료.
 * localStorage 에 백업해 앱 재시작(세션 복원) 시에도 유지한다.
 */
const KEY = 'studymeter_session_drowsy_count';

export function incrementSessionDrowsyCount(): void {
    try {
        const n = Number(localStorage.getItem(KEY) ?? '0') || 0;
        localStorage.setItem(KEY, String(n + 1));
    } catch { /* ignore */ }
}

/** 현재 값을 반환하고 0으로 리셋. (세션 저장 시 호출) */
export function consumeSessionDrowsyCount(): number {
    try {
        const n = Number(localStorage.getItem(KEY) ?? '0') || 0;
        localStorage.removeItem(KEY);
        return n;
    } catch {
        return 0;
    }
}
