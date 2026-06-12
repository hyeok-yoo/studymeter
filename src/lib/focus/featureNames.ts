/**
 * focus/featureNames.ts — PC 백엔드(focus_v2)와 호환되는 정규 피처 이름 정의.
 *
 * - 이름/순서는 focus_v2 `engine/feature_extractor.py`의 FEATURE_NAMES(v3, 24개)와 동일.
 * - 로컬 수집 CSV·온디바이스 학습기·로컬 모델 추론이 모두 이 "이름 기반" 매핑을 공유한다.
 *   (없는 피처는 NaN → 학습/추론 시 평균 대치 — focus_v2 분류기 _vectorize와 같은 철학)
 * - 헤드포즈 3종(head_pitch_deg/head_yaw_deg/head_move_std_deg)은 웹 파이프라인 범위 밖
 *   → 항상 NaN으로 기록된다.
 */
import type { FeatureVector } from './types';

/** v3 피처 이름 24개 (focus_v2 FEATURE_NAMES와 동일 순서 — 변경 금지). */
export const FEATURE_NAMES_V3: readonly string[] = [
    'saccade_rate_hz',
    'fixation_ratio',
    'mean_fix_duration_s',
    'mean_velocity_px_s',
    'std_velocity_px_s',
    'gaze_dispersion_x_px',
    'gaze_dispersion_y_px',
    'mean_ear',
    'min_ear',
    'bpm',
    'rmssd_ms',
    'sdnn_ms',
    'lf_hf_ratio',
    'valid_ratio',
    'perclos',
    'blink_rate_hz',
    'mean_blink_dur_s',
    'ear_norm',
    'disp_norm',
    'head_pitch_deg',
    'head_yaw_deg',
    'head_move_std_deg',
    'ear_slope_60s',
    'fix_ratio_slope_60s',
] as const;

/** 수집 CSV 전체 컬럼 (focus_v2 engine/data_collector.py _COLUMNS v3와 동일). */
export const CSV_COLUMNS: readonly string[] = [
    'timestamp',
    'window_s',
    ...FEATURE_NAMES_V3,
    'hrv_n_beats',
    'focus_score',
    'label',
] as const;

/** TS FeatureVector(카멜케이스) → 정규 이름(snake_case) 레코드. 없는 값은 NaN. */
export function featureVectorToRecord(f: FeatureVector): Record<string, number> {
    return {
        saccade_rate_hz: f.saccadeRateHz,
        fixation_ratio: f.fixationRatio,
        mean_fix_duration_s: f.meanFixDurationS,
        mean_velocity_px_s: f.meanVelocityPxS,
        std_velocity_px_s: f.stdVelocityPxS,
        gaze_dispersion_x_px: f.gazeDispersionXPx,
        gaze_dispersion_y_px: f.gazeDispersionYPx,
        mean_ear: f.meanEar,
        min_ear: f.minEar,
        bpm: f.bpm,
        rmssd_ms: f.rmssdMs,
        sdnn_ms: f.sdnnMs,
        lf_hf_ratio: f.lfHfRatio,
        valid_ratio: f.validRatio,
        perclos: f.perclos,
        blink_rate_hz: f.blinkRateHz,
        mean_blink_dur_s: f.meanBlinkDurS,
        ear_norm: f.earNorm,
        disp_norm: f.dispNorm,
        head_pitch_deg: NaN, // 헤드포즈 — 웹 파이프라인 미지원 (NaN → 학습 시 평균 대치)
        head_yaw_deg: NaN,
        head_move_std_deg: NaN,
        ear_slope_60s: f.earSlope60s,
        fix_ratio_slope_60s: f.fixRatioSlope60s,
    };
}
