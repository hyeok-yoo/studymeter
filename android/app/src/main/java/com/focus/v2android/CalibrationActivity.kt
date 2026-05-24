package com.focus.v2android

import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.focus.v2android.core.CalibPoint
import com.focus.v2android.core.CalibrationModel
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker.FaceLandmarkerOptions
import org.opencv.android.OpenCVLoader
import java.util.concurrent.Executors

class CalibrationActivity : AppCompatActivity() {

    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var hintText: TextView
    private lateinit var dotView: View
    private lateinit var captureBtn: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var overlayContainer: FrameLayout

    private var landmarker: FaceLandmarker? = null
    private var lastFrameTs = 0L

    // Timing fix: flag set on button press; next landmark frame triggers capture
    @Volatile private var awaitingCapture = false
    @Volatile private var currentLandmarks: FloatArray? = null
    private val executor = Executors.newSingleThreadExecutor()

    private val calibPoints = mutableListOf<CalibPoint>()
    private var currentPointIdx = 0
    private var scenario = "monitor"  // "book" or "monitor"

    // 9-point grids per scenario
    private val monitorDots = listOf(
        Pair(0.1f, 0.1f), Pair(0.5f, 0.1f), Pair(0.9f, 0.1f),
        Pair(0.1f, 0.5f), Pair(0.5f, 0.5f), Pair(0.9f, 0.5f),
        Pair(0.1f, 0.85f), Pair(0.5f, 0.85f), Pair(0.9f, 0.85f)
    )
    // Book: narrower FOV (center-biased, lower half)
    private val bookDots = listOf(
        Pair(0.25f, 0.3f), Pair(0.5f, 0.25f), Pair(0.75f, 0.3f),
        Pair(0.2f, 0.5f), Pair(0.5f, 0.5f), Pair(0.8f, 0.5f),
        Pair(0.25f, 0.75f), Pair(0.5f, 0.8f), Pair(0.75f, 0.75f)
    )

    private val calibDots get() = if (scenario == "book") bookDots else monitorDots

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        OpenCVLoader.initDebug()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        scenario = intent.getStringExtra("scenario") ?: "monitor"

        // Build UI programmatically
        overlayContainer = FrameLayout(this).apply { setBackgroundColor(0xFF0A0A14.toInt()) }

        // Camera preview
        previewView = PreviewView(this).also {
            overlayContainer.addView(it, FrameLayout.LayoutParams(-1, -1))
        }

        // Calibration dot
        dotView = View(this).apply { setBackgroundColor(0xFFFF3333.toInt()); visibility = View.INVISIBLE }
        overlayContainer.addView(dotView, FrameLayout.LayoutParams(56, 56))

        // Hint text (scenario-specific)
        hintText = TextView(this).apply {
            setTextColor(0xFFAABBFF.toInt()); textSize = 13f
            setPadding(20, 10, 20, 10)
            background = android.graphics.drawable.ColorDrawable(0xAA000000.toInt())
        }
        val hintParams = FrameLayout.LayoutParams(-2, -2).also { it.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; it.topMargin = 16 }
        overlayContainer.addView(hintText, hintParams)

        // Status text
        statusText = TextView(this).apply {
            setTextColor(0xFFFFFFFF.toInt()); textSize = 15f; setPadding(20, 20, 20, 20)
            background = android.graphics.drawable.ColorDrawable(0xAA000000.toInt())
        }
        val stParams = FrameLayout.LayoutParams(-2, -2).also { it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; it.bottomMargin = 160 }
        overlayContainer.addView(statusText, stParams)

