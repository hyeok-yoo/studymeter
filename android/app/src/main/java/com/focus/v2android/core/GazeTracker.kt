package com.focus.v2android.core

import android.os.SystemClock
import kotlin.math.hypot
import kotlin.math.sqrt

/**
 * Python core/gaze_tracker.py 포트.
 * I-VT saccade + I-DT fixation + EAR 계산.
 * 입력: MediaPipe FaceLandmarker 정규화 랜드마크 (478*2 flattened FloatArray)
 */
class GazeTracker(
    private val calibration: CalibrationModel,
    private val saccadeVelocityPxS: Float = 1500f,
    private val fixationDispersionPx: Float = 100f,
    private val fixationMinDurationS: Float = 0.12f,
    private val dispersionWindow: Int = 10,
    private val smoothingAlpha: Float = 0.35f
) {
    // EMA 상태
    private var smoothedX: Float? = null
    private var smoothedY: Float? = null
    private var prevSample: GazeSample? = null

    // Fixation 상태
    private var fixationStart: Long? = null
    private val fixationWindow = ArrayDeque<Triple<Long, Float, Float>>(dispersionWindow)

    fun reset() {
        smoothedX = null; smoothedY = null
        prevSample = null
        fixationStart = null
        fixationWindow.clear()
    }

    /**
     * 478개 정규화 랜드마크(flattened xy)에서 GazeSample 생성.
     * Python process_with_landmarks()와 동일.
     */
    fun processWithLandmarks(landmarks: FloatArray): GazeSample? {
        val (fx, fy) = calibration.extractGazeFeature(landmarks) ?: run {
            reset()
            return null
        }

        val now = SystemClock.elapsedRealtime()

        // 화면 좌표 EMA 스무딩
        val rawX: Float
        val rawY: Float
        val (rx, ry) = calibration.apply(fx, fy)
        rawX = rx; rawY = ry

        val alpha = smoothingAlpha.coerceIn(0.05f, 1f)
        smoothedX = if (smoothedX == null) rawX else alpha * rawX + (1f - alpha) * smoothedX!!
        smoothedY = if (smoothedY == null) rawY else alpha * rawY + (1f - alpha) * smoothedY!!
        val sx = smoothedX!!; val sy = smoothedY!!

        // 속도 계산
        val velocity = prevSample?.let { prev ->
            val dt = maxOf((now - prev.timestampMs) / 1000f, 0.001f)
            hypot(sx - prev.screenX, sy - prev.screenY) / dt
        } ?: 0f

        val isSaccade = velocity > saccadeVelocityPxS
        val (inFix, fixDur) = updateFixation(now, sx, sy, isSaccade)

        // EAR
        val ear = calibration.computeMeanEar(landmarks)

        val sample = GazeSample(
            timestampMs = now,
            featureX = fx, featureY = fy,
            screenX = sx, screenY = sy,
            velocityPxPerS = velocity,
            isSaccade = isSaccade,
            inFixation = inFix,
            fixationDurationS = fixDur,
            ear = ear
        )
        prevSample = sample
        return sample
    }

    private fun updateFixation(nowMs: Long, sx: Float, sy: Float, isSaccade: Boolean): Pair<Boolean, Float> {
        if (isSaccade) {
            fixationStart = null
            fixationWindow.clear()
            return Pair(false, 0f)
        }
        if (fixationWindow.size >= dispersionWindow) fixationWindow.removeFirst()
        fixationWindow.addLast(Triple(nowMs, sx, sy))

        val xs = fixationWindow.map { it.second }
        val ys = fixationWindow.map { it.third }
        val dispersion = (xs.max()!! - xs.min()!!) + (ys.max()!! - ys.min()!!)

        if (dispersion <= fixationDispersionPx) {
            if (fixationStart == null) fixationStart = fixationWindow.first().first
            val durS = (nowMs - fixationStart!!) / 1000f
            return Pair(durS >= fixationMinDurationS, durS)
        }
        fixationStart = null
        return Pair(false, 0f)
    }
}
