/**
 * focus/gazeTracker.ts — core/GazeTracker.kt 의 TS 포트.
 * I-VT saccade + I-DT fixation + EAR. 시간은 performance.now() ms 사용.
 */
import type { CalibrationModel } from './calibrationModel';
import type { GazeSample } from './types';

export class GazeTracker {
    private smoothedX: number | null = null;
    private smoothedY: number | null = null;
    private prevSample: GazeSample | null = null;
    private fixationStart: number | null = null;
    private fixationWindow: Array<[number, number, number]> = []; // [t, x, y]

    private calibration: CalibrationModel;
    private saccadeVelocityPxS: number;
    private fixationDispersionPx: number;
    private fixationMinDurationS: number;
    private dispersionWindow: number;
    private smoothingAlpha: number;

    constructor(
        calibration: CalibrationModel,
        saccadeVelocityPxS = 1500,
        fixationDispersionPx = 100,
        fixationMinDurationS = 0.12,
        dispersionWindow = 10,
        smoothingAlpha = 0.35,
    ) {
        this.calibration = calibration;
        this.saccadeVelocityPxS = saccadeVelocityPxS;
        this.fixationDispersionPx = fixationDispersionPx;
        this.fixationMinDurationS = fixationMinDurationS;
        this.dispersionWindow = dispersionWindow;
        this.smoothingAlpha = smoothingAlpha;
    }

    reset(): void {
        this.smoothedX = null; this.smoothedY = null;
        this.prevSample = null;
        this.fixationStart = null;
        this.fixationWindow = [];
    }

    processWithLandmarks(landmarks: Float32Array, nowMs: number): GazeSample | null {
        const feat = this.calibration.extractGazeFeature(landmarks);
        if (!feat) { this.reset(); return null; }
        const [fx, fy] = feat;

        const [rawX, rawY] = this.calibration.apply(fx, fy);
        const alpha = Math.min(Math.max(this.smoothingAlpha, 0.05), 1);
        this.smoothedX = this.smoothedX == null ? rawX : alpha * rawX + (1 - alpha) * this.smoothedX;
        this.smoothedY = this.smoothedY == null ? rawY : alpha * rawY + (1 - alpha) * this.smoothedY;
        const sx = this.smoothedX, sy = this.smoothedY;

        let velocity = 0;
        if (this.prevSample) {
            const dt = Math.max((nowMs - this.prevSample.timestampMs) / 1000, 0.001);
            velocity = Math.hypot(sx - this.prevSample.screenX, sy - this.prevSample.screenY) / dt;
        }
        const isSaccade = velocity > this.saccadeVelocityPxS;
        const [inFix, fixDur] = this.updateFixation(nowMs, sx, sy, isSaccade);
        const ear = this.calibration.computeMeanEar(landmarks);

        const sample: GazeSample = {
            timestampMs: nowMs,
            featureX: fx, featureY: fy,
            screenX: sx, screenY: sy,
            velocityPxPerS: velocity,
            isSaccade, inFixation: inFix,
            fixationDurationS: fixDur,
            ear,
        };
        this.prevSample = sample;
        return sample;
    }

    private updateFixation(nowMs: number, sx: number, sy: number, isSaccade: boolean): [boolean, number] {
        if (isSaccade) {
            this.fixationStart = null;
            this.fixationWindow = [];
            return [false, 0];
        }
        if (this.fixationWindow.length >= this.dispersionWindow) this.fixationWindow.shift();
        this.fixationWindow.push([nowMs, sx, sy]);

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [, wx, wy] of this.fixationWindow) {
            if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
            if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
        }
        const dispersion = (maxX - minX) + (maxY - minY);
        if (dispersion <= this.fixationDispersionPx) {
            if (this.fixationStart == null) this.fixationStart = this.fixationWindow[0][0];
            const durS = (nowMs - this.fixationStart) / 1000;
            return [durS >= this.fixationMinDurationS, durS];
        }
        this.fixationStart = null;
        return [false, 0];
    }
}
