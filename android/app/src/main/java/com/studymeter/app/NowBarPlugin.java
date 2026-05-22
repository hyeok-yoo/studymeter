package com.studymeter.app;

import android.content.Intent;
import android.util.Log;
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

        try {
            Intent intent = new Intent(getContext(), StudyNotificationService.class);
            intent.setAction("START");
            intent.putExtra("subject", subject);
            intent.putExtra("startTime", startTime != null ? startTime : System.currentTimeMillis());
            intent.putExtra("isRunning", isRunning != null ? isRunning : true);
            intent.putExtra("totalStudyMs", totalStudyMs);
            intent.putExtra("subjectStudyMs", subjectStudyMs);

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

        try {
            Intent intent = new Intent(getContext(), StudyNotificationService.class);
            intent.setAction("UPDATE");
            intent.putExtra("subject", subject);
            intent.putExtra("startTime", startTime != null ? startTime : System.currentTimeMillis());
            intent.putExtra("isRunning", isRunning != null ? isRunning : true);
            intent.putExtra("totalStudyMs", totalStudyMs);
            intent.putExtra("subjectStudyMs", subjectStudyMs);

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
