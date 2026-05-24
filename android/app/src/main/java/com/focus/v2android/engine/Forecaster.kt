package com.focus.v2android.engine

import com.focus.v2android.core.ETAResult
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Python engine/forecaster.py 포트.
 * 집중도 점수 시계열 → 임계값 도달 ETA.
 * t는 SystemClock.elapsedRealtime() ms 사용; 내부에서 초 단위로 변환.
 */
class Forecaster(
    private val threshold: Float = 40f,
    private val windowS: Float = 15f,
    private val maxEtaS: Float = 300f,
    private val minPoints: Int = 4,
    private val smoothingAlpha: Float = 0.5f,
    private val quadraticMinCurvature: Float = 1e-4f
) {
    private data class Entry(val tS: Float, val score: Float)
    private val history = ArrayDeque<Entry>()
    private var smoothed: Float? = null

    fun reset() { history.clear(); smoothed = null }

    fun update(nowMs: Long, score: Float): ETAResult {
        val tS = nowMs / 1000f

        // EMA
        smoothed = if (smoothed == null) score
                   else smoothingAlpha * score + (1f - smoothingAlpha) * smoothed!!
        val s = smoothed!!

        history.addLast(Entry(tS, s))
        val cutoff = tS - windowS
        while (history.isNotEmpty() && history.first().tS < cutoff) history.removeFirst()

        if (history.size < minPoints) return ETAResult(null, s, 0f, 0f, 0)

        val ts = history.map { it.tS }.toFloatArray()
        val ys = history.map { it.score }.toFloatArray()
        val t0 = ts.first()
        val tRel = FloatArray(ts.size) { ts[it] - t0 }
        val tNowRel = tS - t0

        if (s <= threshold) {
            val (d1, d2, deg) = derivativesFromFit(tRel, ys, tNowRel)
            return ETAResult(0f, s, d1, d2, deg)
        }

        val (eta, deg, d1, d2) = solve(tRel, ys, tNowRel)
        return ETAResult(eta, s, d1, d2, deg)
    }

    private data class SolveResult(val eta: Float?, val degree: Int, val d1: Float, val d2: Float)

    private fun solve(tRel: FloatArray, ys: FloatArray, tNow: Float): SolveResult {
        val (b1, c1) = polyfit1(tRel, ys)
        val d1 = b1; val d2Lin = 0f

        if (tRel.size >= maxOf(minPoints, 5)) {
            try {
                val (a2, b2, c2) = polyfit2(tRel, ys)
                if (abs(a2) > quadraticMinCurvature) {
                    val dNow = 2f * a2 * tNow + b2
                    val eta2 = quadraticRootAfter(a2, b2, c2, tNow)
                    if (eta2 != null) return SolveResult(eta2, 2, dNow, 2f * a2)
                }
            } catch (_: Exception) {}
        }

        if (b1 >= -1e-6f) return SolveResult(null, 1, d1, d2Lin)
        val tHit = (threshold - c1) / b1
        val eta = tHit - tNow
        if (eta < 0 || eta > maxEtaS) return SolveResult(null, 1, d1, d2Lin)
        return SolveResult(eta, 1, d1, 0f)
    }

    private fun quadraticRootAfter(a: Float, b: Float, c: Float, tNow: Float): Float? {
        val disc = b * b - 4f * a * (c - threshold)
        if (disc < 0f) return null
        val sqrtD = sqrt(disc)
        val roots = listOf((-b + sqrtD) / (2f * a), (-b - sqrtD) / (2f * a))
        val future = roots.filter { it > tNow + 1e-9f }
        if (future.isEmpty()) return null
        val tHit = future.min()!!
        val eta = tHit - tNow
        if (eta > maxEtaS) return null
        return eta
    }

    private fun derivativesFromFit(tRel: FloatArray, ys: FloatArray, tNow: Float): Triple<Float, Float, Int> {
        if (tRel.size >= 5) {
            try {
                val (a2, b2, _) = polyfit2(tRel, ys)
                return Triple(2f * a2 * tNow + b2, 2f * a2, 2)
            } catch (_: Exception) {}
        }
        val (b1, _) = polyfit1(tRel, ys)
        return Triple(b1, 0f, 1)
    }

    // ---- Least-squares polynomial fit ----

    private fun polyfit1(t: FloatArray, y: FloatArray): Pair<Float, Float> {
        val n = t.size.toFloat()
        val sumT = t.sum(); val sumY = y.sum()
        val sumTT = t.map { it * it }.sum()
        val sumTY = t.indices.sumOf { i -> (t[i] * y[i]).toDouble() }.toFloat()
        val denom = n * sumTT - sumT * sumT
        if (abs(denom) < 1e-12f) return Pair(0f, sumY / n)
        val b = (n * sumTY - sumT * sumY) / denom
        val c = (sumY - b * sumT) / n
        return Pair(b, c)
    }

    private fun polyfit2(t: FloatArray, y: FloatArray): Triple<Float, Float, Float> {
        // Vandermonde [t², t, 1] least-squares via normal equations
        val n = t.size
        val A = Array(3) { r -> FloatArray(3) { c ->
            t.map { it.pow(r + c) }.sum()
        }.also { row -> if (row.size < 3) return@also } }
        // Actually build the 3×3 normal equations matrix:
        // A = [sum(t^0), sum(t^1), sum(t^2);
        //      sum(t^1), sum(t^2), sum(t^3);
        //      sum(t^2), sum(t^3), sum(t^4)]
        val sums = DoubleArray(7) { p -> t.fold(0.0) { acc, v -> acc + v.pow(p).toDouble() } }
        val b = DoubleArray(3) { p -> t.indices.fold(0.0) { acc, i -> acc + (t[i].pow(p) * y[i]).toDouble() } }
        val mat = Array(3) { r -> DoubleArray(3) { c -> sums[r + c] } }
        val coeffs = solve3x3(mat, b) ?: throw ArithmeticException("singular")
        return Triple(coeffs[2].toFloat(), coeffs[1].toFloat(), coeffs[0].toFloat())
    }

    private fun solve3x3(A: Array<DoubleArray>, b: DoubleArray): DoubleArray? {
        // Gaussian elimination with partial pivoting
        val n = 3
        val aug = Array(n) { i -> DoubleArray(n + 1) { j -> if (j < n) A[i][j] else b[i] } }
        for (col in 0 until n) {
            val maxRow = (col until n).maxByOrNull { abs(aug[it][col]) } ?: col
            val tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp
            if (abs(aug[col][col]) < 1e-12) return null
            for (row in col + 1 until n) {
                val factor = aug[row][col] / aug[col][col]
                for (j in col..n) aug[row][j] -= factor * aug[col][j]
            }
        }
        val x = DoubleArray(n)
        for (i in n - 1 downTo 0) {
            x[i] = aug[i][n]
            for (j in i + 1 until n) x[i] -= aug[i][j] * x[j]
            x[i] /= aug[i][i]
        }
        return x
    }

    private fun Float.pow(n: Int): Float {
        var r = 1f; repeat(n) { r *= this }; return r
    }
    private fun FloatArray.sum() = fold(0f) { acc, v -> acc + v }
    private fun FloatArray.sumOf(f: (Float) -> Float) = fold(0f) { acc, v -> acc + f(v) }
}
