package com.focus.v2android.core

import kotlin.math.sqrt

/** GazeSample: Python GazeSample에 대응. timestamp는 SystemClock.elapsedRealtime() ms. */
data class GazeSample(
    val timestampMs: Long,
    val featureX: Float,
    val featureY: Float,
    val screenX: Float,
    val screenY: Float,
    val velocityPxPerS: Float,
    val isSaccade: Boolean,
    val inFixation: Boolean,
    val fixationDurationS: Float,
    val ear: Float = Float.NaN
)

/** RPPGSample: ROI별 평균 RGB (R, G, B). null이면 해당 ROI 미검출. */
data class RPPGSample(
    val timestampMs: Long,
    val foreheadRGB: FloatArray? = null,
    val rightCheekRGB: FloatArray? = null,
    val leftCheekRGB: FloatArray? = null
) {
    /** 이마(w=2) + 뺨(w=1) 가중평균. */
    fun mergedRGB(): FloatArray? {
        val weights = mutableListOf<Float>()
        val rgbs = mutableListOf<FloatArray>()
        foreheadRGB?.let { weights += 2f; rgbs += it }
        rightCheekRGB?.let { weights += 1f; rgbs += it }
        leftCheekRGB?.let { weights += 1f; rgbs += it }
        if (rgbs.isEmpty()) return null
        val totalW = weights.sum()
        return floatArrayOf(
            rgbs.indices.sumOf { i -> (rgbs[i][0] * weights[i] / totalW).toDouble() }.toFloat(),
            rgbs.indices.sumOf { i -> (rgbs[i][1] * weights[i] / totalW).toDouble() }.toFloat(),
            rgbs.indices.sumOf { i -> (rgbs[i][2] * weights[i] / totalW).toDouble() }.toFloat()
        )
    }
}

/** 14개 특징 벡터 (Python FEATURE_NAMES와 동일 순서). */
data class FeatureVector(
    val timestampMs: Long,
    val saccadeRateHz: Float,
    val fixationRatio: Float,
    val meanFixDurationS: Float,
    val meanVelocityPxS: Float,
    val stdVelocityPxS: Float,
    val gazeDispersionXPx: Float,
    val gazeDispersionYPx: Float,
    val meanEar: Float,
    val minEar: Float,
    val bpm: Float,
    val rmssdMs: Float,
    val sdnnMs: Float,
    val lfHfRatio: Float,
    val validRatio: Float
) {
    /** ONNX 입력용 FloatArray (14개). FEATURE_NAMES 순서와 일치. */
    fun toFloatArray(): FloatArray = floatArrayOf(
        saccadeRateHz, fixationRatio, meanFixDurationS,
        meanVelocityPxS, stdVelocityPxS,
        gazeDispersionXPx, gazeDispersionYPx,
        meanEar, minEar,
        bpm, rmssdMs, sdnnMs, lfHfRatio,
        validRatio
    )
}

data class HRVMetrics(
    val bpm: Float,
    val rmssdMs: Float,
    val sdnnMs: Float,
    val lfPower: Float,
    val hfPower: Float,
    val lfHfRatio: Float,
    val nBeats: Int
) {
    companion object {
        fun empty() = HRVMetrics(Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN, 0)
    }
    fun isValid() = nBeats >= 3 && bpm.isFinite()
}

/** ETAForecaster 출력. */
data class ETAResult(
    val etaS: Float?,          // null = 도달 불가/안전
    val scoreSmoothed: Float,
    val derivative: Float,
    val secondDerivative: Float,
    val fitDegree: Int
)

/** 파이프라인 최종 출력. */
data class FocusResult(
    val score: Float,
    val etaS: Float?,
    val features: FeatureVector?,
    val isHeuristicMode: Boolean,
    // live debug data (nullable — only populated when face detected)
    val gazeScreenX: Float? = null,
    val gazeScreenY: Float? = null,
    val roiForehead: FloatArray? = null,   // [R, G, B] 0-255
    val roiRightCheek: FloatArray? = null,
    val roiLeftCheek: FloatArray? = null,
    val landmarksFlat: FloatArray? = null  // 478*2 normalized, for overlay drawing
)

/** 캘리브레이션 포인트 쌍: 시선 특징(2D) ↔ 화면 픽셀 좌표(2D). */
data class CalibPoint(val gazeX: Float, val gazeY: Float, val screenX: Float, val screenY: Float)

