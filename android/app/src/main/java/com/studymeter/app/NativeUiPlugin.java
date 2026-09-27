package com.studymeter.app;

import android.app.Activity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NativeUi — 웹뷰만으로는 못 내는 "네이티브 손맛" 두 가지.
 *
 * 1. haptic: 시스템 햅틱(View.performHapticFeedback). 진동 권한이 필요 없고, 사용자가
 *    설정에서 터치 진동을 끄면 알아서 조용해진다 — 네이티브 앱의 버튼과 똑같은 경로다.
 * 2. setImmersive: 상태바 + 내비게이션 바를 함께 숨긴다(스와이프하면 잠깐 나타남).
 *    공부 화면의 화면 보호(번인 방지) 모드에서 하단 제스처 바까지 치우는 데 쓴다.
 */
@CapacitorPlugin(name = "NativeUi")
public class NativeUiPlugin extends Plugin {

    @PluginMethod
    public void haptic(PluginCall call) {
        String kind = call.getString("kind", "tick");
        int constant;
        switch (kind) {
            case "confirm":
                constant = HapticFeedbackConstants.CONFIRM;
                break;
            case "reject":
                constant = HapticFeedbackConstants.REJECT;
                break;
            case "press":
                constant = HapticFeedbackConstants.VIRTUAL_KEY;
                break;
            case "long":
                constant = HapticFeedbackConstants.LONG_PRESS;
                break;
            default:
                constant = HapticFeedbackConstants.CLOCK_TICK;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                View v = getBridge().getWebView();
                if (v != null) v.performHapticFeedback(constant);
            } catch (Exception ignored) {
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(window, window.getDecorView());
                if (on) {
                    ctl.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    ctl.hide(WindowInsetsCompat.Type.navigationBars());
                } else {
                    ctl.show(WindowInsetsCompat.Type.navigationBars());
                }
            } catch (Exception ignored) {
            }
        });
        call.resolve();
    }
}
