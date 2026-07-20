/**
 * MorningReportCard — 아침 브리핑/주간 리뷰 카드. 웹 홈의 아침 리포트 블록을 RN 으로 이식.
 *
 * 동작: 캐시 우선 생성(generateMorningReport 이 kind+date 캐시를 먼저 본다) → 스켈레톤 →
 * 마크다운 렌더 → '다시 생성' 버튼(regenerateMorningReport). 생성 불가(키 없음/쿼터/오프라인)
 * 이면 null 을 렌더해 카드를 숨긴다.
 *
 * 홈 배치(레이아웃 삽입)는 통합 단계에서 한다 — 여기서는 자립적으로 동작하는 컴포넌트만.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard, PressableScale } from './index';
import { useTheme } from '../theme/ThemeProvider';
import { getSettings, getTodayDate } from '../data/dao';
import type { Settings } from '../data/schema';
import {
  generateMorningReport,
  morningReportKindFor,
  regenerateMorningReport,
} from '../ai';
import { AiMarkdown } from '../screens/gemini/AiMarkdown';

type MorningReportCardProps = {
  /** 외부에서 설정을 주입하면 그것을 쓰고, 없으면 내부에서 dao.getSettings() 로 로드. */
  settings?: Settings;
};

export function MorningReportCard({ settings: settingsProp }: MorningReportCardProps) {
  const theme = useTheme();
  const c = theme.colors;

  const [settings, setSettings] = useState<Settings | undefined>(settingsProp);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // 설정 로드 (주입 없을 때).
  useEffect(() => {
    if (settingsProp) { setSettings(settingsProp); return; }
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (!cancelled) setSettings(s);
      } catch {
        if (!cancelled) setSettings(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [settingsProp]);

  // 설정이 준비되면 캐시 우선 생성.
  useEffect(() => {
    if (settings === undefined) return; // 아직 로딩 중
    let cancelled = false;
    setLoading(true);
    (async () => {
      let result: string | null = null;
      if (settings) {
        try {
          result = await generateMorningReport(settings);
        } catch {
          result = null;
        }
      }
      if (cancelled || !mounted.current) return;
      setContent(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [settings]);

  const onRegenerate = useCallback(async () => {
    if (!settings || regenerating) return;
    setRegenerating(true);
    try {
      const fresh = await regenerateMorningReport(settings);
      if (mounted.current && fresh) setContent(fresh);
    } catch {
      /* 실패 시 기존 내용 유지 */
    } finally {
      if (mounted.current) setRegenerating(false);
    }
  }, [settings, regenerating]);

  // 생성 불가(키 없음/쿼터/오프라인) & 스켈레톤도 끝난 상태 → 카드 숨김.
  if (!loading && !content) return null;

  const title = settings && morningReportKindFor(getTodayDate()) === 'weekly-report'
    ? '주간 리뷰'
    : '아침 브리핑';

  return (
    <GlassCard>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="sunny-outline" size={18} color={c.primary} />
          <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        </View>
        {content ? (
          <PressableScale onPress={onRegenerate} strength="soft" disabled={regenerating} accessibilityLabel="다시 생성">
            <View style={[styles.regenBtn, { backgroundColor: c.chipBg, borderColor: c.border }]}>
              <Ionicons name="refresh" size={13} color={c.textSecondary} />
              <Text style={[styles.regenText, { color: c.textSecondary }]}>
                {regenerating ? '생성 중…' : '다시 생성'}
              </Text>
            </View>
          </PressableScale>
        ) : null}
      </View>

      {loading || regenerating ? (
        <View style={styles.skeleton}>
          <View style={[styles.skelLine, { backgroundColor: c.chipBg, width: '92%' }]} />
          <View style={[styles.skelLine, { backgroundColor: c.chipBg, width: '78%' }]} />
          <View style={[styles.skelLine, { backgroundColor: c.chipBg, width: '85%' }]} />
          <View style={[styles.skelLine, { backgroundColor: c.chipBg, width: '60%' }]} />
        </View>
      ) : content ? (
        <View style={styles.body}>
          <AiMarkdown fontSize={14}>{content}</AiMarkdown>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '800' },
  regenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  regenText: { fontSize: 12, fontWeight: '700' },
  body: { marginTop: 2 },
  skeleton: { gap: 8, paddingVertical: 4 },
  skelLine: { height: 12, borderRadius: 6 },
});
