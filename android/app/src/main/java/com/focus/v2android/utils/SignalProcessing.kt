package com.focus.v2android.utils

import com.focus.v2android.core.HRVMetrics
import org.apache.commons.math3.transform.DftNormalization
import org.apache.commons.math3.transform.FastFourierTransformer
import org.apache.commons.math3.transform.TransformType
import kotlin.math.*

object SignalProcessing {

    const val HR_LOW_HZ = 0.7f
    const val HR_HIGH_HZ = 4.0f
    private val fft = FastFourierTransformer(DftNormalization.STANDARD)

    // -----------------------------------------------------------------------
    // POS algorithm (Wang et al. 2017)
    // -----------------------------------------------------------------------
    fun posMethod(rgb: Array<FloatArray>, fs: Float, windowSeconds: Float = 1.6f): FloatArray {
        val N = rgb.size
        if (N < 2) return FloatArray(N)
        val L = maxOf((windowSeconds * fs).toInt(), 32).coerceAtMost(N)
        if (N < L) {
            val g = FloatArray(N) { rgb[it][1] }
            val mean = g.average().toFloat()
            return FloatArray(N) { g[it] - mean }
        }
        val H = FloatArray(N)
        for (n in L..N) {
            val chunk = Array(L) { rgb[n - L + it] }
            val mu = FloatArray(3) { c -> chunk.map { it[c] }.average().toFloat() }
            // Normalize: Cn/mu - 1
            val cn = Array(L) { i ->
                FloatArray(3) { c ->
                    val m = if (abs(mu[c]) < 1e-9f) 1e-9f else mu[c]
                    chunk[i][c] / m - 1f
                }
            }
            // POS projection: P = [[0,1,-1],[-2,1,1]]
            val s1 = FloatArray(L) { i -> cn[i][1] - cn[i][2] }
            val s2 = FloatArray(L) { i -> -2f * cn[i][0] + cn[i][1] + cn[i][2] }
            val sig1 = s1.std()
            val sig2 = s2.std()
            val alpha = if (sig2 > 1e-9f) sig1 / sig2 else 1f
            val h = FloatArray(L) { s1[it] + alpha * s2[it] }
            val hm = h.average().toFloat()
            for (i in 0 until L) H[n - L + i] += h[i] - hm
        }
        return H
    }

    // -----------------------------------------------------------------------
    // CHROM algorithm (De Haan & Jeanne 2013)
    // -----------------------------------------------------------------------
    fun chromMethod(rgb: Array<FloatArray>, fs: Float): FloatArray {
        val N = rgb.size
        if (N < 8) return FloatArray(N)
        val mu = FloatArray(3) { c -> rgb.map { it[c] }.average().toFloat() }
        val rgbN = Array(N) { i ->
            FloatArray(3) { c ->
                val m = if (abs(mu[c]) < 1e-9f) 1e-9f else mu[c]
                rgb[i][c] / m
            }
        }
        val X = FloatArray(N) { 3f * rgbN[it][0] - 2f * rgbN[it][1] }
        val Y = FloatArray(N) { 1.5f * rgbN[it][0] + rgbN[it][1] - 1.5f * rgbN[it][2] }
        val Xf = bandpassIIR(X, fs)
        val Yf = bandpassIIR(Y, fs)
        val sx = Xf.std()
        val sy = Yf.std()
        val alpha = if (sy > 1e-9f) sx / sy else 1f
        return FloatArray(N) { Xf[it] - alpha * Yf[it] }
    }

