# StudyMeter Handoff Document
**Last Updated:** 2026-02-15 (v1.2 Final — Tablet Blur Fix + Unified Modal Design)

---

## 📌 프로젝트 개요
| 항목 | 내용 |
|------|------|
| **앱 이름** | StudyMeter |
| **목표** | 프리미엄 "Liquid Glass" 디자인의 학습 시간 추적 앱 |
| **플랫폼** | Web (React) + Android (Capacitor) |
| **현재 버전** | v1.2 |
| **최신 APK** | `android/app/build/outputs/apk/debug/app-debug.apk` |

## 🛠 기술 스택
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS 4, Framer Motion
- **State/DB:** Dexie.js (IndexedDB wrapper) — 로컬 우선 데이터
- **Android:** Capacitor 7, Java (Native Modules)
- **디자인 시스템:** "Liquid Glass v4.0" — Blur 32px, Saturation 180%, 초곡면 라운딩(2.5rem)
- **테마:** `document.documentElement`에 `dark` 클래스 토글 (line 51, `App.tsx`)

---

## 🏗 프로젝트 구조
```
src/
├── App.tsx                     # 라우팅, 테마 관리 (dark 클래스는 <html>에 적용)
├── index.css                   # 디자인 시스템 전역 스타일
├── components/
│   ├── Layout.tsx              # 사이드바 + 메인 컨텐츠 레이아웃
│   ├── LiquidModal.tsx         # ModalContext용 범용 모달 (alert/confirm/prompt)
│   ├── SessionEvalModal.tsx    # 학습 세션 종료 시 집중도/만족도 평가
│   ├── StartStudyModal.tsx     # 공부 시작 팝업 (과목 선택, 일정 입력)
│   └── TestTimerModal.tsx      # 테스트 타이머 설정 팝업
├── lib/
│   ├── ModalContext.tsx         # 전역 모달 시스템 (useModal 훅)
│   ├── NativeBridge.ts          # React ↔ Capacitor 네이티브 브릿지
│   ├── db.ts                    # Dexie.js DB 스키마 + 유틸리티 함수
│   └── phrases.ts               # 랜덤 격려 문구
├── pages/
│   ├── Home.tsx                 # 메인 홈 화면
│   ├── Study.tsx                # 스톱워치/타이머 (메인 학습 화면)
│   ├── Records.tsx              # 학습 기록 조회 (차트)
│   ├── EditRecords.tsx          # 학습 기록 수동 편집/추가
│   ├── Settings.tsx             # 설정 페이지
│   └── GeminiChat.tsx           # Gemini AI 채팅 페이지
android/
├── app/src/main/java/.../
│   ├── StudyNotificationService.java  # 포그라운드 서비스 (Live Notification)
│   └── LiveNotificationPlugin.java    # Capacitor 플러그인
```

---

## ✅ v1.2에서 완료된 작업 (이번 세션)

### 1. 태블릿 블러 호환성 해결 — "Sibling Backdrop" 패턴
iPad 등 WebKit 기반 태블릿에서 `backdrop-filter`가 부모 요소에 적용될 때 렌더링이 실패하는 문제를 해결했습니다.

**핵심 패턴:**
```tsx
<div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
  {/* 1. 독립적인 배경 레이어 (블러 전담) */}
  <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-xl" onClick={onClose} />
  
  {/* 2. 독립적인 콘텐츠 레이어 */}
  <motion.div className="relative liquid-modal ..." onClick={e => e.stopPropagation()}>
    {/* 모달 콘텐츠 */}
  </motion.div>
</div>
```

**적용된 파일:**
| 파일 | 변경 내용 |
|------|-----------|
| `StartStudyModal.tsx` | `modal-backdrop` → Sibling Backdrop + Framer Motion 애니메이션 |
| `TestTimerModal.tsx` | `modal-backdrop` → Sibling Backdrop + Framer Motion 애니메이션 |
| `SessionEvalModal.tsx` | inline `backdropFilter` animate → Tailwind `backdrop-blur-xl` 클래스 |
| `EditRecords.tsx` | 중복 경고 모달: 부모 블러 → Sibling Backdrop |
| `Study.tsx` | 테스트 종료 알림: 부모 블러 → Sibling Backdrop + `AnimatePresence` 추가 |
| `LiquidModal.tsx` | 이미 Sibling 패턴 적용 상태 (변경 없음) |

### 2. 통합 모달 디자인 (Liquid Glass 2.0)
모든 팝업 스타일을 `.liquid-modal`/`.solid-modal` CSS 클래스로 통합했습니다.

**`index.css` 주요 변경:**
- `.liquid-modal, .solid-modal` 셀렉터 통합: `blur(32px)`, `border-radius: 2.5rem`, 글래스 보더
- `.modal-backdrop`에서 `backdrop-filter` 제거 (태블릿 호환성)
- 다크 모드 배경 투명도: `rgba(15, 23, 42, 0.75)` → `0.85` (가독성 향상)
- `@apply liquid-modal` 빌드 에러 해결 (Tailwind 4와 호환)

