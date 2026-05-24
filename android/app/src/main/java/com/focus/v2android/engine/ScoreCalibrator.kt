package com.focus.v2android.engine

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/**
 * 세션 기반 점수 개인화.
 * 사용자가 세션 후 자신의 집중도를 평가(1-5점)하면,
 * 모델 원점수 → 개인화 점수 선형 매핑을 학습.
 *
 * 저장: SharedPreferences (focus_score_calib)
 * 모델: y = scale * x + offset  (최소제곱 선형회귀)
 */
class ScoreCalibrator(private val context: Context) {

    companion object {
        private const val TAG = "ScoreCalibrator"
        private const val PREF_NAME = "focus_score_calib"
        private const val KEY_SESSIONS = "sessions"
        private const val KEY_SCALE = "scale"
        private const val KEY_OFFSET = "offset"
        private const val MAX_SESSIONS = 30
    }

    // y = scale * rawScore + offset
    private var scale: Float = 1f
    private var offset: Float = 0f
    val isCalibrated: Boolean get() = _sessionCount >= 3

    private var _sessionCount = 0
    val sessionCount get() = _sessionCount

    init { load() }

    /**
     * rawScore: 모델 원점수 0-100
     * 반환: 개인화된 점수 0-100
     */
    fun calibrate(rawScore: Float): Float {
        if (!isCalibrated) return rawScore
        return (scale * rawScore + offset).coerceIn(0f, 100f)
    }

    /**
     * 세션 종료 후 사용자 평가 등록.
     * @param sessionMeanScore 세션 평균 원점수 (0-100)
     * @param userRating       사용자 자기 평가 1-5
     */
    fun addSession(sessionMeanScore: Float, userRating: Int) {
        if (sessionMeanScore.isNaN() || userRating !in 1..5) return
        val targetScore = (userRating - 1) * 25f  // 1→0, 2→25, 3→50, 4→75, 5→100

        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val arr = try { JSONArray(prefs.getString(KEY_SESSIONS, "[]")) } catch (e: Exception) { JSONArray() }
        arr.put(JSONObject().apply { put("raw", sessionMeanScore); put("target", targetScore) })

        // Keep only last MAX_SESSIONS
        val trimmed = JSONArray()
        val start = max(0, arr.length() - MAX_SESSIONS)
        for (i in start until arr.length()) trimmed.put(arr.get(i))

        prefs.edit().putString(KEY_SESSIONS, trimmed.toString()).apply()
        _sessionCount = trimmed.length()
        fitModel(trimmed)
        save()
        Log.i(TAG, "Session added: raw=$sessionMeanScore target=$targetScore scale=$scale offset=$offset")
    }

    private fun fitModel(arr: JSONArray) {
        if (arr.length() < 2) return
        val n = arr.length().toFloat()
        var sumX = 0f; var sumY = 0f; var sumXX = 0f; var sumXY = 0f
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val x = o.getDouble("raw").toFloat()
            val y = o.getDouble("target").toFloat()
            sumX += x; sumY += y; sumXX += x * x; sumXY += x * y
        }
        val denom = n * sumXX - sumX * sumX
        if (Math.abs(denom) < 1e-6f) return
        scale = (n * sumXY - sumX * sumY) / denom
        offset = (sumY - scale * sumX) / n
        // Clamp to reasonable range
        scale = scale.coerceIn(0.3f, 3f)
        offset = offset.coerceIn(-50f, 50f)
    }

    private fun save() {
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit()
            .putFloat(KEY_SCALE, scale)
            .putFloat(KEY_OFFSET, offset)
            .apply()
    }

    private fun load() {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        scale = prefs.getFloat(KEY_SCALE, 1f)
        offset = prefs.getFloat(KEY_OFFSET, 0f)
        val arr = try { JSONArray(prefs.getString(KEY_SESSIONS, "[]")) } catch (e: Exception) { JSONArray() }
        _sessionCount = arr.length()
    }

    fun reset() {
        scale = 1f; offset = 0f; _sessionCount = 0
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit().clear().apply()
    }
}
