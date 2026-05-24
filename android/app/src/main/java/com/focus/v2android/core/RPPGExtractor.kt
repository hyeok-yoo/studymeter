package com.focus.v2android.core

import android.graphics.Bitmap
import android.os.SystemClock
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc

/**
 * Python core/rppg_extractor.py 포트.
 * 이마(w=2) + 좌/우 뺨(w=1) ROI 평균 RGB 추출.
 * 입력: Bitmap (ARGB_8888) + 정규화 랜드마크 (478*2 floats)
 */
class RPPGExtractor(
    private val minRoiPixels: Int = 50
) {
    // ROI 폴리곤 인덱스 (Python과 동일)
    private val foreheadIdx = intArrayOf(67, 109, 10, 338, 297, 299, 151, 69)
    private val rightCheekIdx = intArrayOf(116, 123, 147, 213, 192, 207, 117)
    private val leftCheekIdx  = intArrayOf(345, 352, 376, 433, 416, 427, 346)

    /**
     * landmarks: size 478*2 (x0,y0, x1,y1, ...) in [0,1]
     * bitmap: camera frame (ARGB_8888)
     */
    fun processWithLandmarks(bitmap: Bitmap, landmarks: FloatArray): RPPGSample {
        val now = SystemClock.elapsedRealtime()
        if (landmarks.size < 478 * 2) return RPPGSample(now)

        val mat = Mat()
        Utils.bitmapToMat(bitmap, mat)  // RGBA
        // Convert RGBA → RGB for mean calculation (OpenCV Mat is RGBA from Bitmap)
        // We'll extract R/G/B channels manually from RGBA

        val w = bitmap.width; val h = bitmap.height

        fun extractRoi(indices: IntArray): FloatArray? {
            val pts = Array(indices.size) {
                val ix = indices[it]
                Point(
                    (landmarks[ix * 2] * w).toDouble(),
                    (landmarks[ix * 2 + 1] * h).toDouble()
                )
            }
            val mask = Mat.zeros(h, w, CvType.CV_8UC1)
            val poly = MatOfPoint(*pts)
            Imgproc.fillPoly(mask, listOf(poly), Scalar(255.0))
            val nonZero = Core.countNonZero(mask)
            if (nonZero < minRoiPixels) {
                mask.release(); poly.release()
                return null
            }
            val meanVal = Core.mean(mat, mask)  // [R_or_B, G, B_or_R, A] depending on Mat type
            mask.release(); poly.release()
            // Bitmap ARGB → OpenCV RGBA: channels are R=0, G=1, B=2, A=3
            return floatArrayOf(meanVal.`val`[0].toFloat(), meanVal.`val`[1].toFloat(), meanVal.`val`[2].toFloat())
        }

        val forehead = extractRoi(foreheadIdx)
        val rightCheek = extractRoi(rightCheekIdx)
        val leftCheek  = extractRoi(leftCheekIdx)
        mat.release()

        return RPPGSample(now, forehead, rightCheek, leftCheek)
    }
}
