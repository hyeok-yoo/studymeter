import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { initializeSettings, type Settings, db } from './lib/db'
import Layout from './components/Layout'
import { NativeBridge } from './lib/NativeBridge'
const NameRegistrationModal = lazy(() => import('./components/NameRegistrationModal'))
const MorningReportPopup = lazy(() => import('./components/MorningReportPopup'))

// telemetry (Firebase) 모듈은 앱 렌더링을 막지 않도록 동적으로 로드
const telemetryPromise = import('./lib/telemetry')

// localStorage 접근만으로 판단하는 순수 함수 — Firebase 없이 동기로 확인
function isRegisteredSync() {
  return !!localStorage.getItem('studymeter_telemetry_name')
}

const Home = lazy(() => import('./pages/Home'))
const Study = lazy(() => import('./pages/Study'))
const Records = lazy(() => import('./pages/Records'))
const GeminiChat = lazy(() => import('./pages/GeminiChat'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const EditRecords = lazy(() => import('./pages/EditRecords'))
const DeveloperPage = lazy(() => import('./pages/Developer'))
const AdminPage = lazy(() => import('./pages/Admin'))

function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [showNameModal, setShowNameModal] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const didInitRef = useRef(false)

  // 진행 중인 세션(실행/일시정지)이 있으면 공부 화면으로 자동 이동.
  // 네비게이션마다 확인해 세션 중에는 공부 화면에 머무르게 한다.
  useEffect(() => {
    if (localStorage.getItem('studymeter_active_session') && location.pathname !== '/study') {
      navigate('/study', { replace: true });
    }
  }, [location.pathname, navigate]);

  // 초기 설정 로드 + 텔레메트리 (앱 시작 시 1회만 실행)
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    initializeSettings().then(async (s) => {
      setSettings(s);
      // 로컬 DB 읽기 완료 즉시 로딩 해제 → Firebase 네트워크 대기 없이 UI 진입
      setLoading(false);

      // 이하 Firebase/텔레메트리는 백그라운드에서 처리 (UI 블로킹 없음)
      let tel: Awaited<typeof telemetryPromise>
      try {
        tel = await telemetryPromise
        await tel.ensureSignedIn();
      } catch {
        // Firebase 미설정 / 오프라인 → 로컬 전용 동작, 조용히 종료
        return;
      }

      if (location.pathname === '/admin') return;

      if (!isRegisteredSync()) {
        setShowNameModal(true);
      } else {
        const blocked = await tel.checkBlocked();
        if (blocked) {
          setIsBlocked(true);
        } else {
          tel.updateLastSeen();
          tel.maybeSyncToday();
        }
      }
    });
    // 마운트 시 1회만 실행 (location.pathname 은 최초 값만 사용)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 등록 완료 후 settings.userName 동기화 + 차단 확인
  async function handleRegistrationDone(name: string) {
    setShowNameModal(false);
    if (settings) {
      await db.settings.update(settings.id!, { userName: name });
      setSettings({ ...settings, userName: name });
    }
    const tel = await telemetryPromise
    const blocked = await tel.checkBlocked();
    if (blocked) {
      setIsBlocked(true);
    } else {
      tel.updateLastSeen();
      tel.maybeSyncToday();
    }
  }

  // 5분마다 차단 상태 폴링
  useEffect(() => {
    if (loading || showNameModal || location.pathname === '/admin') return;
    const interval = setInterval(async () => {
      const tel = await telemetryPromise
      const blocked = await tel.checkBlocked();
      if (blocked) setIsBlocked(true);
      else tel.updateLastSeen();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loading, showNameModal, location.pathname]);

  useEffect(() => {
    if (!settings) return;

    // 테마 적용 함수
    const applyTheme = (themeMode: 'light' | 'dark' | 'system') => {
      const isDark = themeMode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : themeMode === 'dark';

      document.documentElement.classList.toggle('dark', isDark);

      // 네이티브 성태바 색상 동기화
      const bgColor = isDark ? '#000000' : '#f8fafc';
      NativeBridge.setStatusBarColor(bgColor, !isDark);
    };

    applyTheme(settings.theme);

    // 시스템 테마 변경 감지 리스너
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (settings?.theme === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [settings?.theme]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="animate-pulse">
          <span className="gradient-text text-2xl font-bold">StudyMeter</span>
        </div>
      </div>
    )
  }

  if (isBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]">
        <div className="text-center p-8">
          <div className="text-6xl mb-6">🚫</div>
          <h1 className="text-3xl font-black text-red-400 mb-3">접근이 차단되었습니다</h1>
          <p className="text-[var(--color-text-secondary)] opacity-70">관리자에게 문의해주세요.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Suspense fallback={null}>
        {showNameModal && <NameRegistrationModal onDone={handleRegistrationDone} />}
      </Suspense>

      {/* 그날 첫 아침 브리핑 준비 완료 시 전역 팝업 (공부 화면 포함 어디서든 1회) */}
      <Suspense fallback={null}>
        {settings && <MorningReportPopup settings={settings} />}
      </Suspense>

      <Suspense fallback={null}>
        <Routes>
          {/* 관리자 페이지 */}
          <Route path="/admin" element={<AdminPage />} />

          {/* 타이머 화면은 레이아웃 없이 전체화면 */}
          <Route path="/study" element={<Study settings={settings!} />} />

          {/* 나머지 화면은 사이드바 레이아웃 */}
          <Route path="/" element={<Layout settings={settings!} onSettingsChange={setSettings} />}>
            <Route index element={<Home settings={settings!} />} />
            <Route path="records" element={<Records />} />
            <Route path="edit-records" element={<EditRecords settings={settings!} />} />
            <Route path="gemini" element={<GeminiChat settings={settings!} />} />
            <Route path="settings" element={<SettingsPage settings={settings!} onSettingsChange={setSettings} />} />
            <Route path="developer" element={<DeveloperPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App
