package com.studymeter.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "NowBar", permissions = {
        @Permission(alias = "display", strings = { android.Manifest.permission.POST_NOTIFICATIONS })
})
public class NowBarPlugin extends Plugin {
    private static final String TAG = "StudyMeter";
    public static NowBarPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    // JS 리스너로 이벤트 전달
    public void notifyTimerAction(String action) {
        JSObject ret = new JSObject();
        ret.put("action", action);
        notifyListeners("timerAction", ret);
    }

    /**
     * 서비스가 영속화한 대기 액션 큐를 반환하고 즉시 비운다(원자적 소비).
     * WebView가 frozen인 동안 눌린 알림 버튼들을 앱 재개 시 소급 반영하기 위한 경로.
     */
    @PluginMethod
    public void consumePendingActions(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray actions = new JSArray();
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(
                    StudyNotificationService.PENDING_PREFS, Context.MODE_PRIVATE);
            String existing = prefs.getString(StudyNotificationService.PENDING_KEY, "[]");
            // 읽는 즉시 큐를 비워 이중 적용을 방지한다(같은 프로세스 메인스레드에서만 접근).
            prefs.edit().remove(StudyNotificationService.PENDING_KEY).apply();

            JSONArray arr = new JSONArray(existing);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                JSObject item = new JSObject();
                item.put("action", o.getString("action"));
                item.put("at", o.getLong("at"));
                actions.put(item);
            }
        } catch (Exception e) {
            Log.e(TAG, "consumePendingActions failed", e);
        }
        ret.put("actions", actions);
        call.resolve(ret);
    }

    @PluginMethod
    public void startNowBar(PluginCall call) {
        Log.d(TAG, "startNowBar called");
        String subject = call.getString("subject", "공부");
        Long startTime = call.getLong("startTime");
        Boolean isRunning = call.getBoolean("isRunning", true);
        Number totalNum = (Number) call.getData().opt("totalStudyMs");
        Long totalStudyMs = totalNum != null ? totalNum.longValue() : 0L;
        Number subjectNum = (Number) call.getData().opt("subjectStudyMs");
        Long subjectStudyMs = subjectNum != null ? subjectNum.longValue() : 0L;
        Number countdownNum = (Number) call.getData().opt("countdownMs");
        Long countdownMs = countdownNum != null ? countdownNum.longValue() : 0L;

        try {
            Intent intent = new Intent(getContext(), StudyNotificationService.class);
            intent.setAction("START");
            intent.putExtra("subject", subject);
            intent.putExtra("startTime", startTime != null ? startTime : System.currentTimeMillis());
            intent.putExtra("isRunning", isRunning != null ? isRunning : true);
            intent.putExtra("totalStudyMs", totalStudyMs);
            intent.putExtra("subjectStudyMs", subjectStudyMs);
            intent.putExtra("countdownMs", countdownMs);

            getContext().startForegroundService(intent);
            Log.d(TAG, "startNowBar: service started for " + subject);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "startNowBar failed", e);
            call.reject("Failed to start notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopNowBar(PluginCall call) {
        Log.d(TAG, "stopNowBar called");
        try {
            Intent intent = new Intent(getContext(), StudyNotificationService.class);
            intent.setAction("STOP");
            getContext().stopService(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "stopNowBar failed", e);
            call.reject("Failed to stop notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void updateNowBar(PluginCall call) {
        Log.d(TAG, "updateNowBar called");
        String subject = call.getString("subject", "공부");
        Long startTime = call.getLong("startTime");
        Boolean isRunning = call.getBoolean("isRunning", true);
        Number totalNum = (Number) call.getData().opt("totalStudyMs");
        Long totalStudyMs = totalNum != null ? totalNum.longValue() : 0L;
        Number subjectNum = (Number) call.getData().opt("subjectStudyMs");
        Long subjectStudyMs = subjectNum != null ? subjectNum.longValue() : 0L;
        Number countdownNum = (Number) call.getData().opt("countdownMs");
        Long countdownMs = countdownNum != null ? countdownNum.longValue() : 0L;

        try {
            Intent intent = new Intent(getContext(), StudyNotificationService.class);
            intent.setAction("UPDATE");
            intent.putExtra("subject", subject);
            intent.putExtra("startTime", startTime != null ? startTime : System.currentTimeMillis());
            intent.putExtra("isRunning", isRunning != null ? isRunning : true);
            intent.putExtra("totalStudyMs", totalStudyMs);
            intent.putExtra("subjectStudyMs", subjectStudyMs);
            intent.putExtra("countdownMs", countdownMs);

            getContext().startForegroundService(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "updateNowBar failed", e);
            call.reject("Failed to update notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        PermissionState state = getPermissionState("display");
        String stateStr = state != null ? state.toString() : "prompt";
        Log.d(TAG, "checkPermissions: " + stateStr);
        result.put("display", stateStr);
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        Log.d(TAG, "requestPermissions called");
        requestPermissionForAlias("display", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        PermissionState state = getPermissionState("display");
        String stateStr = state != null ? state.toString() : "denied";
        Log.d(TAG, "permissionCallback: " + stateStr);
        result.put("display", stateStr);
        call.resolve(result);
    }
}