        // Progress bar
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = calibDots.size; progress = 0
        }
        val pbParams = FrameLayout.LayoutParams(-1, 12).also { it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; it.bottomMargin = 145; it.leftMargin = 32; it.rightMargin = 32 }
        overlayContainer.addView(progressBar, pbParams)

        // Capture button
        captureBtn = Button(this).apply {
            text = "시선 고정 → 캡처"; setBackgroundColor(0xFF1565C0.toInt()); setTextColor(Color.WHITE); textSize = 16f
        }
        val capParams = FrameLayout.LayoutParams(-2, -2).also { it.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL; it.bottomMargin = 60 }
        overlayContainer.addView(captureBtn, capParams)

        setContentView(overlayContainer)

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.CAMERA), 100)
        } else {
            startCamera()
        }
        initLandmarker()
        showCurrentDot()
        updateHint()

        captureBtn.setOnClickListener { onCapturePressed() }
    }

    private fun updateHint() {
        hintText.text = when (scenario) {
            "book" -> "📖 책 읽기 캘리브레이션 — 독서 거리(40~50cm)에서 화면을 보세요"
            else   -> "🖥️ 모니터 캘리브레이션 — 평소 태블릿 사용 거리에서 화면을 보세요"
        }
    }

    private fun initLandmarker() {
        try {
            val options = FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("face_landmarker.task").build())
                .setNumFaces(1).setMinFaceDetectionConfidence(0.5f).setMinTrackingConfidence(0.5f)
                .setRunningMode(RunningMode.VIDEO).build()
            landmarker = FaceLandmarker.createFromOptions(this, options)
        } catch (e: Exception) { Log.e("Calib", "FaceLandmarker 초기화 실패: ${e.message}") }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val imageAnalysis = ImageAnalysis.Builder()
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            imageAnalysis.setAnalyzer(executor) { imageProxy ->
                processFrame(imageProxy)
                imageProxy.close()
            }
            cameraProvider.unbindAll()
            cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_FRONT_CAMERA, preview, imageAnalysis)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun processFrame(imageProxy: ImageProxy) {
        val lm = landmarker ?: return
        val bitmap = Bitmap.createBitmap(imageProxy.width, imageProxy.height, Bitmap.Config.ARGB_8888)
        imageProxy.planes[0].buffer.rewind()
        bitmap.copyPixelsFromBuffer(imageProxy.planes[0].buffer)

        val nowMs = SystemClock.elapsedRealtime()
        val ts = maxOf(nowMs, lastFrameTs + 1L); lastFrameTs = ts
        val result = try { lm.detectForVideo(BitmapImageBuilder(bitmap).build(), ts) } catch (e: Exception) { null }
        val lms = result?.faceLandmarks()?.firstOrNull()
        if (lms != null && lms.size >= 478) {
            val lmFlat = FloatArray(lms.size * 2) { i -> val l = lms[i / 2]; if (i % 2 == 0) l.x() else l.y() }
            currentLandmarks = lmFlat

            // Timing fix: capture ONLY on first fresh frame AFTER button press
            if (awaitingCapture) {
                awaitingCapture = false
                val lmSnapshot = lmFlat.copyOf()
                runOnUiThread { doCapture(lmSnapshot) }
            }
        }
    }

    private fun onCapturePressed() {
        if (awaitingCapture) return  // already waiting
        val lm = currentLandmarks
        if (lm == null) {
            statusText.text = "얼굴이 감지되지 않았습니다. 카메라를 똑바로 보세요."; return
        }
        captureBtn.isEnabled = false
        captureBtn.text = "인식 중..."
        statusText.text = "시선을 유지하세요 ..."
        awaitingCapture = true  // next frame triggers doCapture
    }

    private fun doCapture(landmarks: FloatArray) {
        if (currentPointIdx >= calibDots.size) return
        val calib = CalibrationModel(previewView.width.takeIf { it > 0 } ?: 1080,
                                     previewView.height.takeIf { it > 0 } ?: 1920)
        val feat = calib.extractGazeFeature(landmarks)
        if (feat == null) {
            statusText.text = "시선 특징 추출 실패. 다시 누르세요."
            captureBtn.isEnabled = true
            captureBtn.text = "시선 고정 → 캡처"
            return
        }
        val (dotNX, dotNY) = calibDots[currentPointIdx]
        val screenX = dotNX * (previewView.width.takeIf { it > 0 } ?: 1080).toFloat()
        val screenY = dotNY * (previewView.height.takeIf { it > 0 } ?: 1920).toFloat()
        calibPoints += CalibPoint(feat.first, feat.second, screenX, screenY)

        // Mark current dot green briefly
        dotView.setBackgroundColor(0xFF44FF44.toInt())

        currentPointIdx++
        progressBar.progress = currentPointIdx

        if (currentPointIdx >= calibDots.size) {
            finishCalibration()
        } else {
            statusText.text = "✓ ${currentPointIdx}/${calibDots.size} 캡처됨"
            dotView.postDelayed({
                dotView.setBackgroundColor(0xFFFF3333.toInt())
                showCurrentDot()
                captureBtn.isEnabled = true
                captureBtn.text = "시선 고정 → 캡처"
            }, 400)
        }
    }

    private fun showCurrentDot() {
        if (currentPointIdx >= calibDots.size) return
        val (nx, ny) = calibDots[currentPointIdx]
        dotView.post {
            val parent = dotView.parent as? FrameLayout ?: return@post
            val lp = dotView.layoutParams as FrameLayout.LayoutParams
            lp.leftMargin = (nx * parent.width - 28).toInt()
            lp.topMargin = (ny * parent.height - 28).toInt()
            lp.gravity = 0
            dotView.layoutParams = lp
            dotView.visibility = View.VISIBLE
        }
        statusText.text = "빨간 점을 바라보다가 버튼을 누르세요 (${currentPointIdx + 1}/${calibDots.size})"
    }

    private fun finishCalibration() {
        val screenW = resources.displayMetrics.widthPixels
        val screenH = resources.displayMetrics.heightPixels
        val model = CalibrationModel(screenW, screenH)
        val remapped = calibPoints.mapIndexed { i, pt ->
            val (nx, ny) = calibDots[i]
            CalibPoint(pt.gazeX, pt.gazeY, nx * screenW, ny * screenH)
        }
        val ok = model.fitFromPoints(remapped)
        if (ok) {
            model.save(this)
            statusText.text = "✅ 캘리브레이션 완료! 저장되었습니다."
            dotView.visibility = View.INVISIBLE
            captureBtn.isEnabled = false
            setResult(RESULT_OK)
            window.decorView.postDelayed({ finish() }, 1500)
        } else {
            statusText.text = "❌ 캘리브레이션 실패. 다시 시도해 주세요."
            setResult(RESULT_CANCELED)
        }
        landmarker?.close()
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdown()
        landmarker?.close()
    }
}
