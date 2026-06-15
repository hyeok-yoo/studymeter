package com.studymeter.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Bundle;
import android.util.Log;
import com.focus.v2android.FocusPlugin;
import com.getcapacitor.BridgeActivity;
import org.opencv.android.OpenCVLoader;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "StudyMeter";
    private static final String CHANNEL_ID = "study_session_channel";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor 4+: registerPlugin must come before super.onCreate()
        registerPlugin(NowBarPlugin.class);
        registerPlugin(FocusPlugin.class);
        registerPlugin(DeviceSoundPlugin.class);
        OpenCVLoader.initDebug();
        Log.d(TAG, "NowBarPlugin registered");

        super.onCreate(savedInstanceState);

        // 앱 시작 시 즉시 알림 채널 생성
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "공부 세션 타이머",
                NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("현재 공부 상태와 시간을 실시간으로 알림바에 표시합니다.");
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
            Log.d(TAG, "Notification channel created: " + CHANNEL_ID);
        }
    }
}
