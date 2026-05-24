package com.focus.v2android.core

import android.content.Context
import android.util.Log
import com.focus.v2android.core.CalibPoint
import org.opencv.calib3d.Calib3d
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.imgproc.Imgproc
import kotlin.math.abs

/**
 * 시선 특징(2D) → 화면 픽셀 좌표 호모그래피 캘리브레이션.
 * Python calibration.py의 CalibrationModel + extract_gaze_feature 포트.
 *
 * Android 적응:
 *   - 저장: SharedPreferences에 호모그래피 행렬(9개 float) 직렬화
 *   - 캘리브레이션: CalibrationActivity에서 탭 기반 9점 수집
 */
class CalibrationModel(
    val screenWidth: Int,
    val screenHeight: Int
) {
    // 3×3 호모그래피 행렬 (row-major float[9])
    private var homography: FloatArray? = null

    val isReady: Boolean get() = homography != null

    /**
     * MediaPipe FaceLandmarker가 반환하는 정규화 좌표(0~1) 랜드마크 목록에서
     * 헤드포즈에 강건한 2D 시선 특징(0~1)을 추출한다.
     *
     * Python extract_gaze_feature()와 동일 로직.
     * landmarks: List of (x, y) normalized coordinates, size 478 (refine=true)
     */
    companion object {
        private const val TAG = "CalibrationModel"
        private const val PREF_NAME = "focus_calibration"
        private const val PREF_KEY_H = "homography"
        private const val PREF_KEY_W = "screen_w"
        private const val PREF_KEY_HH = "screen_h"

        // Iris landmark ranges (MediaPipe FaceLandmarker, refine=true)
        private val RIGHT_IRIS = 468..472   // 이미지 기준 왼쪽 눈동자
        private val LEFT_IRIS = 473..477    // 이미지 기준 오른쪽 눈동자

        // Eye corner indices (Python 기준)
        private const val R_CORNER_OUT = 33
        private const val R_CORNER_IN = 133
        private const val L_CORNER_IN = 362
        private const val L_CORNER_OUT = 263
        private const val R_EYE_TOP = 159
        private const val R_EYE_BOT = 145
        private const val L_EYE_TOP = 386
        private const val L_EYE_BOT = 374

        // EAR landmark indices (Python _RIGHT_EAR_IDX, _LEFT_EAR_IDX)
        val RIGHT_EAR_IDX = intArrayOf(33, 160, 158, 133, 153, 144)
        val LEFT_EAR_IDX  = intArrayOf(362, 385, 387, 263, 373, 380)

        fun load(context: Context, screenW: Int, screenH: Int): CalibrationModel {
            val model = CalibrationModel(screenW, screenH)
            val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            val str = prefs.getString(PREF_KEY_H, null)
            if (str != null) {
                try {
                    val vals = str.split(",").map { it.toFloat() }
                    if (vals.size == 9) model.homography = vals.toFloatArray()
                } catch (e: Exception) {
                    Log.w(TAG, "캘리브레이션 로드 실패: ${e.message}")
                }
            }
            return model
        }
    }

    fun save(context: Context) {
        val h = homography ?: return
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit()
            .putString(PREF_KEY_H, h.joinToString(","))
            .putInt(PREF_KEY_W, screenWidth)
            .putInt(PREF_KEY_HH, screenHeight)
            .apply()
    }

    /** 9개(이상) CalibPoint에서 OpenCV 최소제곱 호모그래피를 계산해 저장. */
    fun fitFromPoints(points: List<CalibPoint>): Boolean {
        if (points.size < 4) {
            Log.w(TAG, "캘리브레이션 포인트가 너무 적음: ${points.size} (최소 4)")
            return false
        }
        val src = MatOfPoint2f(*points.map { Point(it.gazeX.toDouble(), it.gazeY.toDouble()) }.toTypedArray())
        val dst = MatOfPoint2f(*points.map { Point(it.screenX.toDouble(), it.screenY.toDouble()) }.toTypedArray())
        val H: Mat = if (points.size == 4) {
            Imgproc.getPerspectiveTransform(src, dst)
        } else {
            Calib3d.findHomography(src, dst, Calib3d.RANSAC, 3.0)
        }
        if (H.empty()) {
            Log.e(TAG, "호모그래피 계산 실패")
            return false
        }
        homography = FloatArray(9) { i -> H.get(i / 3, i % 3)[0].toFloat() }
        return true
    }

    /**
     * 2D 시선 특징 → 화면 픽셀 좌표 (호모그래피 적용).
     * 캘리브레이션 미완료 시 화면 중앙 반환.
     */
    fun apply(fx: Float, fy: Float): Pair<Float, Float> {
        val h = homography ?: return Pair(screenWidth / 2f, screenHeight / 2f)
        val w = h[6] * fx + h[7] * fy + h[8]
        if (abs(w) < 1e-6f) return Pair(screenWidth / 2f, screenHeight / 2f)
        val x = (h[0] * fx + h[1] * fy + h[2]) / w
        val y = (h[3] * fx + h[4] * fy + h[5]) / w
        return Pair(x, y)
    }

    /**
     * 478개 정규화 랜드마크(플랫 배열, xyxyxy...)에서 2D 시선 특징 추출.
     * Python extract_gaze_feature()와 동일.
     * landmarks: size = 478*2 (x0,y0, x1,y1, ...)
     * 반환: Pair(fx, fy) 또는 null (추적 실패)
     */
    fun extractGazeFeature(lm: FloatArray): Pair<Float, Float>? {
        if (lm.size < 478 * 2) return null

        fun x(idx: Int) = lm[idx * 2]
        fun y(idx: Int) = lm[idx * 2 + 1]
        fun norm(v: Float, a: Float, b: Float): Float? {
            val lo = minOf(a, b); val hi = maxOf(a, b)
            val span = hi - lo
            if (span < 1e-6f) return null
            return (v - lo) / span
        }

        // 홍채 중심: 5점 평균
        val rIrisX = RIGHT_IRIS.map { x(it) }.average().toFloat()
        val rIrisY = RIGHT_IRIS.map { y(it) }.average().toFloat()
        val lIrisX = LEFT_IRIS.map { x(it) }.average().toFloat()
        val lIrisY = LEFT_IRIS.map { y(it) }.average().toFloat()

        val rx = norm(rIrisX, x(R_CORNER_OUT), x(R_CORNER_IN)) ?: return null
        val ry = norm(rIrisY, y(R_EYE_TOP), y(R_EYE_BOT)) ?: return null
        val lx = norm(lIrisX, x(L_CORNER_IN), x(L_CORNER_OUT)) ?: return null
        val ly = norm(lIrisY, y(L_EYE_TOP), y(L_EYE_BOT)) ?: return null

        return Pair((rx + lx) / 2f, (ry + ly) / 2f)
    }

    /** EAR 계산. Python compute_mean_ear() 포트. lm: 478*2 flattened. */
    fun computeMeanEar(lm: FloatArray): Float {
        if (lm.size < 478 * 2) return Float.NaN
        fun computeSingleEar(idx: IntArray): Float {
            val pts = Array(6) { Pair(lm[idx[it] * 2], lm[idx[it] * 2 + 1]) }
            fun dist(a: Pair<Float, Float>, b: Pair<Float, Float>): Float {
                val dx = a.first - b.first; val dy = a.second - b.second
                return kotlin.math.sqrt(dx * dx + dy * dy)
            }
            val vert1 = dist(pts[1], pts[5])
            val vert2 = dist(pts[2], pts[4])
            val horiz = dist(pts[0], pts[3])
            if (horiz < 1e-6f) return Float.NaN
            return (vert1 + vert2) / (2f * horiz)
        }
        val r = computeSingleEar(RIGHT_EAR_IDX)
        val l = computeSingleEar(LEFT_EAR_IDX)
        val valid = listOf(r, l).filter { it.isFinite() }
        return if (valid.isEmpty()) Float.NaN else valid.average().toFloat()
    }
}

private fun Iterable<Float>.avgF(): Float {
    var sum = 0f; var count = 0
    for (v in this) { sum += v; count++ }
    return if (count > 0) sum / count else 0f
}
