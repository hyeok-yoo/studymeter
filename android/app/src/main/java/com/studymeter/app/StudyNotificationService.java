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

    /**
     * 세션 시작·종료 신호 알림 — 자동화 도구(MacroDroid·Tasker 등)가 잡을 "사건" 두 개.
     *
     * 나우바 알림은 이 용도로 쓸 수 없다. 1초마다 갱신되며 다시 게시되기 때문에
     * "알림 수신" 트리거가 초당 한 번씩 발동해 매크로가 무한히 재실행된다.
     * 그리고 세션이 끝날 때는 "사라질" 뿐 새 알림이 오지 않아 끄는 쪽 트리거가 아예 없다.
     *
     * 그래서 시작·종료 순간에만 딱 한 번 게시되는 별도 알림을 둔다. 제목이 고정이라
     * "특정 단어가 포함된 알림" 조건으로 정확히 잡히고, 갱신되지 않으니 반복 발동이 없다.
     *
     * 두 제목은 서로, 그리고 나우바 텍스트("{과목} {시간}" / "집중 중" / "일시정지")와
     * 겹치면 안 된다. 겹치면 한쪽 신호가 반대쪽 매크로를 발동시킨다.
     */
    private static final String SIGNAL_CHANNEL_ID = "study_session_signal_channel";
    /** 종료 신호만 있던 시절의 채널 — 알림 설정에 유령 항목으로 남지 않도록 지운다. */
    private static final String LEGACY_END_CHANNEL_ID = "study_session_end_channel";
    private static final int START_NOTIFICATION_ID = 1003;
    private static final int END_NOTIFICATION_ID = 1002;
    /** 자동화 도구가 잡고 난 뒤 알림창에 남지 않도록 스스로 사라지는 시간. */
    private static final long SIGNAL_TIMEOUT_MS = 10_000L;
    public static final String START_SIGNAL_TITLE = "공부 세션 시작";
    public static final String END_SIGNAL_TITLE = "공부 세션 종료";

    /**
     * 신호 알림 on/off (설정 → 알림). JS 가 NowBar.setEndSignalEnabled 로 써 두면
     * 서비스가 죽는 시점에 읽는다 — 종료 경로가 WebView 없이도 도니까 필드가 아니라 prefs 다.
     */
    public static final String SIGNAL_PREFS = "StudyMeterSignals";
    public static final String END_SIGNAL_KEY = "endSignalEnabled";

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
    private boolean sessionStarted = false; // 세션이 실제로 시작됐는지 — 종료 신호를 띄울지 판단

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
            // 시작 신호는 세션당 한 번만 — START 가 다시 와도 이미 켜져 있으면 보내지 않는다.
            boolean firstStart = !sessionStarted;
            sessionStarted = true;
            long initElapsed = System.currentTimeMillis() - sessionStartTime;
            startForegroundNotification(initElapsed);
            startUpdating();
            if (firstStart && signalsEnabled()) postSessionStartSignal();

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
            sessionStarted = true;
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

    /** 설정을 켠 적이 없으면 기본 on. */
    private boolean signalsEnabled() {
        return getSharedPreferences(SIGNAL_PREFS, Context.MODE_PRIVATE).getBoolean(END_SIGNAL_KEY, true);
    }

    /**
     * 시작·종료 신호를 한 번 띄운다. 나우바와 별개의 알림·채널이라 "새 알림 도착"으로 잡히고,
     * 갱신되지 않으므로 자동화 트리거가 딱 한 번만 발동한다.
     *
     * 무음·저중요도이고 {@link #SIGNAL_TIMEOUT_MS} 뒤 시스템이 알아서 지운다
     * (종료 신호는 서비스가 이미 죽은 뒤라 Handler 로는 못 지운다 — setTimeoutAfter 에 맡긴다).
     */
    private void postSignal(int id, String title, String body) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        try {
            // 종료 신호만 있던 시절의 채널이 남아 있으면 정리한다.
            if (manager.getNotificationChannel(LEGACY_END_CHANNEL_ID) != null) {
                manager.deleteNotificationChannel(LEGACY_END_CHANNEL_ID);
            }

            NotificationChannel channel = new NotificationChannel(
                    SIGNAL_CHANNEL_ID,
                    "공부 세션 시작·종료 신호",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("세션이 시작·종료될 때 한 번씩 뜨는 알림입니다. MacroDroid·Tasker 등에서 앱 차단을 자동으로 걸고 푸는 데 씁니다.");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);

            Notification notification = new Notification.Builder(this, SIGNAL_CHANNEL_ID)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setSmallIcon(R.drawable.ic_stat_studymeter)
                    .setColor(Color.parseColor("#6366f1"))
                    .setAutoCancel(true)
                    .setTimeoutAfter(SIGNAL_TIMEOUT_MS)
                    .build();

            manager.notify(id, notification);
            Log.d(TAG, "Signal posted: " + title);
        } catch (Exception e) {
            // 신호는 부가 기능이다 — 실패해도 세션 시작·종료 자체를 막지 않는다.
            Log.e(TAG, "postSignal failed: " + title, e);
        }
    }

    private void postSessionStartSignal() {
        postSignal(START_NOTIFICATION_ID, START_SIGNAL_TITLE, currentSubject + " 시작");
    }

    /** 루틴을 안 쓰는 사람에게도 의미가 있도록 오늘 누적을 한 줄로 담는다. */
    private void postSessionEndSignal() {
        // 일시정지 상태로 끝났다면 멈춘 시각까지만 센다.
        long at = (!isRunning && pauseStartTime > 0) ? pauseStartTime : System.currentTimeMillis();
        long sessionElapsed = Math.max(0, at - sessionStartTime);
        long totalToday = Math.max(0, baseTotalStudyMs + sessionElapsed);
        postSignal(END_NOTIFICATION_ID, END_SIGNAL_TITLE,
                "세션 " + formatElapsed(sessionElapsed) + " · 오늘 " + formatElapsed(totalToday));
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
        // 종료 경로가 둘이다: JS 의 stopNowBar() 는 stopService() 라 onStartCommand 를 타지 않고,
        // 알림 "종료" 버튼은 STOP_SESSION → stopSelf() 로 온다. 둘 다 여기로 모이므로 신호는 여기서 띄운다.
        if (sessionStarted) {
            sessionStarted = false;
            if (signalsEnabled()) postSessionEndSignal();
        }
        Log.d(TAG, "StudyNotificationService destroyed");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
