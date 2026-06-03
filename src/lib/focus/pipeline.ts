/**
 * focus/pipeline.ts — FocusPipeline.kt 의 TS 포트 (브라우저용).
 * MediaPipe FaceLandmarker(WASM) → GazeTracker + RPPGExtractor → FeatureExtractor
 *  → MLClassifier(ONNX) 또는 휴리스틱 → Forecaster.
 *
 * WASM 런타임은 CDN에서, 모델 파일은 자체 호스팅(public/focus-models)에서 로드한다.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { CalibrationModel } from './calibrationModel';
import { GazeTracker } from './gazeTracker';
import { RPPGExtractor } from './rppgExtractor';
import { FeatureExtractor } from './featureExtractor';
import { Forecaster } from './forecaster';
import { MLClassifier } from './mlClassifier';
import type { FocusResult, FeatureVector, GazeSample } from './types';

const MEDIAPIPE_WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

const FOREHEAD_IDX = [67, 109, 10, 338, 297, 299, 151, 69];
const RIGHT_CHEEK_IDX = [116, 123, 147, 213, 192, 207, 117];
const LEFT_CHEEK_IDX = [345, 352, 376, 433, 416, 427, 346];

/** 모델/임퓨트 파일 URL은 BASE_URL 기준으로 생성된다. */
function modelUrls() {
    const base = import.meta.env.BASE_URL;
    return {
        landmarker: `${base}focus-models/face_landmarker.task`,
        onnx: `${base}focus-models/focus_lgbm.onnx`,
        impute: `${base}focus-models/impute_means.txt`,
    };
}

export class FocusPipeline {
    private landmarker: FaceLandmarker | null = null;
    private calibration: CalibrationModel;
    private gazeTracker: GazeTracker;
    private rppg = new RPPGExtractor();
    private featureExtractor = new FeatureExtractor();
    private forecaster = new Forecaster();
    private classifier: MLClassifier;
    private lastFrameTs = 0;

    // rPPG 샘플링용 오프스크린 캔버스 (다운스케일)
    private procCanvas: HTMLCanvasElement;
    private procCtx: CanvasRenderingContext2D;
    private debugCanvas: HTMLCanvasElement;
    private debugCtx: CanvasRenderingContext2D;
    private debugFrameCounter = 0;

    debugEnabled = false;
    lastDebugJpeg: string | null = null;

    screenWidth = window.screen.width || 1080;
    screenHeight = window.screen.height || 1920;

    constructor() {
        this.calibration = CalibrationModel.load(this.screenWidth, this.screenHeight);
        this.gazeTracker = new GazeTracker(this.calibration);
        const urls = modelUrls();
        this.classifier = new MLClassifier(urls.onnx, urls.impute);

        this.procCanvas = document.createElement('canvas');
        this.procCanvas.width = 256; this.procCanvas.height = 192;
        this.procCtx = this.procCanvas.getContext('2d', { willReadFrequently: true })!;
        this.debugCanvas = document.createElement('canvas');
        this.debugCtx = this.debugCanvas.getContext('2d')!;
    }

