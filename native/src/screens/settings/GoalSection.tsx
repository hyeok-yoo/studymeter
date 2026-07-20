/**
 * GoalSection — 하루 목표 공부 시간 표시 + 시간/분 수정.
 * 둘 다 비우면(0) dailyGoalMs 를 undefined 로 저장해 진척 바를 비활성화한다(웹과 동일 의미).
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { GlassCard } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel } from './SectionLabel';
import { SettingsRow } from './SettingsRow';
import type { Settings } from '../../data/schema';

type Props = {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => Promise<Settings>;
};

function msToHm(ms: number | undefined): { hours: string; minutes: string } {
  if (!ms || ms <= 0) return { hours: '', minutes: '' };
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return {
    hours: hours > 0 ? String(hours) : '',
    minutes: minutes > 0 ? String(minutes) : '',
  };
}

function clampInt(raw: string, min: number, max: number): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

export function GoalSection({ settings, onUpdate }: Props) {
  const theme = useTheme();
  const initial = msToHm(settings.dailyGoalMs);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const h = hours.trim() ? clampInt(hours, 0, 24) : 0;
    const m = minutes.trim() ? clampInt(minutes, 0, 59) : 0;
    const totalMs = h * 3600000 + m * 60000;
    const nextGoal = totalMs > 0 ? totalMs : undefined;
    if (nextGoal === settings.dailyGoalMs) return;
    setSaving(true);
    try {
      await onUpdate({ dailyGoalMs: nextGoal });
    } catch {
      // 저장 실패해도 입력값은 유지 — 다시 blur 하면 재시도된다.
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <SectionLabel>학습 목표</SectionLabel>
      <GlassCard style={styles.card}>
        <SettingsRow first layout="stack">
          <Text style={[styles.label, { color: theme.colors.text }]}>하루 목표 시간</Text>
          <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
            공부 화면에 목표 대비 진행률이 표시됩니다. 비워두면 비활성화됩니다.
          </Text>
          <View style={styles.inputsRow}>
            <TextInput
              value={hours}
              onChangeText={setHours}
              onBlur={commit}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.colors.textSecondary}
              editable={!saving}
              maxLength={2}
              style={[styles.numberInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
            />
            <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>시간</Text>
            <TextInput
              value={minutes}
              onChangeText={setMinutes}
              onBlur={commit}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={theme.colors.textSecondary}
              editable={!saving}
              maxLength={2}
              style={[styles.numberInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
            />
            <Text style={[styles.unit, { color: theme.colors.textSecondary }]}>분</Text>
          </View>
        </SettingsRow>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingVertical: 4 },
  label: { fontSize: 15, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17 },
  inputsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  numberInput: {
    width: 56,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  unit: { fontSize: 13, fontWeight: '600' },
});