    // -----------------------------------------------------------------------
    // Bandpass IIR filter (2nd-order Butterworth approximation, zero-phase)
    // -----------------------------------------------------------------------
    fun bandpassIIR(x: FloatArray, fs: Float, lowHz: Float = HR_LOW_HZ, highHz: Float = HR_HIGH_HZ): FloatArray {
        if (x.size < 8) return x.copyOf()
        // 1st-order high-pass: alpha_hp = RC/(RC + Ts)
        val Ts = 1f / fs
        val rcHp = 1f / (2f * PI.toFloat() * lowHz)
        val alphaHp = rcHp / (rcHp + Ts)
        // 1st-order low-pass: alpha_lp = Ts/(RC + Ts)
        val rcLp = 1f / (2f * PI.toFloat() * highHz)
        val alphaLp = Ts / (rcLp + Ts)

        // Forward pass (high-pass)
        val hp = FloatArray(x.size)
        var yPrev = 0f
        var xPrev = x[0]
        for (i in x.indices) {
            yPrev = alphaHp * (yPrev + x[i] - xPrev)
            xPrev = x[i]
            hp[i] = yPrev
        }
        // Forward pass (low-pass on hp result)
        val lp = FloatArray(hp.size)
        var lpPrev = hp[0]
        for (i in hp.indices) {
            lpPrev = alphaLp * hp[i] + (1f - alphaLp) * lpPrev
            lp[i] = lpPrev
        }
        // Reverse pass (zero-phase: backward low-pass)
        val lpR = FloatArray(lp.size)
        var lpRevPrev = lp.last()
        for (i in lp.indices.reversed()) {
            lpRevPrev = alphaLp * lp[i] + (1f - alphaLp) * lpRevPrev
            lpR[i] = lpRevPrev
        }
        return lpR
    }

    // -----------------------------------------------------------------------
    // FFT-based heart rate estimation
    // -----------------------------------------------------------------------
    fun estimateHeartRateBpm(signal: FloatArray, fs: Float,
                              hrMinBpm: Float = 42f, hrMaxBpm: Float = 180f,
                              minSnr: Float = 0f): Float {
        if (signal.size < 16) return Float.NaN
        val x = signal.map { it.toDouble() }.toDoubleArray()
        val mean = x.average()
        for (i in x.indices) x[i] -= mean

        // Zero-pad to next power of 2, at least 2048
        val nfft = maxOf(nextPow2(maxOf(signal.size, (fs * 30).toInt())), 2048)
        val padded = DoubleArray(nfft) { if (it < x.size) x[it] else 0.0 }
        val spectrum = fft.transform(padded, TransformType.FORWARD)
        val freqRes = fs / nfft

        val mags = FloatArray(nfft / 2 + 1) { i ->
            val c = spectrum[i]
            sqrt(c.real * c.real + c.imaginary * c.imaginary).toFloat()
        }

        val idxMin = (hrMinBpm / 60f / freqRes).toInt().coerceAtLeast(1)
        val idxMax = (hrMaxBpm / 60f / freqRes).toInt().coerceAtMost(mags.size - 1)
        if (idxMin >= idxMax) return Float.NaN

        val band = mags.sliceArray(idxMin..idxMax)
        val peakLocalIdx = band.indices.maxByOrNull { band[it] } ?: return Float.NaN
        val peakVal = band[peakLocalIdx]

        if (minSnr > 0f) {
            val bgMask = band.indices.filter { abs(it - peakLocalIdx) > 1 }
            if (bgMask.isNotEmpty()) {
                val bgMedian = bgMask.map { band[it] }.sorted().let {
                    val m = it.size / 2
                    if (it.size % 2 == 0) (it[m - 1] + it[m]) / 2f else it[m]
                }
                if (peakVal / (bgMedian + 1e-12f) < minSnr) return Float.NaN
            }
        }
        return (idxMin + peakLocalIdx) * freqRes * 60f
    }

