package com.focus.v2android.engine

import android.os.SystemClock
import com.focus.v2android.core.FeatureVector
import com.focus.v2android.core.GazeSample
import com.focus.v2android.core.RPPGSample
import com.focus.v2android.utils.SignalProcessing
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Python engine/feature_extractor.py 포트.
 * 10s 슬라이딩 윈도우로 14개 특징 벡터를 1s stride로 방출.
 */
class FeatureExtractor(
    private val windowMs: Long = 10_000L,
    private val strideMs: Long = 1_000L,
    private val minSamplesForHrv: Int = 80,
    private val maxBpmJump: Float = 15f
) {
    private val gazeBuffer = ArrayDeque<GazeSample>()
    private val rppgBuffer = ArrayDeque<RPPGSample>()
    private val tickTotal = ArrayDeque<Long>()
    private val tickValid = ArrayDeque<Long>()
    private var lastEmitMs: Long? = null

    // BPM 연속성 필터
    private val bpmHistory = ArrayDeque<Float>(5)
    private var bpmConsecutiveRejects = 0

    fun pushGaze(sample: GazeSample?, nowMs: Long = SystemClock.elapsedRealtime()) {
        tickTotal.addLast(nowMs)
        if (sample != null) {
            gazeBuffer.addLast(sample)
            tickValid.addLast(nowMs)
        }
        trim(nowMs)
    }

    fun pushRppg(sample: RPPGSample) {
        rppgBuffer.addLast(sample)
        trim(sample.timestampMs)
    }

    fun maybeEmit(): FeatureVector? {
        val latest = latestT() ?: return null
        val last = lastEmitMs
        if (last == null) {
            if (tickTotal.isEmpty()) return null
            val span = latest - tickTotal.first()
            if (span < windowMs / 2) return null
        } else {
            if (latest - last < strideMs) return null
        }
        lastEmitMs = latest
        return compute(latest)
    }

    private fun latestT(): Long? {
        val candidates = listOfNotNull(
            gazeBuffer.lastOrNull()?.timestampMs,
            rppgBuffer.lastOrNull()?.timestampMs,
            tickTotal.lastOrNull()
        )
        return candidates.maxOrNull()
    }

    private fun trim(latestMs: Long) {
        val cutoff = latestMs - windowMs
        while (gazeBuffer.isNotEmpty() && gazeBuffer.first().timestampMs < cutoff) gazeBuffer.removeFirst()
        while (rppgBuffer.isNotEmpty() && rppgBuffer.first().timestampMs < cutoff) rppgBuffer.removeFirst()
        while (tickTotal.isNotEmpty() && tickTotal.first() < cutoff) tickTotal.removeFirst()
        while (tickValid.isNotEmpty() && tickValid.first() < cutoff) tickValid.removeFirst()
    }

    private fun compute(tEnd: Long): FeatureVector {
        // ----- Gaze 집계 -----
        val saccadeRateHz: Float
        val fixationRatio: Float
        val meanFixDurS: Float
        val meanVelPxS: Float
        val stdVelPxS: Float
        val dispX: Float
        val dispY: Float
        val meanEar: Float
        val minEar: Float

        if (gazeBuffer.isNotEmpty()) {
            val duration = maxOf((tEnd - gazeBuffer.first().timestampMs) / 1000f, 0.001f)
            saccadeRateHz = gazeBuffer.count { it.isSaccade } / duration
            fixationRatio = gazeBuffer.count { it.inFixation }.toFloat() / gazeBuffer.size
            meanFixDurS = fixationRunDurations().let { if (it.isEmpty()) 0f else it.average().toFloat() }
            val vels = gazeBuffer.map { it.velocityPxPerS }
            meanVelPxS = vels.average().toFloat()
            stdVelPxS = vels.std()
            val xs = gazeBuffer.map { it.screenX }
            val ys = gazeBuffer.map { it.screenY }
            dispX = if (xs.size > 1) xs.max()!! - xs.min()!! else 0f
            dispY = if (ys.size > 1) ys.max()!! - ys.min()!! else 0f
            val ears = gazeBuffer.map { it.ear }.filter { it.isFinite() }
            meanEar = if (ears.isNotEmpty()) ears.average().toFloat() else Float.NaN
            minEar  = if (ears.isNotEmpty()) ears.min()!!.toFloat() else Float.NaN
        } else {
            saccadeRateHz = 0f; fixationRatio = 0f; meanFixDurS = 0f
            meanVelPxS = 0f; stdVelPxS = 0f; dispX = 0f; dispY = 0f
            meanEar = Float.NaN; minEar = Float.NaN
        }

        // ----- HRV -----
        val hrv = computeHrv()

        // ----- 품질 -----
        val validRatio = if (tickTotal.isNotEmpty()) tickValid.size.toFloat() / tickTotal.size else 0f

        return FeatureVector(
            timestampMs = tEnd,
            saccadeRateHz = saccadeRateHz,
            fixationRatio = fixationRatio,
            meanFixDurationS = meanFixDurS,
            meanVelocityPxS = meanVelPxS,
            stdVelocityPxS = stdVelPxS,
            gazeDispersionXPx = dispX,
            gazeDispersionYPx = dispY,
            meanEar = meanEar,
            minEar = minEar,
            bpm = hrv.bpm,
            rmssdMs = hrv.rmssdMs,
            sdnnMs = hrv.sdnnMs,
            lfHfRatio = hrv.lfHfRatio,
            validRatio = validRatio
        )
    }

    private fun fixationRunDurations(): List<Float> {
        val runs = mutableListOf<Float>()
        var runStart: Long? = null
        for (g in gazeBuffer) {
            if (g.inFixation) {
                if (runStart == null) runStart = g.timestampMs
            } else {
                if (runStart != null) {
                    runs += (g.timestampMs - runStart!!) / 1000f
                    runStart = null
                }
            }
        }
        if (runStart != null && gazeBuffer.isNotEmpty())
            runs += (gazeBuffer.last().timestampMs - runStart!!) / 1000f
        return runs
    }

    private fun computeHrv(): com.focus.v2android.core.HRVMetrics {
        if (rppgBuffer.size < minSamplesForHrv) return com.focus.v2android.core.HRVMetrics.empty()
        val rgbs = mutableListOf<FloatArray>()
        val ts = mutableListOf<Long>()
        for (r in rppgBuffer) {
            val merged = r.mergedRGB() ?: continue
            rgbs += merged; ts += r.timestampMs
        }
        if (rgbs.size < minSamplesForHrv) return com.focus.v2android.core.HRVMetrics.empty()

        val span = (ts.last() - ts.first()) / 1000f
        if (span < 1f) return com.focus.v2android.core.HRVMetrics.empty()
        val fs = (ts.size - 1).toFloat() / span
        if (fs < 4f) return com.focus.v2android.core.HRVMetrics.empty()

        val hrv = SignalProcessing.computeHrv(rgbs.toTypedArray(), fs, "pos", 1.5f)

        // BPM 연속성 필터
        if (!hrv.bpm.isFinite()) {
            bpmConsecutiveRejects = 0
            return hrv
        }
        if (bpmHistory.isNotEmpty()) {
            val median = bpmHistory.sorted().let { it[it.size / 2] }
            if (abs(hrv.bpm - median) > maxBpmJump) {
                bpmConsecutiveRejects++
                if (bpmConsecutiveRejects >= 3) {
                    bpmHistory.clear(); bpmHistory.addLast(hrv.bpm)
                    bpmConsecutiveRejects = 0
                    return hrv
                }
                return com.focus.v2android.core.HRVMetrics.empty().copy(nBeats = hrv.nBeats)
            }
        }
        bpmConsecutiveRejects = 0
        if (bpmHistory.size >= 5) bpmHistory.removeFirst()
        bpmHistory.addLast(hrv.bpm)
        return hrv
    }

    private fun List<Float>.std(): Float {
        if (size < 2) return 0f
        val mean = average().toFloat()
        return sqrt(map { (it - mean) * (it - mean) }.average().toFloat())
    }
    private fun List<Float>.average(): Float = if (isEmpty()) 0f else sum() / size
}
