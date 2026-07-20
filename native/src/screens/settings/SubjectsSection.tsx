/**
 * SubjectsSection — 과목/유형 읽기 전용 리스트. 편집 UI 는 다음 단계(EditScreen)에서 지원.
 * 빈 배열이어도 안내 문구만 보이고 크래시 없음.
 */
import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel } from './SectionLabel';
import { SettingsRow } from './SettingsRow';
import type { Settings } from '../../data/schema';

function ChipList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  const theme = useTheme();
  if (items.length === 0) {
    return <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>{emptyLabel}</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      {items.map((label) => (
        <View
          key={label}
          style={[styles.chip, { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.border }]}
        >
          <Text style={[styles.chipText, { color: theme.colors.text }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SubjectsSection({ settings }: { settings: Settings }) {
  const theme = useTheme();
  const subjectNames = settings.subjects.map((s) => s.name);

  return (
    <View>
      <SectionLabel>과목 / 유형</SectionLabel>
      <GlassCard style={styles.card}>
        <SettingsRow first layout="stack">
          <Text style={[styles.label, { color: theme.colors.text }]}>과목</Text>
          <ChipList items={subjectNames} emptyLabel="등록된 과목이 없습니다." />
        </SettingsRow>
        <SettingsRow layout="stack">
          <Text style={[styles.label, { color: theme.colors.text }]}>유형</Text>
          <ChipList items={settings.types} emptyLabel="등록된 유형이 없습니다." />
        </SettingsRow>
        <Text style={[styles.note, { color: theme.colors.textSecondary }]}>
          편집은 웹 버전에서 할 수 있어요. (네이티브 편집은 다음 단계에서 지원 예정)
        </Text>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingVertical: 4 },
  label: { fontSize: 15, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  empty: { fontSize: 13, fontStyle: 'italic', opacity: 0.7 },
  note: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
});
