# StudyMeter

[![GitHub Pages](https://img.shields.io/badge/Web%20App-GitHub%20Pages-blue?logo=github)](https://hyeok-yoo.github.io/studymeter/)
[![Version](https://img.shields.io/badge/version-1.5.0-brightgreen)](https://github.com/hyeok-yoo/studymeter/releases)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=githubsponsors)](https://github.com/sponsors/hyeok-yoo)

> 공부 시간을 정확하게 측정하고, 집중도를 실시간으로 모니터링하는 학습 관리 앱

**[🌐 웹에서 바로 실행하기 →](https://hyeok-yoo.github.io/studymeter/)**  
브라우저에서 바로 사용하거나, 홈 화면에 추가해 앱처럼 설치할 수 있습니다 (PWA).

---

## 주요 기능

### ⏱ 타이머 & 세션 관리
- **절대 시각 기반 타이머** — 앱 종료·재시작 후에도 시간 정확도 1ms 오차 없이 유지
- 과목 / 유형 / 세부 항목(챕터 등) 선택 후 즉시 측정 시작
- 일시정지 / 재개, 세션 종료 후 자기평가(별점) 기록
- **카운트다운 모드** — 시험·테스트 시간 측정

### 🔔 Now Bar (Android 알림)
- 공부 중 상단 알림바에 경과 시간 실시간 표시
- 알림에서 바로 일시정지 / 재개 / 종료 가능

### 🧠 집중도 모니터 (AI)
- PC에 실행 중인 집중도 서버(WebSocket)와 연결
- **BPM, EAR(졸음 지표), 시선 이동률** 실시간 표시
- 0~100점 집중도 점수 및 예상 잔여 집중 가능 시간 표시
- 태블릿 카메라로 rPPG·MediaPipe·ONNX 기반 자체 측정 지원

### 📊 통계 & 기록
- 일 / 주 / 월 단위 학습 기록 분석
- 과목별 막대 그래프 · 파이 차트 · 캘린더 히트맵
- 이전 기간 대비 증감 비교

### 🤖 Gemini AI 학습 코치
- Gemini API 연동 AI 채팅
- 오늘/이번 주 학습 데이터를 AI에 공유해 피드백 요청 가능

### 📱 PWA & 크로스플랫폼
- **브라우저에서 바로 실행** — 설치 불필요
- **홈 화면 추가(PWA)** — 앱처럼 설치, 오프라인 동작
- **Android 네이티브 앱** — Capacitor 8 기반, Play Store 배포 가능

---

## 설치 방법

| 방법 | 플랫폼 | 방법 |
|------|--------|------|
| 🌐 웹 브라우저 | 모든 기기 | [링크 접속](https://hyeok-yoo.github.io/studymeter/) 후 바로 사용 |
| 📲 홈 화면 추가 (PWA) | Android/Chrome | 앱 내 **홈 화면에 추가** 버튼 클릭 |
| 🍎 홈 화면 추가 (iOS) | iPhone/iPad/Safari | 공유 버튼 → **홈 화면에 추가** |
| 🤖 Android APK | Android | Actions 탭 → 최신 Artifacts 다운로드 |

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS 4 + Liquid Glass 디자인 시스템 |
| Animation | Framer Motion |
| DB | Dexie (IndexedDB) — 완전 오프라인 |
| Native | Capacitor 8 |
| AI | Google Gemini API, ONNX Runtime Web, MediaPipe |
| Charts | Recharts |
| Deploy | GitHub Pages (PWA) + GitHub Actions (APK) |

---

## GitHub Actions — 자동 빌드 & 배포

`main` 브랜치에 push 하면 자동으로:
- **GitHub Pages** 에 웹 앱이 배포됩니다 → [https://hyeok-yoo.github.io/studymeter/](https://hyeok-yoo.github.io/studymeter/)
- **debug APK** 가 빌드됩니다 (Actions 탭 → Artifacts)

APK 빌드 흐름:
```
npm ci → npm run build → npx cap sync android → ./gradlew assembleDebug
```

> APK는 30일간 보관됩니다.

---

## 로컬 개발 환경

### 요구사항
- Node.js 22+
- Android Studio (Android SDK API 36) — Android 빌드 시
- Java 17 — Android 빌드 시

### 설치 & 실행

```bash
# 의존성 설치
npm install

# 웹 개발 서버 (브라우저)
npm run dev

# Android 빌드
npm run build
npx cap sync android
# Android Studio에서 android/ 폴더 열기
```

### 집중도 서버 연결 (선택)

PC에서 집중도 분석 서버를 실행한 뒤, 앱 **설정 → PC Focus 서버** 에 WebSocket 주소를 입력합니다.  
형식: `ws://192.168.x.x:8765/ws`

---

## 설정

| 항목 | 설명 |
|------|------|
| 사용자 이름 | 홈 화면 인사말에 표시 |
| 과목 관리 | 과목 추가/삭제, 세부 항목(챕터 등) 설정 |
| 유형 관리 | 자습, 인강, 테스트 등 학습 유형 커스텀 |
| 일일 목표 시간 | 홈 화면 진행률 표시 |
| Gemini API 키 | AI 코치 기능 활성화 |
| 테마 | 라이트 / 다크 / 시스템 |
| PC Focus 서버 | 집중도 모니터 WebSocket 주소 |

---

## 프로젝트 구조

```
studymeter/
├── src/
│   ├── pages/          # Home, Study, Records, GeminiChat, Settings, EditRecords, Developer
│   ├── components/     # Layout, 모달, PWAInstallPrompt, HelpButton, 카메라 등
│   └── lib/            # DB(Dexie), NativeBridge, focusSync
├── android/            # Capacitor Android 프로젝트
├── public/             # PWA 아이콘, manifest
└── .github/workflows/  # GitHub Pages 배포 + APK 자동 빌드
```

---

## 개발자

**Yoo Seung Hyeok (유승혁)** — Full-Stack Developer · ML Engineer · Designer

[![GitHub](https://img.shields.io/badge/GitHub-hyeok--yoo-black?logo=github)](https://github.com/hyeok-yoo)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=githubsponsors)](https://github.com/sponsors/hyeok-yoo)

기획·디자인·프론트엔드·Android·ML 모델까지 전부 1인 개발.  
StudyMeter는 스스로 매일 사용하기 위해 만든 도구입니다.

---

## 라이선스

Private — All rights reserved.
