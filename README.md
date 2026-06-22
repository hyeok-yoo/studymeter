# StudyMeter

[![GitHub Pages](https://img.shields.io/badge/Web%20App-Live-blue?logo=github)](https://hyeok-yoo.github.io/studymeter/)
[![Version](https://img.shields.io/badge/version-1.5.0-brightgreen)](https://github.com/hyeok-yoo/studymeter/releases)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)](https://hyeok-yoo.github.io/studymeter/)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=githubsponsors)](https://github.com/sponsors/hyeok-yoo)

> 공부 시간을 **1ms 오차 없이** 측정하고, 카메라 한 대로 집중도를 실시간 분석하며,
> 내 데이터를 근거로 **AI 학습 코치**의 피드백까지 받는 — 올인원 학습 관리 앱.

**[🌐 웹에서 바로 실행하기 →](https://hyeok-yoo.github.io/studymeter/)**
설치 없이 브라우저에서 바로 쓰거나, 홈 화면에 추가해 앱처럼 사용하세요 (PWA).

---

## 한눈에 보기

| | |
|---|---|
| 🎯 **정확한 측정** | 절대 시각 기반 타이머 — 앱을 꺼도, 재시작해도 시간이 어긋나지 않습니다. |
| 🧠 **집중도 분석** | 전면 카메라만으로 심박(rPPG)·시선·졸음을 추정해 0~100점 집중 점수를 냅니다. |
| 🤖 **AI 코치** | Gemini가 내 공부 데이터를 읽고 마크다운으로 구조화된 조언을 줍니다. |
| 📊 **깊이 있는 통계** | 과목·유형·기간별로 순공 시간과 추세를 시각화합니다. |
| 🔒 **오프라인 우선** | 모든 기록은 기기 안(IndexedDB)에 저장 — 인터넷 없이도 완전 동작합니다. |
| 📱 **어디서나** | 웹 · PWA · Android 네이티브를 하나의 코드베이스로 지원합니다. |

---

## 주요 기능

### ⏱ 타이머 & 세션 관리
- **절대 시각 기반 타이머** — 앱 종료·강제 종료·재시작에도 누적 시간이 정확하게 유지됩니다.
- 과목 → 유형 → 세부 항목(챕터 등)을 고르고 즉시 측정 시작, 도중 전환도 자유롭게.
- 일시정지 / 재개, 세션 종료 시 **자기평가**(집중·만족도·문제풀이·메모) 기록.
- **카운트다운 모드** — 시험·모의고사 시간을 재고 종료음으로 알립니다.

### 🧠 집중도 모니터
- **온디바이스 측정** — 전면 카메라로 rPPG(심박)·MediaPipe(시선)·ONNX 분류를 조합해 집중 점수를 계산.
- **졸음 감지** — 눈 감김 지속 시간을 기준으로 소리/진동/팝업 알림.
- **개인화** — 세션 평가가 쌓이면 점수 기준이 내 패턴에 맞게 보정됩니다.
- **라이트 모드** — 저사양 기기를 위해 졸음만 보는 저전력 측정도 지원.
- (선택) PC 웹캠을 쓰는 WebSocket 분석 서버에도 연결할 수 있습니다.

### 🤖 Gemini AI 학습 코치
- 사용 가능한 모델을 **API에서 동적으로 조회** — 키마다 실제 쓸 수 있는 모델만 노출.
- 선택한 모델의 **능력치 표시**(토큰 한도·온도·추론/검색 지원 여부).
- **Google 검색 그라운딩** 토글로 최신 정보를 근거 삼아 답변 + 출처 링크 제공.
- **추론(Thinking) 과정**은 접이식으로 분리, 답변 본문은 **마크다운으로 렌더링**.
- 오늘/이번 주 공부 데이터를 첨부해 데이터 기반 코칭을 받을 수 있습니다.

### 📊 통계 & 기록
- 일 / 주 / 월 단위 학습 분석, 과목별 막대·도넛 차트, 캘린더 히트맵.
- 순공(자습·테스트) 시간 분리 집계, 이전 기간 대비 증감 비교.
- 과거 기록을 직접 추가·수정·삭제하는 **기록 편집** 화면.

### 📱 PWA & 크로스플랫폼
- **브라우저 즉시 실행** · **홈 화면 추가(PWA)로 오프라인 설치** · **Android 네이티브 앱**(Capacitor).
- Android는 상단 알림바에 경과 시간을 띄우고 거기서 일시정지/종료까지 제어합니다.

---

## 설치 방법

| 방법 | 플랫폼 | 안내 |
|------|--------|------|
| 🌐 웹 브라우저 | 모든 기기 | [링크 접속](https://hyeok-yoo.github.io/studymeter/) 후 바로 사용 |
| 📲 홈 화면 추가 (PWA) | Android / Chrome | 앱 내 **홈 화면에 추가** 버튼 |
| 🍎 홈 화면 추가 (iOS) | iPhone / iPad / Safari | 공유 → **홈 화면에 추가** |
| 🤖 Android APK | Android | Actions 탭 → 최신 빌드의 Artifacts 다운로드 |

---

## 데이터 & 프라이버시

- **공부 기록·설정·메모는 전부 기기 안(IndexedDB)에만 저장**되며, 인터넷 없이도 동작합니다.
- 백업/복원은 하나의 JSON 파일로 직접 내보내고 가져옵니다 — 클라우드 강제 동기화 없음.
- Gemini API 키는 **기기에만** 저장되고, AI에 보내는 메시지는 Google로 직접 전송됩니다(사용자가 보낼 때만).
- 가벼운 사용자 통계는 Firebase Authentication으로 식별된 본인 영역에만 기록되며,
  접근 권한은 Firestore 보안 규칙으로 **본인 / 소유자**만 허용되도록 제한됩니다.

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS 4 + Liquid Glass 디자인 시스템 |
| Animation | Framer Motion |
| Local DB | Dexie (IndexedDB) — 완전 오프라인 |
| Backend | Firebase (Auth + Firestore, 규칙 기반 접근 제어) |
| Native | Capacitor 8 (Android) |
| AI / ML | Google Gemini API · ONNX Runtime Web · MediaPipe Tasks |
| Charts | Recharts |
| Markdown | react-markdown + remark-gfm |
| Deploy | GitHub Pages (PWA) + GitHub Actions (APK) |

---

## 로컬 개발

### 요구사항
- **Node.js 22+**
- Android 빌드 시: **Android SDK (API 36)** · **Java 21**

### 설치 & 실행

```bash
npm install        # 의존성 설치
npm run dev        # 웹 개발 서버 (HMR)
npm run build      # 웹(PWA) 프로덕션 빌드
npm run build:app  # Capacitor(네이티브) 타깃 빌드
npm run lint       # ESLint
```

### Android

```bash
npm run build:app
npx cap sync android
# 이후 Android Studio에서 android/ 폴더를 열어 빌드/실행
```

### Firebase 환경 변수

웹 SDK 설정은 빌드 시 주입됩니다. 로컬에서는 루트에 `.env.local`을 두세요 (git에 커밋되지 않음):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_OWNER_UID=...
```

CI(배포·APK)에서는 GitHub Actions Secrets로 주입됩니다.
Firestore 규칙 배포: `firebase deploy --only firestore:rules`

### 집중도 서버 연결 (선택)

PC에서 분석 서버를 실행한 뒤 **설정 → PC Focus 서버**에 주소를 입력합니다 (예: `ws://192.168.x.x:8765/ws`).

---

## CI/CD

`main`에 push하면 GitHub Actions가 자동으로:

- **GitHub Pages**에 웹 앱 배포 → <https://hyeok-yoo.github.io/studymeter/>
- **Android APK** 빌드 (`npm ci → npm run build:app → cap sync → gradlew assembleDebug`), Artifacts에 30일 보관.

---

## 프로젝트 구조

```
studymeter/
├── src/
│   ├── pages/        # Home · Study · Records · EditRecords · GeminiChat · Settings · Developer · Admin
│   ├── components/   # Layout · 모달 · PWA 설치 안내 · 카메라 등
│   └── lib/          # db(Dexie) · telemetry(Firebase) · gemini · focus(ML 파이프라인) · NativeBridge
├── android/          # Capacitor Android 프로젝트
├── public/           # PWA 아이콘 · manifest
├── firestore.rules   # Firestore 보안 규칙
└── .github/workflows # Pages 배포 + APK 자동 빌드
```

---

## 개발자

**Yoo Seung Hyeok (유승혁)** — Full-Stack Developer · ML Engineer · Designer

[![GitHub](https://img.shields.io/badge/GitHub-hyeok--yoo-black?logo=github)](https://github.com/hyeok-yoo)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=githubsponsors)](https://github.com/sponsors/hyeok-yoo)

기획·디자인·프론트엔드·Android·ML 모델 학습·서버 프로토콜까지 전부 1인 개발.
StudyMeter는 매일 직접 쓰기 위해 만든 도구이고, 그래서 계속 나아집니다.

---

## 라이선스

Private — All rights reserved.
