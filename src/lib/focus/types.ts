/**
 * focus/types.ts — 안드로이드 네이티브 엔진(core/Models.kt)의 TS 포트.
 * 브라우저 내 집중도 감지 파이프라인에서 공유하는 자료구조.
 */

export interface GazeSample {
    timestampMs: number;
    featureX: number;
    featureY: number;
    screenX: number;
    screenY: number;
    velocityPxPerS: number;
    isSaccade: boolean;
    inFixation: boolean;
    fixationDurationS: number;
    ear: number; // NaN 가능
}

/** ROI별 평균 RGB. null이면 미검출. */
export interface RPPGSample {
    timestampMs: number;
    foreheadRGB: number[] | null;
    rightCheekRGB: number[] | null;
    leftCheekRGB: number[] | null;
}

/** 이마(w=2) + 좌/우 뺨(w=1) 가중평균 RGB. */
export function mergedRGB(s: RPPGSample): number[] | null {
    const weights: number[] = [];
    const rgbs: number[][] = [];
    if (s.foreheadRGB) { weights.push(2); rgbs.push(s.foreheadRGB); }
    if (s.rightCheekRGB) { weights.push(1); rgbs.push(s.rightCheekRGB); }
    if (s.leftCheekRGB) { weights.push(1); rgbs.push(s.leftCheekRGB); }
    if (rgbs.length === 0) return null;
    const totalW = weights.reduce((a, b) => a + b, 0);
    return [0, 1, 2].map(c =>
        rgbs.reduce((acc, rgb, i) => acc + (rgb[c] * weights[i]) / totalW, 0)
    );
}

/** 14개 특징 벡터 (Python FEATURE_NAMES와 동일 순서). */
export interface FeatureVector {
    timestampMs: number;
    saccadeRateHz: number;
    fixationRatio: number;
    meanFixDurationS: number;
    meanVelocityPxS: number;
    stdVelocityPxS: number;
    gazeDispersionXPx: number;
    gazeDispersionYPx: number;
    meanEar: number;
    minEar: number;
    bpm: number;
    rmssdMs: number;
    sdnnMs: number;
    lfHfRatio: number;
    validRatio: number;
}

/** ONNX 입력용 Float32Array (14개). FEATURE_NAMES 순서와 일치. */
export function featureToArray(f: FeatureVector): Float32Array {
    return new Float32Array([
        f.saccadeRateHz, f.fixationRatio, f.meanFixDurationS,
        f.meanVelocityPxS, f.stdVelocityPxS,
        f.gazeDispersionXPx, f.gazeDispersionYPx,
        f.meanEar, f.minEar,
        f.bpm, f.rmssdMs, f.sdnnMs, f.lfHfRatio,
        f.validRatio,
    ]);
}

export interface HRVMetrics {
    bpm: number;
    rmssdMs: number;
    sdnnMs: number;
    lfPower: number;
    hfPower: number;
    lfHfRatio: number;
    nBeats: number;
}

export function emptyHRV(): HRVMetrics {
    return { bpm: NaN, rmssdMs: NaN, sdnnMs: NaN, lfPower: NaN, hfPower: NaN, lfHfRatio: NaN, nBeats: 0 };
}

export interface ETAResult {
    etaS: number | null;
    scoreSmoothed: number;
    derivative: number;
    secondDerivative: number;
    fitDegree: number;
}

/** 파이프라인 최종 출력. (FocusResult 포트) */
export interface FocusResult {
    score: number;
    etaS: number | null;
    features: FeatureVector | null;
    isHeuristicMode: boolean;
    gazeScreenX: number | null;
    gazeScreenY: number | null;
    roiForehead: number[] | null;
    roiRightCheek: number[] | null;
    roiLeftCheek: number[] | null;
    landmarksFlat: Float32Array | null;
}
