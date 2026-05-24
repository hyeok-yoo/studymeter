package com.focus.v2android

import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.focus.v2android.engine.ScoreCalibrator
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import org.opencv.android.OpenCVLoader
import java.util.concurrent.Executors

@CapacitorPlugin(name = "FocusPlugin")
class FocusPlugin : Plugin() {

    companion object {
        private const val TAG = "FocusPlugin"
        private const val CALIB_REQUEST_CODE = 201
    }

    private val pipeline by lazy { FocusPipeline(activity.applicationContext) }
    private val scoreCalibrator by lazy { ScoreCalibrator(activity.applicationContext) }
    private var cameraProvider: ProcessCameraProvider? = null
    private var imageAnalysis: ImageAnalysis? = null
    private var isRunning = false
    private val executor = Executors.newSingleThreadExecutor()

    override fun load() {
        OpenCVLoader.initDebug()
        val metrics = activity.resources.displayMetrics
        pipeline.screenWidth = metrics.widthPixels
        pipeline.screenHeight = metrics.heightPixels

        executor.submit {
            val ok = pipeline.init()
            Log.i(TAG, "Pipeline init: $ok")
            val state = JSObject().apply {
                put("type", "pipeline_state")
                put("running", false)
                put("model", if (ok) "focus_lgbm.onnx" else null)
                put("calibration", "SharedPreferences")
            }
            notifyListeners("pipelineState", state)
        }
    }

    @PluginMethod
    fun startPipeline(call: PluginCall) {
        if (isRunning) { call.resolve(); return }
        startCamera()
        isRunning = true
        val state = JSObject().apply {
            put("type", "pipeline_state"); put("running", true)
            put("model", "focus_lgbm.onnx"); put("calibration", "SharedPreferences")
        }
        notifyListeners("pipelineState", state)
        call.resolve()
    }

    @PluginMethod
    fun stopPipeline(call: PluginCall) {
        isRunning = false
        cameraProvider?.unbindAll()
        val state = JSObject().apply { put("type", "pipeline_state"); put("running", false); put("model", null); put("calibration", null) }
        notifyListeners("pipelineState", state)
        call.resolve()
    }

