/**
 * focus/featureExtractor.ts — engine/FeatureExtractor.kt 의 TS 포트.
 * 10s 슬라이딩 윈도우로 특징 벡터를 1s stride로 방출.
 *
 * v3(2026-06-12): focus_v2 engine/feature_extractor.py의 DMS 표준 지표 중
 * 순수 수학으로 계산 가능한 7개(perclos·블링크 2종·ear_norm·disp_norm·추세 2종)를
 * 동일 의미로 이식. 헤드포즈 3종은 웹 파이프라인 범위 밖(NaN 고정).
 */
import { type FeatureVector, type GazeSample, type RPPGSample, type HRVMetrics, emptyHRV, mergedRGB } from './types';
import { computeHrv } from './signalProcessing';

function avg(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length; }

/**
 * 히스테리시스 기반 눈감김 이벤트 검출 → 지속시간(초) 리스트.
 * 시작: ear < 0.6×b / 종료: ear ≥ 0.75×b (이중 임계 — 경계 채터링 방지).
 * 윈도우 끝에서 진행 중인(종료 안 된) 이벤트는 제외. (Python _closure_events 동일)
 */
function closureEvents(earSeries: { t: number; e: number }[], b: number): number[] {
    const durations: number[] = [];
    let inEvent = false, startT = 0, lastInT = 0;
    for (const { t, e } of earSeries) {
        if (!inEvent) {
            if (e < 0.6 * b) { inEvent = true; startT = lastInT = t; }
        } else if (e >= 0.75 * b) {
            durations.push(lastInT - startT);
            inEvent = false;
        } else {
            lastInT = t;
        }
    }
    return durations;
}
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

    // v3: 적응형 EAR 베이스라인 (세션 누적, 90퍼센타일) + 60초 추세 이력
    private adaptiveEar: { t: number; e: number }[] = [];
    private adaptiveLastT = -Infinity;
    private emitHistory: { t: number; meanEar: number; fixRatio: number }[] = [];

    /** 캘리브레이션 EAR 베이스라인 (없으면 NaN → 적응형 폴백). */
    baselineEar = NaN;
    /** disp_norm용 화면 크기 — 파이프라인이 설정. */
    screenSize: [number, number] | null = null;

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
        this.adaptiveEar = []; this.adaptiveLastT = -Infinity;
        this.emitHistory = [];
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

        // ---- v3 DMS 표준 지표 (emit 시점 1회만 계산 — per-push 비용 없음) ----
        this.accumulateAdaptiveEar();
        const b = this.earBaseline();

        // 윈도우 내 finite EAR 시계열 (초 단위 timestamp)
        const earSeries: { t: number; e: number }[] = this.gazeBuffer
            .filter(g => Number.isFinite(g.ear))
            .map(g => ({ t: g.timestampMs / 1000, e: g.ear }));
        const winLenS = this.gazeBuffer.length
            ? Math.max((tEnd - this.gazeBuffer[0].timestampMs) / 1000, 1e-3)
            : NaN;

        // PERCLOS P80 근사 — EAR이 눈 감김에 대략 선형이라 0.4×baseline ≈ 80% 감김
        let perclos = NaN;
        if (Number.isFinite(b) && earSeries.length >= 10) {
            perclos = earSeries.filter(s => s.e < 0.4 * b).length / earSeries.length;
        }

        // 눈감김 이벤트 (히스테리시스: ear < 0.6b 시작, ear ≥ 0.75b 종료)
        let blinkRateHz = NaN, meanBlinkDurS = NaN;
        if (Number.isFinite(b) && earSeries.length > 0) {
            const durs = closureEvents(earSeries, b);
            // 블링크 = 지속 ≤0.5s 이벤트. 0개면 0.0 (nan 아님 — "안 깜빡임"도 유효 정보)
            blinkRateHz = durs.filter(d => d <= 0.5).length / winLenS;
            meanBlinkDurS = durs.length ? avg(durs) : NaN;
        }

        const earNorm = Number.isFinite(b) && Number.isFinite(meanEar) ? meanEar / b : NaN;

        let dispNorm = NaN;
        if (this.screenSize && Math.max(...this.screenSize) > 0) {
            dispNorm = Math.max(dispX, dispY) / Math.max(...this.screenSize);
        }

        // 60초 추세 (emit 윈도우 간 시계열 문맥) — nan이어도 기록, finite 필터는 fit 시점에
        const tEndS = tEnd / 1000;
        this.emitHistory.push({ t: tEndS, meanEar, fixRatio: fixationRatio });
        while (this.emitHistory.length && this.emitHistory[0].t < tEndS - 60) this.emitHistory.shift();
        const earSlope60s = this.historySlopePerMin(h => h.meanEar);
        const fixRatioSlope60s = this.historySlopePerMin(h => h.fixRatio);

        return {
            timestampMs: tEnd,
            saccadeRateHz, fixationRatio, meanFixDurationS: meanFixDurS,
            meanVelocityPxS: meanVelPxS, stdVelocityPxS: stdVelPxS,
            gazeDispersionXPx: dispX, gazeDispersionYPx: dispY,
            meanEar, minEar,
            bpm: hrv.bpm, rmssdMs: hrv.rmssdMs, sdnnMs: hrv.sdnnMs, lfHfRatio: hrv.lfHfRatio,
            validRatio,
            perclos, blinkRateHz, meanBlinkDurS, earNorm, dispNorm,
            earSlope60s, fixRatioSlope60s,
            hrvNBeats: hrv.nBeats,
        };
    }

    /** 적응형 EAR 베이스라인용 샘플 누적 — 직전 emit 이후 finite EAR만 추가. */
    private accumulateAdaptiveEar(): void {
        for (const g of this.gazeBuffer) {
            const t = g.timestampMs / 1000;
            if (t > this.adaptiveLastT && Number.isFinite(g.ear)) {
                this.adaptiveEar.push({ t, e: g.ear });
            }
        }
        if (this.gazeBuffer.length) {
            this.adaptiveLastT = Math.max(
                this.adaptiveLastT,
                this.gazeBuffer[this.gazeBuffer.length - 1].timestampMs / 1000,
            );
        }
        // 장시간 세션 메모리/퍼센타일 비용 상한 (≈40분 @15fps)
        const MAX = 36_000;
        if (this.adaptiveEar.length > MAX) this.adaptiveEar.splice(0, this.adaptiveEar.length - MAX);
    }

    /**
     * 개인 EAR 베이스라인: ① 캘리 값 우선 → ② 세션 누적 ≥100개 & 스팬 ≥15초면
     * 90퍼센타일("눈 뜬 상태" 대표값) → ③ 미달 시 NaN. (Python _ear_baseline 동일)
     */
    private earBaseline(): number {
        if (Number.isFinite(this.baselineEar)) return this.baselineEar;
        if (this.adaptiveEar.length >= 100) {
            const span = this.adaptiveEar[this.adaptiveEar.length - 1].t - this.adaptiveEar[0].t;
            if (span >= 15) {
                const vals = this.adaptiveEar.map(s => s.e).sort((a, c) => a - c);
                const idx = Math.min(vals.length - 1, Math.floor(0.9 * (vals.length - 1) + 0.5));
                return vals[idx];
            }
        }
        return NaN;
    }

    /** emit 이력 1차 추세 기울기 (값/분). finite ≥5개 & 스팬 ≥30초 필요. */
    private historySlopePerMin(pick: (h: { t: number; meanEar: number; fixRatio: number }) => number): number {
        const pts = this.emitHistory
            .map(h => ({ t: h.t, v: pick(h) }))
            .filter(p => Number.isFinite(p.v));
        if (pts.length < 5) return NaN;
        const span = pts[pts.length - 1].t - pts[0].t;
        if (span < 30) return NaN;
        const mt = avg(pts.map(p => p.t));
        const mv = avg(pts.map(p => p.v));
        let num = 0, den = 0;
        for (const p of pts) { num += (p.t - mt) * (p.v - mv); den += (p.t - mt) ** 2; }
        if (den === 0) return NaN;
        return (num / den) * 60; // /초 → /분
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
