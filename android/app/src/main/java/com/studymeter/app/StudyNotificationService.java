package com.studymeter.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.content.pm.ServiceInfo;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

public class StudyNotificationService extends Service {
    private static final String TAG = "StudyMeter";
    public static final String CHANNEL_ID = "study_session_channel";
    private static final int NOTIFICATION_ID = 1001;

    // 알림 액션 영속화 저장소 (WebView가 frozen일 때 소급 반영용)
    public static final String PENDING_PREFS = "StudyMeterPendingActions";
    public static final String PENDING_KEY = "queue";

    private Handler handler;
    private Runnable updateRunnable;
    private String currentSubject = "공부";
    private long sessionStartTime;
    private boolean isRunning = true;
    private long pauseStartTime = 0;        // 마지막 PAUSE 시각 (네이티브 즉시 처리 시 경과시간 보정용)
    private long baseTotalStudyMs = 0;      // 현재 세션을 제외한 오늘 총 누적 공부 시간
    private long baseSubjectStudyMs = 0;    // 현재 세션을 제외한 현재 과목 누적 공부 시간
    private long countdownDurationMs = 0;   // 테스트(카운트다운) 총 시간. 0이면 일반 스톱워치 모드

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        Log.d(TAG, "StudyNotificationService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null)
            return START_NOT_STICKY;

        String action = intent.getAction();
        Log.d(TAG, "onStartCommand action=" + action);

        if ("START".equals(action)) {
            currentSubject = intent.getStringExtra("subject");
            if (currentSubject == null)
                currentSubject = "공부";
            // startTime = chronometerBase = now - sessionElapsed (JS에서 계산)
            sessionStartTime = intent.getLongExtra("startTime", System.currentTimeMillis());
            isRunning = intent.getBooleanExtra("isRunning", true);
            // JS에서 현재 세션 포함한 합산값을 전달하므로, 베이스값을 계산해 둡니다.
            long totalFromJs = intent.getLongExtra("totalStudyMs", 0);
            long subjectFromJs = intent.getLongExtra("subjectStudyMs", 0);
            long currentElapsedAtCall = System.currentTimeMillis() - sessionStartTime;
            baseTotalStudyMs = totalFromJs - currentElapsedAtCall;
            baseSubjectStudyMs = subjectFromJs - currentElapsedAtCall;
            countdownDurationMs = intent.getLongExtra("countdownMs", 0);

            ensureNotificationChannel();
            long initElapsed = System.currentTimeMillis() - sessionStartTime;
            startForegroundNotification(initElapsed);
            startUpdating();

        } else if ("UPDATE".equals(action)) {
            isRunning = intent.getBooleanExtra("isRunning", true);
            currentSubject = intent.getStringExtra("subject");
            if (currentSubject == null)
                currentSubject = "공부";
            // startTime = chronometerBase = now - sessionElapsed (JS에서 계산)
            sessionStartTime = intent.getLongExtra("startTime", System.currentTimeMillis());
            // JS에서 현재 세션 포함한 합산값을 전달하므로, 베이스값을 계산해 둡니다.
            long totalFromJs = intent.getLongExtra("totalStudyMs", 0);
            long subjectFromJs = intent.getLongExtra("subjectStudyMs", 0);
            long currentElapsedAtCall = System.currentTimeMillis() - sessionStartTime;
            baseTotalStudyMs = totalFromJs - currentElapsedAtCall;
            baseSubjectStudyMs = subjectFromJs - currentElapsedAtCall;
            countdownDurationMs = intent.getLongExtra("countdownMs", 0);

            // startForegroundService() 계약 준수: UPDATE도 항상 startForeground를 호출한다.
            // (호출하지 않으면 서비스가 foreground가 아닌 상태에서 재시작될 때
            //  "startForegroundService did not then call startForeground" 크래시가 발생함)
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null && mgr.getNotificationChannel(CHANNEL_ID) == null) {
                ensureNotificationChannel();
            }
            long initElapsed = System.currentTimeMillis() - sessionStartTime;
            startForegroundNotification(initElapsed);

            if (isRunning) {
                startUpdating();
            } else {
                stopUpdating();
            }

        } else if ("STOP".equals(action)) {
            stopUpdating();
            stopForeground(true);
            stopSelf();
        } else if ("PAUSE".equals(action)) {
            // 네이티브 즉시 처리: 틱을 멈추고 그 시점 경과시간으로 알림을 고정 갱신한다.
            // (WebView가 frozen이어도 알림 시계가 계속 흐르지 않도록)
            long at = System.currentTimeMillis();
            if (isRunning) {
                isRunning = false;
                pauseStartTime = at;
                stopUpdating();
                long elapsed = at - sessionStartTime;
                updateNotification(elapsed); // 버튼도 "계속하기"로 전환됨
            }
            persistAction("pause", at);
            if (NowBarPlugin.instance != null) {
                NowBarPlugin.instance.notifyTimerAction("pause");
            }
        } else if ("RESUME".equals(action)) {
            // 네이티브 즉시 처리: 일시정지됐던 시간만큼 sessionStartTime(크로노 base)을 보정하고 틱 재개
            long at = System.currentTimeMillis();
            if (!isRunning) {
                if (pauseStartTime > 0) {
                    sessionStartTime += (at - pauseStartTime);
                }
                pauseStartTime = 0;
                isRunning = true;
                startUpdating();
            }
            persistAction("resume", at);
            if (NowBarPlugin.instance != null) {
                NowBarPlugin.instance.notifyTimerAction("resume");
            }
        } else if ("STOP_SESSION".equals(action)) {
            // 네이티브 즉시 처리: 틱 중단 + 알림 즉시 제거 (앱을 열 때까지 남지 않도록)
            long at = System.currentTimeMillis();
            isRunning = false;
            stopUpdating();
            persistAction("stop", at);
            if (NowBarPlugin.instance != null) {
                NowBarPlugin.instance.notifyTimerAction("stop");
            }
            stopForeground(true);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /**
     * 알림 액션을 타임스탬프와 함께 SharedPreferences에 append.
     * JS가 thaw될 때 consumePendingActions()로 큐를 읽어 버튼 누른 시각 기준으로 소급 반영한다.
     */
    private void persistAction(String action, long at) {
        try {
            SharedPreferences prefs = getSharedPreferences(PENDING_PREFS, Context.MODE_PRIVATE);
            String existing = prefs.getString(PENDING_KEY, "[]");
            JSONArray arr = new JSONArray(existing);
            JSONObject obj = new JSONObject();
            obj.put("action", action);
            obj.put("at", at);
            arr.put(obj);
            prefs.edit().putString(PENDING_KEY, arr.toString()).apply();
            Log.d(TAG, "persistAction " + action + " @" + at);
        } catch (Exception e) {
            Log.e(TAG, "persistAction failed", e);
        }
    }

    private void startUpdating() {
        stopUpdating();
        updateRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    long elapsed = System.currentTimeMillis() - sessionStartTime;
                    updateNotification(elapsed);
                    handler.postDelayed(this, 1000);
                }
            }
        };
        handler.post(updateRunnable);
    }

    private void stopUpdating() {
        if (updateRunnable != null) {
            handler.removeCallbacks(updateRunnable);
            updateRunnable = null;
        }
    }

    private void startForegroundNotification(long elapsed) {
        Notification notification = buildNotification(elapsed);
        try {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            Log.d(TAG, "startForeground succeeded");
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
        }
    }

    private void updateNotification(long elapsed) {
        Notification notification = buildNotification(elapsed);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification(long sessionElapsed) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        // 시간 계산 — 실시간 업데이트 반영 (과거 누적 + 현재 세션 경과)
        long liveTotalStudyMs = baseTotalStudyMs + sessionElapsed;
        long liveSubjectStudyMs = baseSubjectStudyMs + sessionElapsed;

        String sessionTimeStr = formatElapsed(sessionElapsed);
        String subjectTimeStr = formatElapsed(liveSubjectStudyMs);
        String totalTimeStr = formatElapsed(liveTotalStudyMs);

        // 카운트다운(테스트) 모드에서는 올라가는 경과가 아니라 남은 시간을 보여준다.
        // 칩이 스톱워치처럼 올라가면 시험 시간이 얼마 남았는지 알 수 없다.
        boolean countdown = countdownDurationMs > 0;
        long remainingMs = countdown ? Math.max(0, countdownDurationMs - sessionElapsed) : 0;
        boolean finished = countdown && remainingMs <= 0;

        String statusText;
        if (countdown) {
            statusText = finished ? "시간 종료" : (isRunning ? "테스트 진행 중" : "일시정지");
        } else {
            statusText = isRunning ? "집중 중" : "일시정지";
        }

        // 칩에 표시할 짧은 텍스트 (과목 H:MM:SS)
        String chipText = countdown
                ? currentSubject + " " + (finished ? "종료" : formatChipTime(remainingMs))
                : currentSubject + " " + formatChipTime(liveTotalStudyMs);

        // 타이틀: 카운트다운이면 남은 시간, 아니면 오늘 총 누적
        String titleText = countdown
                ? currentSubject + " " + (finished ? "시간 종료" : formatElapsed(remainingMs) + " 남음")
                : currentSubject + " " + totalTimeStr;

        // ProgressStyle 은 줄바꿈(\n)을 무시하고 한 줄로 표시하므로, 최대한 간결하게 가로 한 줄로 배치
        String contentText = countdown
                ? "경과 " + sessionTimeStr + " · 전체 " + formatElapsed(countdownDurationMs) + " · 오늘 " + totalTimeStr
                : "세션 " + sessionTimeStr + " · 과목 " + subjectTimeStr + " · 오늘 " + totalTimeStr;

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(titleText)
                .setContentText(contentText)
                .setSubText(statusText) // "집중 중" 등 상태는 헤더 영역(우측 상단)으로 이동
                .setSmallIcon(R.drawable.ic_stat_studymeter)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setColor(Color.parseColor("#6366f1"))
                .setCategory(Notification.CATEGORY_STOPWATCH)
                .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);

        // Actions 추가
        Intent pauseIntent = new Intent(this, StudyNotificationService.class).setAction("PAUSE");
        PendingIntent pendingPause = PendingIntent.getService(this, 1, pauseIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        Intent resumeIntent = new Intent(this, StudyNotificationService.class).setAction("RESUME");
        PendingIntent pendingResume = PendingIntent.getService(this, 2, resumeIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        Intent stopIntent = new Intent(this, StudyNotificationService.class).setAction("STOP_SESSION");
        PendingIntent pendingStop = PendingIntent.getService(this, 3, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        if (isRunning) {
            builder.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_action_pause), "일시정지", pendingPause).build());
        } else {
            builder.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_action_play), "계속하기", pendingResume).build());
        }
        builder.addAction(new Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_action_stop), "종료", pendingStop).build());

        // Now Bar (Live Update) 칩에서 텍스트(critical_text)를 표시하려면 Chronometer를 꺼야 합니다.
        // 강제로 크로노미터를 끄고, 대신 1초마다 서비스에서 업데이트를 발생시킵니다.
        builder.setUsesChronometer(false);
        builder.setShowWhen(false);

        // 스타일 적용 (다중 줄 지원을 위해 Fallback부터 먼저 설정)
        // 안드로이드 15 이하거나, ProgressStyle 미지원 환경을 위한 기본 스타일
        builder.setStyle(new Notification.BigTextStyle()
                .bigText(countdown
                        ? "남은 시간: " + (finished ? "0:00:00" : formatElapsed(remainingMs))
                                + "\n경과: " + sessionTimeStr
                                + "\n오늘: " + totalTimeStr
                        : "세션: " + sessionTimeStr + "\n과목: " + subjectTimeStr + "\n오늘: " + totalTimeStr)
                .setBigContentTitle(titleText));

        // Android 16 (API 36) 이상: ProgressStyle + Promoted Ongoing으로 Now Bar 칩 진입
        // API가 stable SDK에 없을 수 있으므로 reflection으로 안전하게 호출
        if (Build.VERSION.SDK_INT >= 36) {
            boolean progressStyleApplied = false;
            try {
                // Notification.ProgressStyle를 reflection으로 인스턴스화
                Class<?> psClass = Class.forName("android.app.Notification$ProgressStyle");
                Constructor<?> psCtor = psClass.getDeclaredConstructor();
                psCtor.setAccessible(true);
                Notification.Style progressStyle = (Notification.Style) psCtor.newInstance();
                
                // BigTextStyle과 같이 세부 텍스트를 보여주려면 텍스트들을 넘겨줄 수 있는 메소드를 찾거나 
                // 없으면 그냥 setStyle로 적용.
                builder.setStyle(progressStyle);
                progressStyleApplied = true;
                Log.d(TAG, "ProgressStyle applied via reflection");
            } catch (Exception e) {
                Log.w(TAG, "ProgressStyle not available via reflection: " + e.getMessage());
            }

            if (progressStyleApplied) {
                // setShortCriticalText — 칩에 표시될 텍스트
                try {
                    Method setShortCriticalText = Notification.Builder.class
                            .getMethod("setShortCriticalText", CharSequence.class);
                    setShortCriticalText.invoke(builder, (CharSequence) chipText);
                    Log.d(TAG, "setShortCriticalText=" + chipText);
                } catch (Exception e) {
                    Log.w(TAG, "setShortCriticalText not available: " + e.getMessage());
                }

                // setRequestPromotedOngoing — 상태바 칩으로 승격 요청
                try {
                    Method setPromoted = Notification.Builder.class
                            .getMethod("setRequestPromotedOngoing", boolean.class);
                    setPromoted.invoke(builder, true);
                    Log.d(TAG, "setRequestPromotedOngoing=true");
                } catch (Exception e) {
                    Log.w(TAG, "setRequestPromotedOngoing not available: " + e.getMessage());
                }
            }
        }

        Notification notification = builder.build();

        // 디버깅: promotable 특성 확인 (reflection으로)
        if (Build.VERSION.SDK_INT >= 36) {
            try {
                Method hasPromotable = Notification.class.getMethod("hasPromotableCharacteristics");
                boolean promotable = (boolean) hasPromotable.invoke(notification);
                Log.d(TAG, "hasPromotableCharacteristics=" + promotable);
            } catch (Exception e) {
                Log.w(TAG, "hasPromotableCharacteristics not available: " + e.getMessage());
            }
        }

        return notification;
    }

    private void applyFallbackStyle(Notification.Builder builder,
            String sessionTimeStr, String subjectTimeStr, String totalTimeStr, String statusText) {
        builder.setStyle(new Notification.BigTextStyle()
                .bigText("세션: " + sessionTimeStr + "\n"
                        + currentSubject + " 누적: " + subjectTimeStr + "\n"
                        + "오늘 총: " + totalTimeStr)
                .setBigContentTitle(currentSubject + " - " + statusText));
    }

    /**
     * 칩에 표시할 짧은 시간 포맷 (최대 7자)
     * 예: "05:30", "1:23:45"
     */
    private String formatChipTime(long elapsed) {
        if (elapsed < 0) elapsed = 0;
        long totalSeconds = elapsed / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;

        if (hours > 0) {
            return String.format("%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format("%02d:%02d", minutes, seconds);
    }

    private void ensureNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            // 기존 채널 삭제 후 재생성 (중요도 변경 적용)
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
            if (existing != null) {
                manager.deleteNotificationChannel(CHANNEL_ID);
                Log.d(TAG, "Deleted old channel for recreation");
            }

            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "공부 세션 타이머",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("현재 공부 상태와 시간을 실시간으로 알림바에 표시합니다.");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
            Log.d(TAG, "Notification channel created with IMPORTANCE_HIGH: " + CHANNEL_ID);
        }
    }

    private String formatElapsed(long elapsed) {
        if (elapsed < 0)
            elapsed = 0;
        long totalSeconds = elapsed / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;

        if (hours > 0) {
            return String.format("%d:%02d:%02d", hours, minutes, seconds);
        }
        return String.format("%02d:%02d", minutes, seconds);
    }

    @Override
    public void onDestroy() {
        stopUpdating();
        Log.d(TAG, "StudyNotificationService destroyed");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
