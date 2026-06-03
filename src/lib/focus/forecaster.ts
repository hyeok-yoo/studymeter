/**
 * focus/forecaster.ts — engine/Forecaster.kt 의 TS 포트.
 * 집중도 점수 시계열 → 임계값 도달 ETA. t는 ms, 내부에서 초로 변환.
 */
import type { ETAResult } from './types';

interface Entry { tS: number; score: number; }

export class Forecaster {
    private history: Entry[] = [];
    private smoothed: number | null = null;

    private threshold: number;
    private windowS: number;
    private maxEtaS: number;
    private minPoints: number;
    private smoothingAlpha: number;
    private quadraticMinCurvature: number;

    constructor(threshold = 40, windowS = 15, maxEtaS = 300, minPoints = 4, smoothingAlpha = 0.5, quadraticMinCurvature = 1e-4) {
        this.threshold = threshold;
        this.windowS = windowS;
        this.maxEtaS = maxEtaS;
        this.minPoints = minPoints;
        this.smoothingAlpha = smoothingAlpha;
        this.quadraticMinCurvature = quadraticMinCurvature;
    }

    reset(): void { this.history = []; this.smoothed = null; }

    update(nowMs: number, score: number): ETAResult {
        const tS = nowMs / 1000;
        this.smoothed = this.smoothed == null ? score : this.smoothingAlpha * score + (1 - this.smoothingAlpha) * this.smoothed;
        const s = this.smoothed;

        this.history.push({ tS, score: s });
        const cutoff = tS - this.windowS;
        while (this.history.length && this.history[0].tS < cutoff) this.history.shift();

        if (this.history.length < this.minPoints) return { etaS: null, scoreSmoothed: s, derivative: 0, secondDerivative: 0, fitDegree: 0 };

        const ts = this.history.map(e => e.tS);
        const ys = this.history.map(e => e.score);
        const t0 = ts[0];
        const tRel = ts.map(t => t - t0);
        const tNowRel = tS - t0;

        if (s <= this.threshold) {
            const [d1, d2, deg] = this.derivativesFromFit(tRel, ys, tNowRel);
            return { etaS: 0, scoreSmoothed: s, derivative: d1, secondDerivative: d2, fitDegree: deg };
        }

        const r = this.solve(tRel, ys, tNowRel);
        return { etaS: r.eta, scoreSmoothed: s, derivative: r.d1, secondDerivative: r.d2, fitDegree: r.degree };
    }

    private solve(tRel: number[], ys: number[], tNow: number): { eta: number | null; degree: number; d1: number; d2: number } {
        const [b1, c1] = polyfit1(tRel, ys);
        const d1 = b1;

        if (tRel.length >= Math.max(this.minPoints, 5)) {
            const q = polyfit2(tRel, ys);
            if (q && Math.abs(q[0]) > this.quadraticMinCurvature) {
                const [a2, b2, c2] = q;
                const dNow = 2 * a2 * tNow + b2;
                const eta2 = this.quadraticRootAfter(a2, b2, c2, tNow);
                if (eta2 != null) return { eta: eta2, degree: 2, d1: dNow, d2: 2 * a2 };
            }
        }

        if (b1 >= -1e-6) return { eta: null, degree: 1, d1, d2: 0 };
        const tHit = (this.threshold - c1) / b1;
        const eta = tHit - tNow;
        if (eta < 0 || eta > this.maxEtaS) return { eta: null, degree: 1, d1, d2: 0 };
        return { eta, degree: 1, d1, d2: 0 };
    }

    private quadraticRootAfter(a: number, b: number, c: number, tNow: number): number | null {
        const disc = b * b - 4 * a * (c - this.threshold);
        if (disc < 0) return null;
        const sqrtD = Math.sqrt(disc);
        const roots = [(-b + sqrtD) / (2 * a), (-b - sqrtD) / (2 * a)].filter(r => r > tNow + 1e-9);
        if (roots.length === 0) return null;
        const eta = Math.min(...roots) - tNow;
        if (eta > this.maxEtaS) return null;
        return eta;
    }

    private derivativesFromFit(tRel: number[], ys: number[], tNow: number): [number, number, number] {
        if (tRel.length >= 5) {
            const q = polyfit2(tRel, ys);
            if (q) return [2 * q[0] * tNow + q[1], 2 * q[0], 2];
        }
        const [b1] = polyfit1(tRel, ys);
        return [b1, 0, 1];
    }
}

function polyfit1(t: number[], y: number[]): [number, number] {
    const n = t.length;
    let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
    for (let i = 0; i < n; i++) { sumT += t[i]; sumY += y[i]; sumTT += t[i] * t[i]; sumTY += t[i] * y[i]; }
    const denom = n * sumTT - sumT * sumT;
    if (Math.abs(denom) < 1e-12) return [0, sumY / n];
    const b = (n * sumTY - sumT * sumY) / denom;
    const c = (sumY - b * sumT) / n;
    return [b, c];
}

/** returns [a, b, c] for a t² + b t + c, or null if singular. */
function polyfit2(t: number[], y: number[]): [number, number, number] | null {
    const pow = (v: number, p: number) => { let r = 1; for (let k = 0; k < p; k++) r *= v; return r; };
    const sums = new Array(7).fill(0).map((_, p) => t.reduce((acc, v) => acc + pow(v, p), 0));
    const b = new Array(3).fill(0).map((_, p) => t.reduce((acc, v, i) => acc + pow(v, p) * y[i], 0));
    const mat = [0, 1, 2].map(r => [0, 1, 2].map(c => sums[r + c]));
    const coeffs = solve3x3(mat, b);
    if (!coeffs) return null;
    return [coeffs[2], coeffs[1], coeffs[0]];
}

function solve3x3(A: number[][], b: number[]): number[] | null {
    const n = 3;
    const aug = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let maxRow = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
        [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
        if (Math.abs(aug[col][col]) < 1e-12) return null;
        for (let row = col + 1; row < n; row++) {
            const factor = aug[row][col] / aug[col][col];
            for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
        }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = aug[i][n];
        for (let j = i + 1; j < n; j++) x[i] -= aug[i][j] * x[j];
        x[i] /= aug[i][i];
    }
    return x;
}