    async init(): Promise<boolean> {
        await this.classifier.load(); // 실패해도 휴리스틱 폴백
        try {
            const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_CDN);
            this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: modelUrls().landmarker, delegate: 'GPU' },
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: false,
                runningMode: 'VIDEO',
            });
            return true;
        } catch (e) {
            console.error('FaceLandmarker init failed', e);
            this.landmarker = null;
            return false;
        }
    }

    /** 비디오 프레임 1장 처리. detectForVideo는 단조 증가 ts(ms) 필요. */
    async processFrame(video: HTMLVideoElement, nowMs: number): Promise<FocusResult | null> {
        const lm = this.landmarker;
        if (!lm) return null;
        const ts = Math.max(Math.round(nowMs), this.lastFrameTs + 1);
        this.lastFrameTs = ts;

        let result;
        try { result = lm.detectForVideo(video, ts); }
        catch (e) { console.error('detectForVideo error', e); return null; }

        const faces = result.faceLandmarks;
        if (!faces || faces.length === 0) {
            this.featureExtractor.pushGaze(null, nowMs);
            return null;
        }

        const pts = faces[0];
        const lmFlat = new Float32Array(pts.length * 2);
        for (let i = 0; i < pts.length; i++) { lmFlat[i * 2] = pts[i].x; lmFlat[i * 2 + 1] = pts[i].y; }

        const gazeSample = this.gazeTracker.processWithLandmarks(lmFlat, nowMs);
        this.featureExtractor.pushGaze(gazeSample, nowMs);

        // rPPG: 비디오 → 다운스케일 캔버스 → ImageData
        this.procCtx.drawImage(video, 0, 0, this.procCanvas.width, this.procCanvas.height);
        const imgData = this.procCtx.getImageData(0, 0, this.procCanvas.width, this.procCanvas.height);
        const rppgSample = this.rppg.processWithImageData(imgData, lmFlat, nowMs);
        this.featureExtractor.pushRppg(rppgSample);

        if (this.debugEnabled) {
            this.debugFrameCounter++;
            if (this.debugFrameCounter % 15 === 0) {
                this.lastDebugJpeg = this.buildDebugJpeg(video, lmFlat, gazeSample);
            }
        }

        const feat = this.featureExtractor.maybeEmit();
        if (!feat) return null;

        let score: number;
        let isHeuristic: boolean;
        if (this.classifier.isReady) {
            score = await this.classifier.predictFocusScore(feat);
            isHeuristic = false;
        } else {
            score = this.heuristicFocusScore(feat);
            isHeuristic = true;
        }

        const eta = this.forecaster.update(nowMs, score);

        return {
            score,
            etaS: eta.etaS,
            features: feat,
            isHeuristicMode: isHeuristic,
            gazeScreenX: gazeSample?.screenX ?? null,
            gazeScreenY: gazeSample?.screenY ?? null,
            roiForehead: rppgSample.foreheadRGB,
            roiRightCheek: rppgSample.rightCheekRGB,
            roiLeftCheek: rppgSample.leftCheekRGB,
            landmarksFlat: lmFlat,
        };
    }

    private heuristicFocusScore(feat: FeatureVector): number {
        if (feat.validRatio < 0.3) return 50;
        const fixDurScore = Math.min(1, feat.meanFixDurationS / 0.5);
        const maxDim = Math.max(this.screenWidth, this.screenHeight);
        const dispThreshold = maxDim * 0.625;
        const dispSpan = maxDim * 0.469;
        const maxDisp = Math.max(feat.gazeDispersionXPx, feat.gazeDispersionYPx);
        const dispScore = Math.min(Math.max((dispThreshold - maxDisp) / dispSpan, 0), 1);
        const trackFactor = 0.6 + 0.4 * Math.min(1, feat.validRatio / 0.7);
        const raw = 50 + 30 * fixDurScore + 20 * dispScore;
        return Math.min(Math.max(raw * trackFactor, 0), 100);
    }

    private buildDebugJpeg(video: HTMLVideoElement, lmFlat: Float32Array, gaze: GazeSample | null): string | null {
        try {
            const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
            const scale = 0.4;
            const w = Math.round(vw * scale), h = Math.round(vh * scale);
            if (this.debugCanvas.width !== w) { this.debugCanvas.width = w; this.debugCanvas.height = h; }
            const ctx = this.debugCtx;
            ctx.drawImage(video, 0, 0, w, h);

            const drawPoly = (idx: number[], color: string) => {
                ctx.strokeStyle = color; ctx.lineWidth = 1.5;
                ctx.beginPath();
                idx.forEach((p, i) => {
                    const x = lmFlat[p * 2] * w, y = lmFlat[p * 2 + 1] * h;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.closePath(); ctx.stroke();
            };
            drawPoly(FOREHEAD_IDX, '#00dcff');
            drawPoly(RIGHT_CHEEK_IDX, '#ffa000');
            drawPoly(LEFT_CHEEK_IDX, '#ffa000');

            if (gaze) {
                const dotX = (gaze.screenX / this.screenWidth) * w;
                const dotY = (gaze.screenY / this.screenHeight) * h;
                ctx.fillStyle = gaze.isSaccade ? '#ff5050' : '#50ff50';
                ctx.beginPath();
                ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
                ctx.fill();
            }
            return this.debugCanvas.toDataURL('image/jpeg', 0.55);
        } catch (e) {
            console.error('debug jpeg error', e);
            return null;
        }
    }

    reloadCalibration(): void {
        this.calibration = CalibrationModel.load(this.screenWidth, this.screenHeight);
        this.gazeTracker = new GazeTracker(this.calibration);
    }

    close(): void {
        try { this.landmarker?.close(); } catch { /* ignore */ }
        this.landmarker = null;
        this.classifier.close();
        this.featureExtractor.reset();
        this.forecaster.reset();
        this.gazeTracker.reset();
        this.lastDebugJpeg = null;
    }
}