    @PluginMethod
    fun getPipelineState(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("type", "pipeline_state"); put("running", isRunning)
            put("model", if (isRunning) "focus_lgbm.onnx" else null)
            put("calibration", "SharedPreferences")
        })
    }

    @PluginMethod
    fun startCalibration(call: PluginCall) {
        val scenario = call.getString("scenario", "monitor") ?: "monitor"
        val intent = Intent(activity, CalibrationActivity::class.java).apply {
            putExtra("scenario", scenario)
        }
        startActivityForResult(call, intent, CALIB_REQUEST_CODE)
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        if (requestCode == CALIB_REQUEST_CODE) {
            if (resultCode == android.app.Activity.RESULT_OK) {
                pipeline.reloadCalibration()
                savedCall?.resolve(JSObject().apply { put("success", true) })
            } else {
                savedCall?.resolve(JSObject().apply { put("success", false) })
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(activity)
        cameraProviderFuture.addListener({
            val provider = cameraProviderFuture.get()
            cameraProvider = provider

            val analysis = ImageAnalysis.Builder()
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setTargetResolution(android.util.Size(640, 480))
                .build()

            analysis.setAnalyzer(executor) { imageProxy: ImageProxy ->
                if (isRunning) {
                    try {
                        val bitmap = Bitmap.createBitmap(imageProxy.width, imageProxy.height, Bitmap.Config.ARGB_8888)
                        imageProxy.planes[0].buffer.rewind()
                        bitmap.copyPixelsFromBuffer(imageProxy.planes[0].buffer)
                        val result = pipeline.processFrame(bitmap)
                        if (result != null) {
                            notifyListeners("focusUpdate", buildFocusUpdatePayload(result))
                        }
                        // Emit annotated camera frame
                        val jpeg = pipeline.lastDebugJpeg
                        if (jpeg != null) {
                            pipeline.lastDebugJpeg = null  // consume once
                            val b64 = Base64.encodeToString(jpeg, Base64.NO_WRAP)
                            notifyListeners("cameraFrame", JSObject().apply {
                                put("jpeg", "data:image/jpeg;base64,$b64")
                            })
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "프레임 처리 오류: ${e.message}")
                    }
                }
                imageProxy.close()
            }
            imageAnalysis = analysis

            try {
                provider.unbindAll()
                provider.bindToLifecycle(activity, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            } catch (e: Exception) {
                Log.e(TAG, "카메라 바인딩 실패: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(activity))
    }

    private fun buildFocusUpdatePayload(result: com.focus.v2android.core.FocusResult): JSObject {
        val feat = result.features
        val features = JSObject().apply {
            put("saccade_rate", feat?.saccadeRateHz ?: 0f)
            put("fixation_ratio", feat?.fixationRatio ?: 0f)
            put("mean_fix_duration", feat?.meanFixDurationS ?: 0f)
            put("mean_velocity", feat?.meanVelocityPxS ?: 0f)
            put("std_velocity", feat?.stdVelocityPxS ?: 0f)
            put("dispersion_x", feat?.gazeDispersionXPx ?: 0f)
            put("dispersion_y", feat?.gazeDispersionYPx ?: 0f)
            put("bpm", feat?.bpm ?: Float.NaN)
            put("rmssd", feat?.rmssdMs ?: Float.NaN)
            put("sdnn", feat?.sdnnMs ?: Float.NaN)
            put("lf_hf", feat?.lfHfRatio ?: Float.NaN)
            put("valid_ratio", feat?.validRatio ?: 0f)
            put("mean_ear", feat?.meanEar ?: Float.NaN)
            put("min_ear", feat?.minEar ?: Float.NaN)
        }

        // Normalized gaze position (0-1)
        val gazeNX = result.gazeScreenX?.let { it / pipeline.screenWidth }
        val gazeNY = result.gazeScreenY?.let { it / pipeline.screenHeight }

        // ROI colors as hex strings
        fun rgbToHex(arr: FloatArray?) = arr?.let {
            String.format("#%02x%02x%02x", it[0].toInt().coerceIn(0,255), it[1].toInt().coerceIn(0,255), it[2].toInt().coerceIn(0,255))
        }

        return JSObject().apply {
            put("type", "focus_update")
            put("ts", SystemClock.elapsedRealtime() / 1000.0)
            put("score", result.score)
            put("eta_s", result.etaS)
            put("features", features)
            put("heuristic_mode", result.isHeuristicMode)
            if (gazeNX != null) put("gaze_x", gazeNX)
            if (gazeNY != null) put("gaze_y", gazeNY)
            rgbToHex(result.roiForehead)?.let { put("roi_forehead_hex", it) }
            rgbToHex(result.roiRightCheek)?.let { put("roi_right_cheek_hex", it) }
            rgbToHex(result.roiLeftCheek)?.let { put("roi_left_cheek_hex", it) }
        }
    }

    @PluginMethod
    fun addSessionRating(call: PluginCall) {
        val meanScore = call.getFloat("mean_score") ?: run { call.reject("mean_score required"); return }
        val rating = call.getInt("rating") ?: run { call.reject("rating required"); return }
        scoreCalibrator.addSession(meanScore, rating)
        call.resolve(JSObject().apply {
            put("session_count", scoreCalibrator.sessionCount)
            put("is_calibrated", scoreCalibrator.isCalibrated)
        })
    }

    @PluginMethod
    fun getTrainingState(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("session_count", scoreCalibrator.sessionCount)
            put("is_calibrated", scoreCalibrator.isCalibrated)
        })
    }

    @PluginMethod
    fun resetScoreCalibration(call: PluginCall) {
        scoreCalibrator.reset()
        call.resolve()
    }

    @PluginMethod
    fun setDebugMode(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        pipeline.debugEnabled = enabled
        if (!enabled) pipeline.lastDebugJpeg = null  // drop any queued frame
        call.resolve()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        pipeline.close()
        executor.shutdown()
    }
}
