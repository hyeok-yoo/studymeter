package com.studymeter.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.focus.v2android.FocusPlugin;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import org.opencv.android.OpenCVLoader;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "StudyMeter";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor 4+: registerPlugin must come before super.onCreate()
        registerPlugin(NowBarPlugin.class);
        registerPlugin(FocusPlugin.class);
        registerPlugin(DeviceSoundPlugin.class);
        registerPlugin(NativeUiPlugin.class);
        OpenCVLoader.initDebug();
        Log.d(TAG, "NowBarPlugin registered");

        super.onCreate(savedInstanceState);

        // 앱 시작 시 즉시 알림 채널 생성
        createNotificationChannel();

        // 백그라운드에 오래 있으면 시스템이 메모리를 되찾으려고 WebView 렌더러 프로세스만 죽이기도 한다.
        // 이 콜백을 아무도 처리하지 않으면(false) Chromium 이 앱 프로세스까지 끝내 버린다 — 나우바 서비스와
        // 함께. 그러면 공부 세션이 "죽은 채로" 계속 흐른 것처럼 보인다. 처리했다고 알리고 액티비티를 다시
        // 만들어 새 WebView 를 띄운다. 진행 중인 세션은 localStorage 의 절대 시각으로 그대로 복원된다.
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    Log.w(TAG, "WebView renderer gone (crash=" + (detail != null && detail.didCrash()) + ") — recreating");
                    new Handler(Looper.getMainLooper()).post(() -> {
                        try {
                            recreate();
                        } catch (Exception e) {
                            Log.e(TAG, "recreate after renderer loss failed", e);
                            finish();
                        }
                    });
                    return true;
                }
            });
        }
    }

    private void createNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        // 서비스와 같은 설정으로 만든다. 이미 있으면 createNotificationChannel 은 아무것도 바꾸지 않는다.
        if (manager.getNotificationChannel(StudyNotificationService.CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                    StudyNotificationService.CHANNEL_ID,
                    "공부 세션 타이머",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("현재 공부 상태와 시간을 실시간으로 알림바에 표시합니다.");
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
        }
        StudyNotificationService.deleteLegacyChannel(manager);
    }
}