### 3. 입력 필드 스타일 보강
`StartStudyModal.tsx`의 time input에 명시적인 배경/테두리/텍스트 색상 추가:
```
bg-white/5 border border-white/10 text-[var(--color-text)]
```
→ Portal로 렌더링된 모달에서도 다크 모드 스타일이 정상 적용됨

### 4. 기록 탭 UI 개선
- 기본 뷰: 주별 → **일별(Day)**
- 시간 표시: 초 단위 → **시:분 형식**
- 세션 목록 시간순 정렬

### 5. 세션 중복 방지 로직
- `findOverlappingSession()`, `adjustOverlappingSession()` 유틸 함수 (db.ts)
- `EditRecords.tsx`: 중복 경고 팝업 + 자동 조정
- `StartStudyModal.tsx`: 스톱워치 시작 시 자동 조정 (무경고)

---

## ⚠️ 알려진 이슈 / 주의사항

### 1. 테마(다크 모드)와 Portal
- `App.tsx` line 51에서 `document.documentElement.classList.toggle('dark', isDark)`로 `<html>`에 `dark` 클래스를 적용
- `createPortal(..., document.body)`로 렌더링되는 모달들은 `<html>`의 `dark` 상속을 받으므로 정상 작동
- **주의:** 절대로 `dark` 클래스를 `<html>` 이외의 요소에 적용하지 말 것

### 2. ModalContext (전역 모달) 애니메이션
- `ModalContext.tsx`에서 `setState(null)` 호출 시 `LiquidModal`이 즉시 언마운트되어 종료 애니메이션이 스킵됨
- `LiquidModal.tsx` 내부에 자체 `AnimatePresence`가 있으나, 부모가 먼저 언마운트하므로 효과 없음
- **향후 개선:** resolve 콜백에서 `isOpen = false` → 애니메이션 완료 → `setState(null)` 순서로 변경 필요

### 3. Tailwind CSS 4 호환성
- Tailwind 4에서는 `@apply`로 커스텀 클래스를 참조할 수 없음
- `.liquid-modal`과 `.solid-modal`은 순수 CSS로 직접 정의 (`index.css` ~line 435)
- 빌드 에러 발생 시 `@apply` 사용 여부를 먼저 확인할 것

### 4. Live Notification (네이티브)
- `StudyNotificationService.java`: 포그라운드 서비스 + 크로노미터
- 타이머 로직 수정 시 `android/` 디렉토리도 함께 확인 필요
- `NativeBridge.ts`가 React ↔ Native 통신 담당

---

## 📂 핵심 파일 맵 (수정 빈도순)

| 파일 | 역할 | 최근 변경 |
|------|------|-----------|
| `src/index.css` | 디자인 시스템 (Liquid Glass, 모달, 카드) | 블러 제거, 투명도 조정 |
| `src/components/StartStudyModal.tsx` | 공부 시작 팝업 | Sibling Backdrop, input 스타일 |
| `src/components/TestTimerModal.tsx` | 테스트 타이머 팝업 | Sibling Backdrop |
| `src/components/SessionEvalModal.tsx` | 세션 평가 팝업 | Sibling Backdrop |
| `src/components/LiquidModal.tsx` | 범용 모달 (alert/confirm/prompt) | 구조 변경 없음 |
| `src/lib/ModalContext.tsx` | 전역 모달 시스템 | 변경 없음 (애니메이션 이슈 잔존) |
| `src/pages/Study.tsx` | 타이머/스톱워치 메인 | AnimatePresence 추가, Sibling Backdrop |
| `src/pages/EditRecords.tsx` | 기록 편집 | Sibling Backdrop, 중복 방지 |
| `src/pages/Records.tsx` | 기록 조회 (차트) | 일별 기본, 시:분 형식 |
| `src/App.tsx` | 라우팅, 테마 | 변경 없음 (테마는 html root) |
| `src/lib/db.ts` | DB 스키마 + 유틸리티 | 중복 방지 함수 추가 |

---

## 📍 다음 세션을 위한 가이드
1. **이 파일(`Handoff.md`)을 먼저 읽고** 프로젝트 컨텍스트를 파악
2. `PROJECT_CONTEXT_MIGRATION.md`는 이전 버전의 핸드오프 — 이 파일이 더 최신
3. 모달 수정 시 반드시 **Sibling Backdrop 패턴**을 따를 것
4. CSS 수정 시 `@apply` 사용 금지 (Tailwind 4 호환성)
5. 네이티브 기능 수정 시 `android/` + `NativeBridge.ts` 동시 확인
6. 사용자는 날짜/시간을 **한국 로컬 타임존** 기준으로 처리
7. 사용자의 기본 언어는 **한국어**이며, 모든 아티팩트와 설명은 한국어로 작성할 것
