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

/**
 * 특징 벡터 — 기본 14개(Python FEATURE_NAMES v2와 동일 순서) +
 * v3 신규 피처 중 순수 수학으로 계산 가능한 7개 (헤드포즈 3종은 범위 밖, NaN 고정).
 * 신규 피처는 계산 불가 시 NaN.
 */
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
    // ---- v3 신규 (DMS 표준 졸음 지표 + 시간 추세) ----
    perclos: number;            // EAR < 0.4×baseline 시간 비율 (PERCLOS P80 근사)
    blinkRateHz: number;        // 블링크(지속 ≤0.5s 눈감김) 빈도
    meanBlinkDurS: number;      // 모든 눈감김 이벤트 평균 지속시간
    earNorm: number;            // mean_ear ÷ 개인 EAR 베이스라인 (세션 90퍼센타일 폴백)
    dispNorm: number;           // max(분산) ÷ max(화면 크기)
    earSlope60s: number;        // mean_ear 60초 추세 (값/분)
    fixRatioSlope60s: number;   // fixation_ratio 60초 추세 (값/분)
    /** HRV 박동 수 — 피처 아님, 수집 CSV의 hrv_n_beats 컬럼용. */
    hrvNBeats: number;
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

/** 점수 산출 경로 — 로컬 학습 모델 > ONNX > 휴리스틱 순 우선순위. */
export type ScoreSource = 'local' | 'onnx' | 'heuristic';

/** 파이프라인 최종 출력. (FocusResult 포트) */
export interface FocusResult {
    score: number;
    etaS: number | null;
    features: FeatureVector | null;
    isHeuristicMode: boolean;
    scoreSource: ScoreSource;
    /** scoreSource가 'local'일 때 적용 중인 로컬 모델 이름. */
    localModelName: string | null;
    gazeScreenX: number | null;
    gazeScreenY: number | null;
    roiForehead: number[] | null;
    roiRightCheek: number[] | null;
    roiLeftCheek: number[] | null;
    landmarksFlat: Float32Array | null;
}
