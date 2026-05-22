# Android 16 Live Update Notification (Rich Ongoing Notifications) 연구 보고

## 개요
Android 16(현 개발자 프리뷰 기준)에서 도입된 **Rich Ongoing Notifications**는 상태 표시줄(Status Bar) 상단에 칩(Chip) 형태로 앱의 진행 상태를 실시간으로 보여주는 기능입니다. 이를 통해 사용자는 앱을 열지 않고도 현재 어떤 공부를 얼마나 하고 있는지 즉시 확인할 수 있습니다.

## 주요 특징
- **상태줄 고정**: 시계 옆이나 상태 아이콘 영역에 작은 텍스트/아이콘 칩으로 고정됩니다.
- **실시간성**: Foreground Service를 통해 백그라운드에서도 데이터를 초 단위로 업데이트할 수 있습니다.
- **직관성**: 알림창을 내리지 않아도 현재 공부 중인 과목과 시간을 확인할 수 있어 'Focusing' 앱에 매우 적합합니다.

## 구현 방안 (Capacitor Native Bridge 필요)

### 1. 전제 조건
- **Foreground Service**: Android 시스템이 공부 프로세스를 강제 종료하지 않도록 포그라운드 서비스를 시작해야 합니다.
- **Notification Channel**: 고순위(High Importance) 채널 설정이 필요합니다.

### 2. Native 코드 (Android/Java) 예시
```java
// 알림 생성 및 상태바 업데이트
Notification notification = new Notification.Builder(context, CHANNEL_ID)
    .setSmallIcon(R.drawable.ic_study)
    .setContentTitle("공부 중: " + currentSubject)
    .setContentText(elapsedTime)
    .setOngoing(true)
    .setForegroundServiceType(ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) // Android 14+ 기준
    // Android 16용 스타일 (Rich Ongoing API) 적용 필요
    .build();

startForeground(NOTIFICATION_ID, notification);
```

### 3. Capacitor 연동 구조
1. **TypeScript Side**: 공부 시작 시 `NativeBridge.startOngoingNotification({ subject: "수학" })` 호출.
2. **Native Side**: `StudyNotificationService` 가동 및 1초 주기로 `Notification` 갱신.
3. **TypeScript Side**: 공부 종료 시 `NativeBridge.stopOngoingNotification()` 호출.

## 다음 단계 제안
1. **Native 플러그인 개발**: 현재 Capacitor 기본 알림 플러그인(`@capacitor/local-notifications`)은 실시간 고정 칩 기능을 완벽히 지원하지 않으므로, 커스텀 Native 코드를 작성하여 브릿지를 구축해야 합니다.
2. **Android 16 SDK 설정**: `compileSdk`를 35 이상으로 올리고 최신 런타임 권한(POST_NOTIFICATIONS) 및 포그라운드 서비스 유형을 정의해야 합니다.

---
**의견:** 현재 StudyMeter의 타이머 로직과 잘 어울리는 기능입니다. v1.2.0 버전에서 Native Bridge를 고도화하여 정식 도입하는 것을 추천합니다.