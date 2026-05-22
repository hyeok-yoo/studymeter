import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { initializeSettings, type Settings } from './lib/db'
import Layout from './components/Layout'
import Home from './pages/Home'
import Study from './pages/Study'
import Records from './pages/Records'
import GeminiChat from './pages/GeminiChat'
import SettingsPage from './pages/Settings'
import EditRecords from './pages/EditRecords'
import { NativeBridge } from './lib/NativeBridge'

function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // 1. 초기 설정 로드 (한 번만 실행)
    initializeSettings().then((s) => {
      setSettings(s);

      // 진행 중인 세션 확인 후 자동 리다이렉트
      const saved = localStorage.getItem('studymeter_active_session');
      if (saved) {
        // Redirect if there is an active session (running or paused) AND we are not already on the study page
        if (location.pathname !== '/study') {
          navigate('/study', { replace: true });
        }
      }

      setLoading(false);
    });
  }, [location.pathname, navigate]); // Add location.pathname and navigate to dependencies to ensure correct behavior

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

  return (
    <Routes>
      {/* 타이머 화면은 레이아웃 없이 전체화면 */}
      <Route path="/study" element={<Study settings={settings!} />} />

      {/* 나머지 화면은 사이드바 레이아웃 */}
      <Route path="/" element={<Layout settings={settings!} onSettingsChange={setSettings} />}>
        <Route index element={<Home settings={settings!} />} />
        <Route path="records" element={<Records />} />
        <Route path="edit-records" element={<EditRecords settings={settings!} />} />
        <Route path="gemini" element={<GeminiChat settings={settings!} />} />
        <Route path="settings" element={<SettingsPage settings={settings!} onSettingsChange={setSettings} />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
