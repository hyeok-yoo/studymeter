/**
 * focus/featureExtractor.ts — engine/FeatureExtractor.kt 의 TS 포트.
 * 10s 슬라이딩 윈도우로 14개 특징 벡터를 1s stride로 방출.
 */
import { type FeatureVector, type GazeSample, type RPPGSample, type HRVMetrics, emptyHRV, mergedRGB } from './types';
import { computeHrv } from './signalProcessing';

function avg(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(avg(arr.map(v => (v - m) * (v - m))));
}

export class FeatureExtractor {
    private gazeBuffer: GazeSample[] = [];
    private rppgBuffer: RPPGSample[] = [];
    private tickTotal: number[] = [];
    private tickValid: number[] = [];
    private lastEmitMs: number | null = null;
    private bpmHistory: number[] = [];
    private bpmConsecutiveRejects = 0;

    private windowMs: number;
    private strideMs: number;
    private minSamplesForHrv: number;
    private maxBpmJump: number;

    constructor(windowMs = 10_000, strideMs = 1_000, minSamplesForHrv = 80, maxBpmJump = 15) {
        this.windowMs = windowMs;
        this.strideMs = strideMs;
        this.minSamplesForHrv = minSamplesForHrv;
        this.maxBpmJump = maxBpmJump;
    }

    reset(): void {
        this.gazeBuffer = []; this.rppgBuffer = [];
        this.tickTotal = []; this.tickValid = [];
        this.lastEmitMs = null;
        this.bpmHistory = []; this.bpmConsecutiveRejects = 0;
    }

    pushGaze(sample: GazeSample | null, nowMs: number): void {
        this.tickTotal.push(nowMs);
        if (sample) { this.gazeBuffer.push(sample); this.tickValid.push(nowMs); }
        this.trim(nowMs);
    }

    pushRppg(sample: RPPGSample): void {
        this.rppgBuffer.push(sample);
        this.trim(sample.timestampMs);
    }

    maybeEmit(): FeatureVector | null {
        const latest = this.latestT();
        if (latest == null) return null;
        if (this.lastEmitMs == null) {
            if (this.tickTotal.length === 0) return null;
            const span = latest - this.tickTotal[0];
            if (span < this.windowMs / 2) return null;
        } else {
            if (latest - this.lastEmitMs < this.strideMs) return null;
        }
        this.lastEmitMs = latest;
        return this.compute(latest);
    }

    private latestT(): number | null {
        const c: number[] = [];
        if (this.gazeBuffer.length) c.push(this.gazeBuffer[this.gazeBuffer.length - 1].timestampMs);
        if (this.rppgBuffer.length) c.push(this.rppgBuffer[this.rppgBuffer.length - 1].timestampMs);
        if (this.tickTotal.length) c.push(this.tickTotal[this.tickTotal.length - 1]);
        return c.length ? Math.max(...c) : null;
    }

    private trim(latestMs: number): void {
        const cutoff = latestMs - this.windowMs;
        while (this.gazeBuffer.length && this.gazeBuffer[0].timestampMs < cutoff) this.gazeBuffer.shift();
        while (this.rppgBuffer.length && this.rppgBuffer[0].timestampMs < cutoff) this.rppgBuffer.shift();
        while (this.tickTotal.length && this.tickTotal[0] < cutoff) this.tickTotal.shift();
        while (this.tickValid.length && this.tickValid[0] < cutoff) this.tickValid.shift();
    }

