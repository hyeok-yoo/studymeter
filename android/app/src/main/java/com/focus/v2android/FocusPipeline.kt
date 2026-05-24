package com.focus.v2android

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import com.focus.v2android.core.CalibrationModel
import com.focus.v2android.core.FocusResult
import com.focus.v2android.core.GazeSample
import com.focus.v2android.core.RPPGSample
import com.focus.v2android.engine.FeatureExtractor
import com.focus.v2android.engine.Forecaster
import com.focus.v2android.engine.MLClassifier
import com.focus.v2android.core.GazeTracker
import com.focus.v2android.core.RPPGExtractor
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker.FaceLandmarkerOptions
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Python main.py FocusPipeline 포트.
 * 단일 FaceLandmarker → GazeTracker + RPPGExtractor → FeatureExtractor → MLClassifier → Forecaster
 */
class FocusPipeline(private val context: Context) {
    companion object {
        private const val TAG = "FocusPipeline"
        private const val MODEL_ASSET = "face_landmarker.task"
    }

    private var landmarker: FaceLandmarker? = null
    private var calibration: CalibrationModel? = null
    private var gazeTracker: GazeTracker? = null
    private val rppgExtractor = RPPGExtractor()
    private val featureExtractor = FeatureExtractor()
    private val forecaster = Forecaster()
    private val classifier = MLClassifier(context)
    private var lastFrameTs = 0L

    // ROI polygon indices (same as RPPGExtractor)
    private val foreheadIdx = intArrayOf(67, 109, 10, 338, 297, 299, 151, 69)
    private val rightCheekIdx = intArrayOf(116, 123, 147, 213, 192, 207, 117)
    private val leftCheekIdx  = intArrayOf(345, 352, 376, 433, 416, 427, 346)

    @Volatile var lastGazeScreenX: Float? = null
    @Volatile var lastGazeScreenY: Float? = null
    @Volatile var lastRppgSample: RPPGSample? = null
    @Volatile var lastLandmarksFlat: FloatArray? = null

    @Volatile var debugEnabled: Boolean = false
    private var debugFrameCounter = 0
    @Volatile var lastDebugJpeg: ByteArray? = null

    // 화면 크기 (CalibrationActivity에서 주입)
    var screenWidth: Int = 1080
    var screenHeight: Int = 1920

    fun init(): Boolean {
        // 1. ONNX 모델
        if (!classifier.load()) {
            Log.w(TAG, "ONNX 모델 없음 — 휴리스틱 폴백 사용")
        }
        // 2. 캘리브레이션 로드
        val calib = CalibrationModel.load(context, screenWidth, screenHeight)
        calibration = calib
        gazeTracker = GazeTracker(calib)
        // 3. FaceLandmarker
        return try {
            val baseOptions = BaseOptions.builder()
                .setModelAssetPath(MODEL_ASSET)
                .build()
            val options = FaceLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setNumFaces(1)
                .setMinFaceDetectionConfidence(0.5f)
                .setMinFacePresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .setOutputFaceBlendshapes(false)
                .setOutputFacialTransformationMatrixes(false)
                .setRunningMode(RunningMode.VIDEO)
                .build()
            landmarker = FaceLandmarker.createFromOptions(context, options)
            Log.i(TAG, "FaceLandmarker 초기화 완료")
            true
        } catch (e: Exception) {
            Log.e(TAG, "FaceLandmarker 초기화 실패: ${e.message}")
            false
        }
    }

