/**
 * useSettingsData — 설정 화면 전용 로드/저장 훅.
 *
 * dao.getSettings() 로 조회하고, 저장된 값이 없으면(최초 실행) 웹 기본값 구조로
 * 초기 생성해 즉시 saveSettings 한다. update() 는 부분 patch 를 병합해 즉시
 * saveSettings 하고 최신 Settings 를 반환한다 — ref 로 최신 값을 들고 있어
 * 연속 patch 호출 시에도 stale closure 문제가 없다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSettings, saveSettings } from '../../data/dao';
import type { Settings } from '../../data/schema';
import { DEFAULT_SETTINGS } from './defaultSettings';

export interface UseSettingsData {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  update: (patch: Partial<Settings>) => Promise<Settings>;
  reload: () => Promise<void>;
}

export function useSettingsData(): UseSettingsData {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await getSettings();
      if (existing) {
        settingsRef.current = existing;
        setSettings(existing);
      } else {
        const initial: Settings = { ...DEFAULT_SETTINGS };
        await saveSettings(initial);
        settingsRef.current = initial;
        setSettings(initial);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '설정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(async (patch: Partial<Settings>): Promise<Settings> => {
    const base = settingsRef.current ?? DEFAULT_SETTINGS;
    const next: Settings = { ...base, ...patch };
    await saveSettings(next);
    settingsRef.current = next;
    setSettings(next);
    return next;
  }, []);

  return { settings, loading, error, update, reload: load };
}
