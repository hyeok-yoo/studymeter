package com.focus.v2android.engine

import ai.onnxruntime.*
import android.content.Context
import android.util.Log
import com.focus.v2android.core.FeatureVector
import java.nio.FloatBuffer

/**
 * Python engine/ml_classifier.py 포트.
 * ONNX Runtime으로 LightGBM 모델 로드 + 추론.
 *
 * 사용 전: scripts/export_onnx.py 실행 → focus_lgbm.onnx 를
 *           app/src/main/assets/focus_lgbm.onnx 에 복사.
 */
class MLClassifier(private val context: Context) {
    private var session: OrtSession? = null
    private var env: OrtEnvironment? = null
    private var imputeMeans: FloatArray? = null  // NaN 대체용 컬럼 평균
    val isReady get() = session != null

    companion object {
        private const val TAG = "MLClassifier"
        const val MODEL_ASSET = "focus_lgbm.onnx"
        const val IMPUTE_ASSET = "impute_means.txt"
        const val N_FEATURES = 14
    }

    fun load(): Boolean {
        return try {
            val ortEnv = OrtEnvironment.getEnvironment()
            env = ortEnv
            val modelBytes = context.assets.open(MODEL_ASSET).readBytes()
            session = ortEnv.createSession(modelBytes, OrtSession.SessionOptions())
            // impute means (NaN 대체): assets/impute_means.txt 에 콤마 구분 14개 float
            imputeMeans = try {
                context.assets.open(IMPUTE_ASSET).bufferedReader().readLine()
                    .split(",").map { it.trim().toFloat() }.toFloatArray()
            } catch (e: Exception) {
                FloatArray(N_FEATURES)  // 0으로 대체 (폴백)
            }
            Log.i(TAG, "ONNX 모델 로드 성공")
            true
        } catch (e: Exception) {
            Log.e(TAG, "ONNX 모델 로드 실패: ${e.message}")
            false
        }
    }

    /** FeatureVector → 0~100 집중도 점수. 모델 미로드 시 -1 반환. */
    fun predictFocusScore(features: FeatureVector): Float {
        val sess = session ?: return -1f
        val ortEnv = env ?: return -1f
        val means = imputeMeans ?: FloatArray(N_FEATURES)

        // NaN imputation
        val arr = features.toFloatArray()
        for (i in arr.indices) {
            if (!arr[i].isFinite()) arr[i] = if (i < means.size) means[i] else 0f
        }

        return try {
            val inputName = sess.inputNames.iterator().next()
            val tensorShape = longArrayOf(1, N_FEATURES.toLong())
            val buf = FloatBuffer.wrap(arr)
            val inputTensor = OnnxTensor.createTensor(ortEnv, buf, tensorShape)

            val results = sess.run(mapOf(inputName to inputTensor))
            // ONNX 분류기 출력: probabilities [batch, n_classes]
            // 첫 클래스(label=0=focused)의 확률 × 100
            val probTensor = results[1].value  // index 1 = probabilities map or array
            val score: Float = when (val v = probTensor) {
                is Array<*> -> {
                    // shape [1, 2]: [[p_focused, p_distracted]]
                    @Suppress("UNCHECKED_CAST")
                    val inner = (v as Array<FloatArray>)[0]
                    inner[0] * 100f  // P(focused) * 100
                }
                is Map<*, *> -> {
                    @Suppress("UNCHECKED_CAST")
                    val map = v as Map<Long, FloatArray>
                    val p0 = map[0L]?.get(0) ?: 0.5f
                    p0 * 100f
                }
                else -> 50f
            }
            inputTensor.close()
            score.coerceIn(0f, 100f)
        } catch (e: Exception) {
            Log.e(TAG, "추론 실패: ${e.message}")
            50f
        }
    }

    fun close() {
        // session만 닫고 null로 비운다. (env는 프로세스 전역 싱글톤이므로 닫지 않고 재사용 →
        // stop 후 재시작 시 load()로 세션을 다시 생성할 수 있다.)
        session?.close()
        session = null
    }
}
