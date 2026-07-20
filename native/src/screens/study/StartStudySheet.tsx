/**
 * StartStudySheet — 공부 시작 선택 시트(과목 + 세부항목 + 유형).
 *
 * 웹 StartStudyModal 포팅. 열릴 때 dao.getSettings() 로 과목/유형을 읽는다.
 * '테스트' 유형이면 TestTimerSheet 로 분 단위 카운트다운을 받은 뒤 확정한다.
 * 확정 시 onConfirm(StudyParams) 로 상위(HomeScreen)에 넘겨 Study 화면을 띄운다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { PressableScale } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { getSettings } from '../../data/dao';
import type { SubjectItem } from '../../data/schema';
import { DEFAULT_SETTINGS } from '../settings/defaultSettings';
import { TestTimerSheet } from './TestTimerSheet';
import type { StudyParams } from './types';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (params: StudyParams) => void;
};

export function StartStudySheet({ visible, onClose, onConfirm }: Props) {
  const theme = useTheme();
  const [subjects, setSubjects] = useState<SubjectItem[]>(DEFAULT_SETTINGS.subjects);
  const [types, setTypes] = useState<string[]>(DEFAULT_SETTINGS.types);
  const [subject, setSubject] = useState<string>(DEFAULT_SETTINGS.subjects[0]?.name ?? '');
  const [subItem, setSubItem] = useState<string | undefined>(undefined);
  const [type, setType] = useState<string>(DEFAULT_SETTINGS.types[0] ?? '');
  const [showTestTimer, setShowTestTimer] = useState(false);

  const sheetBg = theme.dark ? '#0d1526' : '#ffffff';

  // 열릴 때 설정 로드.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const s = await getSettings();
      if (cancelled) return;
      const subs = s?.subjects?.length ? s.subjects : DEFAULT_SETTINGS.subjects;
      const tps = s?.types?.length ? s.types : DEFAULT_SETTINGS.types;
      setSubjects(subs);
      setTypes(tps);
      setSubject(subs[0]?.name ?? '');
      setSubItem(undefined);
      setType(tps[0] ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const currentSubjectData = useMemo(
    () => subjects.find((s) => s.name === subject),
    [subjects, subject]
  );
  const children = currentSubjectData?.children ?? [];

  const confirm = () => {
    if (type === '테스트') {
      setShowTestTimer(true);
      return;
    }
    onConfirm({ subject, subItem, type });
  };

  const onTestConfirm = (minutes: number) => {
    setShowTestTimer(false);
    onConfirm({ subject, subItem, type: '테스트', countdownMs: minutes * 60 * 1000 });
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={FadeIn.duration(200)}
        style={[styles.backdrop, { backgroundColor: theme.colors.scrim }]}
      >
        <PressableScale style={styles.backdropPress} onPress={onClose} accessibilityLabel="닫기" />
      </Animated.View>

      <View style={styles.sheetWrap} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          style={[styles.sheet, { backgroundColor: sheetBg, borderColor: theme.colors.border }]}
        >
          <Text style={[styles.title, { color: theme.colors.text }]}>공부를 시작해볼까요?</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            오늘도 한 걸음씩 나아가 봐요.
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* 과목 */}
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              어떤 과목을 공부할까요?
            </Text>
            <View style={styles.chipRow}>
              {subjects.map((s) => {
                const active = s.name === subject;
                return (
                  <PressableScale
                    key={s.name}
                    strength="strong"
                    onPress={() => {
                      setSubject(s.name);
                      setSubItem(undefined);
                    }}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: theme.colors.primary }
                        : { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder, borderWidth: StyleSheet.hairlineWidth },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? '#fff' : theme.colors.text }]}>
                      {s.name}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>

            {/* 세부 항목 */}
            {children.length > 0 ? (
              <View
                style={[
                  styles.subItemBox,
                  { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder },
                ]}
              >
                <Text style={[styles.subItemLabel, { color: theme.colors.secondary }]}>
                  세부 항목 (선택)
                </Text>
                <View style={styles.chipRow}>
                  <SubItemChip
                    label="전체"
                    active={!subItem}
                    onPress={() => setSubItem(undefined)}
                  />
                  {children.map((c) => (
                    <SubItemChip
                      key={c}
                      label={c}
                      active={subItem === c}
                      onPress={() => setSubItem(c)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {/* 유형 */}
            <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
              공부 유형은?
            </Text>
            <View style={styles.chipRow}>
              {types.map((t) => {
                const active = t === type;
                return (
                  <PressableScale
                    key={t}
                    strength="strong"
                    onPress={() => setType(t)}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: theme.colors.secondary }
                        : { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder, borderWidth: StyleSheet.hairlineWidth },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? '#fff' : theme.colors.text }]}>
                      {t}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </ScrollView>

          {/* 액션 */}
          <View style={styles.actions}>
            <PressableScale
              onPress={onClose}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder, borderWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <Text style={[styles.actionText, { color: theme.colors.text }]}>취소</Text>
            </PressableScale>
            <PressableScale
              strength="strong"
              onPress={confirm}
              style={[styles.actionBtn, styles.actionPrimary, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={[styles.actionText, { color: '#fff' }]}>시작하기!</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </View>

      <TestTimerSheet
        visible={showTestTimer}
        onClose={() => setShowTestTimer(false)}
        onConfirm={onTestConfirm}
      />
    </Modal>
  );
}

function SubItemChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      strength="strong"
      onPress={onPress}
      style={[
        styles.subChip,
        active
          ? { backgroundColor: theme.colors.secondary }
          : { backgroundColor: theme.colors.glassBg, borderColor: theme.colors.glassBorder, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Text style={[styles.subChipText, { color: active ? '#fff' : theme.colors.textSecondary }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backdropPress: { flex: 1 },
  sheetWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    paddingBottom: 32,
    maxHeight: '86%',
    gap: 4,
  },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  scroll: { flexGrow: 0 },
  scrollContent: { gap: 10, paddingBottom: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14 },
  chipText: { fontSize: 14, fontWeight: '700' },
  subItemBox: {
    padding: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginTop: 4,
  },
  subItemLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  subChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12 },
  subChipText: { fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  actionBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { flex: 1.4 },
  actionText: { fontSize: 15, fontWeight: '800' },
});