    // -----------------------------------------------------------------------
    // Peak detection (simple threshold-crossing)
    // -----------------------------------------------------------------------
    fun detectPeaks(signal: FloatArray, fs: Float, hrMaxBpm: Float = 180f): IntArray {
        if (signal.size < 8) return IntArray(0)
        val minDist = maxOf((fs * 60f / hrMaxBpm).toInt(), 1)
        val peaks = mutableListOf<Int>()
        for (i in 1 until signal.size - 1) {
            if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
                if (peaks.isEmpty() || i - peaks.last() >= minDist) {
                    peaks += i
                }
            }
        }
        return peaks.toIntArray()
    }

    // -----------------------------------------------------------------------
    // HRV metrics
    // -----------------------------------------------------------------------
    fun rmssd(rriMs: FloatArray): Float {
        if (rriMs.size < 2) return Float.NaN
        val diffs = FloatArray(rriMs.size - 1) { rriMs[it + 1] - rriMs[it] }
        return sqrt(diffs.map { it * it }.average().toFloat())
    }

    fun sdnn(rriMs: FloatArray): Float {
        if (rriMs.size < 2) return Float.NaN
        val mean = rriMs.average().toFloat()
        return sqrt(rriMs.map { (it - mean) * (it - mean) }.sum() / (rriMs.size - 1))
    }

    /** LF/HF ratio via simple FFT on interpolated RRI signal. Returns (lf, hf, ratio). */
    fun lfHfPower(rriMs: FloatArray, fsResample: Float = 4f): Triple<Float, Float, Float> {
        if (rriMs.size < 4) return Triple(Float.NaN, Float.NaN, Float.NaN)
        val rriS = FloatArray(rriMs.size) { rriMs[it] / 1000f }
        val t = FloatArray(rriS.size).also { arr ->
            var cum = 0f
            for (i in arr.indices) { cum += rriS[i]; arr[i] = cum }
        }
        val tUni = generateSequence(t.first()) { it + 1f / fsResample }.takeWhile { it <= t.last() }.toList().toFloatArray()
        if (tUni.size < 16) return Triple(Float.NaN, Float.NaN, Float.NaN)
        val rriUni = DoubleArray(tUni.size) { interp(tUni[it], t, rriS).toDouble() }
        val uniMean = rriUni.average()
        for (i in rriUni.indices) rriUni[i] -= uniMean

        val nfft = nextPow2(rriUni.size)
        val padded = DoubleArray(nfft) { if (it < rriUni.size) rriUni[it] else 0.0 }
        val spec = fft.transform(padded, TransformType.FORWARD)
        val mags = FloatArray(nfft / 2 + 1) { i ->
            val c = spec[i]; (c.real * c.real + c.imaginary * c.imaginary).toFloat() / nfft
        }
        val freqRes = fsResample / nfft

        fun bandPow(lo: Float, hi: Float): Float {
            val i0 = (lo / freqRes).toInt().coerceAtLeast(0)
            val i1 = (hi / freqRes).toInt().coerceAtMost(mags.size - 1)
            if (i0 >= i1) return 0f
            var s = 0f
            for (i in i0 until i1) s += (mags[i] + mags[i + 1]) * freqRes / 2f
            return s
        }
        val lf = bandPow(0.04f, 0.15f)
        val hf = bandPow(0.15f, 0.40f)
        val ratio = if (hf > 1e-12f) lf / hf else Float.NaN
        return Triple(lf, hf, ratio)
    }

    // -----------------------------------------------------------------------
    // Full HRV pipeline
    // -----------------------------------------------------------------------
    fun computeHrv(rgbSeries: Array<FloatArray>, fs: Float, method: String = "pos",
                   minSnr: Float = 1.5f): HRVMetrics {
        val pulse = if (method == "pos") posMethod(rgbSeries, fs) else chromMethod(rgbSeries, fs)
        val filtered = bandpassIIR(pulse, fs)
        val bpm = estimateHeartRateBpm(filtered, fs, minSnr = minSnr)
        val peaks = detectPeaks(filtered, fs)
        if (!bpm.isFinite()) {
            return HRVMetrics.empty().copy(nBeats = peaks.size)
        }
        if (peaks.size < 3) {
            return HRVMetrics(bpm, Float.NaN, Float.NaN, Float.NaN, Float.NaN, Float.NaN, peaks.size)
        }
        val rri = FloatArray(peaks.size - 1) { (peaks[it + 1] - peaks[it]) * 1000f / fs }
        val (lf, hf, ratio) = lfHfPower(rri)
        return HRVMetrics(bpm, rmssd(rri), sdnn(rri), lf, hf, ratio, peaks.size)
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    private fun FloatArray.std(): Float {
        if (size < 2) return 0f
        val mean = average().toFloat()
        return sqrt(map { (it - mean) * (it - mean) }.average().toFloat())
    }

    private fun nextPow2(n: Int): Int {
        var p = 1
        while (p < n) p = p shl 1
        return p
    }

    private fun interp(x: Float, xs: FloatArray, ys: FloatArray): Float {
        if (x <= xs.first()) return ys.first()
        if (x >= xs.last()) return ys.last()
        val i = xs.indexOfFirst { it >= x }.coerceAtLeast(1)
        val t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
        return ys[i - 1] + t * (ys[i] - ys[i - 1])
    }
}