    /**
     * 카메라 프레임 처리 (ImageAnalysis 콜백에서 호출).
     * bitmap: ARGB_8888 front-camera frame (already mirrored if needed)
     */
    fun processFrame(bitmap: Bitmap): FocusResult? {
        val lm = landmarker ?: return null
        val nowMs = SystemClock.elapsedRealtime()
        val ts = maxOf(nowMs, lastFrameTs + 1L)
        lastFrameTs = ts

        // FaceLandmarker 추론 (VIDEO 모드: 단조 증가 ms timestamp)
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = try { lm.detectForVideo(mpImage, ts) }
                     catch (e: Exception) { Log.e(TAG, "FaceLandmarker 오류: ${e.message}"); null }
                     ?: return null

        val faceLandmarks = result.faceLandmarks()
        if (faceLandmarks.isEmpty()) {
            featureExtractor.pushGaze(null, nowMs)
            return null
        }

        // 랜드마크를 flattened FloatArray(478*2)로 변환
        val lms = faceLandmarks[0]
        val lmFlat = FloatArray(lms.size * 2) { i ->
            val lm2 = lms[i / 2]
            if (i % 2 == 0) lm2.x() else lm2.y()
        }

        // GazeTracker
        val gazeSample: GazeSample? = gazeTracker?.processWithLandmarks(lmFlat)
        featureExtractor.pushGaze(gazeSample, nowMs)
        if (gazeSample != null) {
            lastGazeScreenX = gazeSample.screenX
            lastGazeScreenY = gazeSample.screenY
        }

        // RPPGExtractor
        val rppgSample: RPPGSample = rppgExtractor.processWithLandmarks(bitmap, lmFlat)
        featureExtractor.pushRppg(rppgSample)
        lastRppgSample = rppgSample
        lastLandmarksFlat = lmFlat

        // Debug frame at ~2fps — only when preview is open
        if (debugEnabled) {
            debugFrameCounter++
            if (debugFrameCounter % 15 == 0) {
                lastDebugJpeg = buildDebugJpeg(bitmap, lmFlat, gazeSample)
            }
        }

        // Feature emit
        val feat = featureExtractor.maybeEmit() ?: return null

        // 집중도 스코어
        val isHeuristic: Boolean
        val score: Float
        if (classifier.isReady) {
            score = classifier.predictFocusScore(feat)
            isHeuristic = false
        } else {
            score = heuristicFocusScore(feat, screenWidth, screenHeight)
            isHeuristic = true
        }

        // ETA
        val eta = forecaster.update(nowMs, score)

        return FocusResult(
            score = score,
            etaS = eta.etaS,
            features = feat,
            isHeuristicMode = isHeuristic,
            gazeScreenX = lastGazeScreenX,
            gazeScreenY = lastGazeScreenY,
            roiForehead = rppgSample.foreheadRGB,
            roiRightCheek = rppgSample.rightCheekRGB,
            roiLeftCheek = rppgSample.leftCheekRGB,
            landmarksFlat = lmFlat
        )
    }

    /**
     * 카메라 프레임에 ROI 폴리곤 + 시선 점을 오버레이한 JPEG 반환.
     * 미러링된 프론트 카메라 프레임에서 랜드마크를 그린다.
     */
    private fun buildDebugJpeg(src: Bitmap, lmFlat: FloatArray, gaze: GazeSample?): ByteArray? {
        return try {
            val scale = 0.4f
            val w = (src.width * scale).toInt()
            val h = (src.height * scale).toInt()
            val out = Bitmap.createScaledBitmap(src, w, h, false)
            val mutable = out.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(mutable)

            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f }

            // ROI 폴리곤 그리기
            fun drawPoly(indices: IntArray, color: Int) {
                paint.color = color
                val path = Path()
                indices.forEachIndexed { i, idx ->
                    val px = lmFlat[idx * 2] * w
                    val py = lmFlat[idx * 2 + 1] * h
                    if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                }
                path.close()
                canvas.drawPath(path, paint)
            }
            drawPoly(foreheadIdx, Color.rgb(0, 220, 255))    // 이마: 하늘색
            drawPoly(rightCheekIdx, Color.rgb(255, 160, 0))  // 오른뺨: 주황
            drawPoly(leftCheekIdx, Color.rgb(255, 160, 0))   // 왼뺨: 주황

            // 시선 점 (캘리브레이션 완료된 경우)
            if (gaze != null) {
                val dotX = (gaze.screenX / screenWidth) * w
                val dotY = (gaze.screenY / screenHeight) * h
                paint.style = Paint.Style.FILL
                paint.color = if (gaze.isSaccade) Color.rgb(255, 80, 80) else Color.rgb(80, 255, 80)
                canvas.drawCircle(dotX, dotY, 8f, paint)
            }

            val baos = ByteArrayOutputStream()
            mutable.compress(Bitmap.CompressFormat.JPEG, 55, baos)
            mutable.recycle()
            baos.toByteArray()
        } catch (e: Exception) {
            Log.e(TAG, "debug jpeg error: ${e.message}")
            null
        }
    }

    /**
     * Python main.py heuristic_focus_score() 포트 (screen_size 비례).
     */
    private fun heuristicFocusScore(feat: com.focus.v2android.core.FeatureVector,
                                    screenW: Int, screenH: Int): Float {
        if (feat.validRatio < 0.3f) return 50f
        val fixDurScore = min(1f, feat.meanFixDurationS / 0.5f)
        val maxDim = max(screenW, screenH).toFloat()
        val dispThreshold = maxDim * 0.625f
        val dispSpan = maxDim * 0.469f
        val maxDisp = max(feat.gazeDispersionXPx, feat.gazeDispersionYPx)
        val dispScore = ((dispThreshold - maxDisp) / dispSpan).coerceIn(0f, 1f)
        val trackFactor = 0.6f + 0.4f * min(1f, feat.validRatio / 0.7f)
        val raw = 50f + 30f * fixDurScore + 20f * dispScore
        return (raw * trackFactor).coerceIn(0f, 100f)
    }

    fun reloadCalibration() {
        val calib = CalibrationModel.load(context, screenWidth, screenHeight)
        calibration = calib
        gazeTracker = GazeTracker(calib)
        featureExtractor  // no reset needed; data will naturally expire
    }

    fun close() {
        landmarker?.close()
        classifier.close()
    }
}