    private compute(tEnd: number): FeatureVector {
        let saccadeRateHz = 0, fixationRatio = 0, meanFixDurS = 0;
        let meanVelPxS = 0, stdVelPxS = 0, dispX = 0, dispY = 0;
        let meanEar = NaN, minEar = NaN;

        if (this.gazeBuffer.length > 0) {
            const duration = Math.max((tEnd - this.gazeBuffer[0].timestampMs) / 1000, 0.001);
            saccadeRateHz = this.gazeBuffer.filter(g => g.isSaccade).length / duration;
            fixationRatio = this.gazeBuffer.filter(g => g.inFixation).length / this.gazeBuffer.length;
            const runs = this.fixationRunDurations();
            meanFixDurS = runs.length === 0 ? 0 : avg(runs);
            const vels = this.gazeBuffer.map(g => g.velocityPxPerS);
            meanVelPxS = avg(vels);
            stdVelPxS = std(vels);
            const xs = this.gazeBuffer.map(g => g.screenX);
            const ys = this.gazeBuffer.map(g => g.screenY);
            dispX = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;
            dispY = ys.length > 1 ? Math.max(...ys) - Math.min(...ys) : 0;
            const ears = this.gazeBuffer.map(g => g.ear).filter(Number.isFinite);
            meanEar = ears.length ? avg(ears) : NaN;
            minEar = ears.length ? Math.min(...ears) : NaN;
        }

        const hrv = this.computeHrvFiltered();
        const validRatio = this.tickTotal.length ? this.tickValid.length / this.tickTotal.length : 0;

        return {
            timestampMs: tEnd,
            saccadeRateHz, fixationRatio, meanFixDurationS: meanFixDurS,
            meanVelocityPxS: meanVelPxS, stdVelocityPxS: stdVelPxS,
            gazeDispersionXPx: dispX, gazeDispersionYPx: dispY,
            meanEar, minEar,
            bpm: hrv.bpm, rmssdMs: hrv.rmssdMs, sdnnMs: hrv.sdnnMs, lfHfRatio: hrv.lfHfRatio,
            validRatio,
        };
    }

    private fixationRunDurations(): number[] {
        const runs: number[] = [];
        let runStart: number | null = null;
        for (const g of this.gazeBuffer) {
            if (g.inFixation) {
                if (runStart == null) runStart = g.timestampMs;
            } else if (runStart != null) {
                runs.push((g.timestampMs - runStart) / 1000);
                runStart = null;
            }
        }
        if (runStart != null && this.gazeBuffer.length)
            runs.push((this.gazeBuffer[this.gazeBuffer.length - 1].timestampMs - runStart) / 1000);
        return runs;
    }

    private computeHrvFiltered(): HRVMetrics {
        if (this.rppgBuffer.length < this.minSamplesForHrv) return emptyHRV();
        const rgbs: number[][] = [];
        const ts: number[] = [];
        for (const r of this.rppgBuffer) {
            const m = mergedRGB(r);
            if (!m) continue;
            rgbs.push(m); ts.push(r.timestampMs);
        }
        if (rgbs.length < this.minSamplesForHrv) return emptyHRV();
        const span = (ts[ts.length - 1] - ts[0]) / 1000;
        if (span < 1) return emptyHRV();
        const fs = (ts.length - 1) / span;
        if (fs < 4) return emptyHRV();

        const hrv = computeHrv(rgbs, fs, 'pos', 1.5);

        // BPM 연속성 필터
        if (!Number.isFinite(hrv.bpm)) { this.bpmConsecutiveRejects = 0; return hrv; }
        if (this.bpmHistory.length > 0) {
            const sorted = [...this.bpmHistory].sort((a, b) => a - b);
            const median = sorted[sorted.length >> 1];
            if (Math.abs(hrv.bpm - median) > this.maxBpmJump) {
                this.bpmConsecutiveRejects++;
                if (this.bpmConsecutiveRejects >= 3) {
                    this.bpmHistory = [hrv.bpm];
                    this.bpmConsecutiveRejects = 0;
                    return hrv;
                }
                return { ...emptyHRV(), nBeats: hrv.nBeats };
            }
        }
        this.bpmConsecutiveRejects = 0;
        if (this.bpmHistory.length >= 5) this.bpmHistory.shift();
        this.bpmHistory.push(hrv.bpm);
        return hrv;
    }
}
