/**
 * focus/scoreCalibrator.ts — engine/ScoreCalibrator.kt 의 TS 포트.
 * 세션 후 사용자 자기평가(1-5) → 원점수 선형 매핑 학습. localStorage 저장.
 */
const KEY_SESSIONS = 'focus_web_score_sessions';
const KEY_SCALE = 'focus_web_score_scale';
const KEY_OFFSET = 'focus_web_score_offset';
const MAX_SESSIONS = 30;

interface CalibSession { raw: number; target: number; }

export class ScoreCalibrator {
    private scale = 1;
    private offset = 0;
    private _sessionCount = 0;

    constructor() { this.load(); }

    get isCalibrated(): boolean { return this._sessionCount >= 3; }
    get sessionCount(): number { return this._sessionCount; }

    calibrate(rawScore: number): number {
        if (!this.isCalibrated) return rawScore;
        return Math.min(Math.max(this.scale * rawScore + this.offset, 0), 100);
    }

    addSession(sessionMeanScore: number, userRating: number): void {
        if (!Number.isFinite(sessionMeanScore) || userRating < 1 || userRating > 5) return;
        const targetScore = (userRating - 1) * 25;
        let arr = this.readSessions();
        arr.push({ raw: sessionMeanScore, target: targetScore });
        if (arr.length > MAX_SESSIONS) arr = arr.slice(arr.length - MAX_SESSIONS);
        localStorage.setItem(KEY_SESSIONS, JSON.stringify(arr));
        this._sessionCount = arr.length;
        this.fitModel(arr);
        this.save();
    }

    private fitModel(arr: CalibSession[]): void {
        if (arr.length < 2) return;
        const n = arr.length;
        let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
        for (const o of arr) { sumX += o.raw; sumY += o.target; sumXX += o.raw * o.raw; sumXY += o.raw * o.target; }
        const denom = n * sumXX - sumX * sumX;
        if (Math.abs(denom) < 1e-6) return;
        this.scale = Math.min(Math.max((n * sumXY - sumX * sumY) / denom, 0.3), 3);
        this.offset = Math.min(Math.max((sumY - this.scale * sumX) / n, -50), 50);
    }

    private readSessions(): CalibSession[] {
        try {
            const parsed = JSON.parse(localStorage.getItem(KEY_SESSIONS) ?? '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }

    private save(): void {
        localStorage.setItem(KEY_SCALE, String(this.scale));
        localStorage.setItem(KEY_OFFSET, String(this.offset));
    }

    private load(): void {
        this.scale = Number(localStorage.getItem(KEY_SCALE) ?? '1') || 1;
        this.offset = Number(localStorage.getItem(KEY_OFFSET) ?? '0') || 0;
        this._sessionCount = this.readSessions().length;
    }

    reset(): void {
        this.scale = 1; this.offset = 0; this._sessionCount = 0;
        localStorage.removeItem(KEY_SESSIONS);
        localStorage.removeItem(KEY_SCALE);
        localStorage.removeItem(KEY_OFFSET);
    }
}
