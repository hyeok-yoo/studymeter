/**
 * TestTimerSheet — 테스트(카운트다운) 유형 선택 시 분 단위 시간 입력 시트.
 *
 * 웹 TestTimerModal 포팅: 과목/시간 프리셋 + 직접 입력. 확정 시 minutes 를 콜백한다.
 */
import { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { PressableScale } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';

type Preset = { label: string; minutes: number; kind?: 'subject' };

const PRESETS: Preset[] = [
  { label: '국어', minutes: 80, kind: 'subject' },
  { label: '수학', minutes: 100, kind: 'subject' },
  { label: '영어', minutes: 70, kind: 'subject' },
  { label: '30분', minutes: 30 },
  { label: '40분', minutes: 40 },
  { label: '50분', minutes: 50 },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (minutes: number) => void;
};

export function TestTimerSheet({ visible, onClose, onConfirm }: Props) {
  const theme = useTheme();
  const [custom, setCustom] = useState('');
  const sheetBg = theme.dark ? '#0d1526' : '#ffffff';

  const handleCustom = () => {
    const mins = parseInt(custom, 10);
    if (!isNaN(mins) && mins > 0) {
      onConfirm(mins);
      setCustom('');
    }
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
          <Text style={[styles.title, { color: theme.colors.text }]}>테스트 타이머 설정</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            테스트 시간을 지정해 주세요.
          </Text>

          <View style={styles.grid}>
            {PRESETS.map((p) => (
              <PressableScale
                key={p.label}
                strength="strong"
                onPress={() => onConfirm(p.minutes)}
                style={[
                  styles.presetCell,
                  { backgroundColor: theme.colors.chipBg, borderColor: theme.colors.glassBorder },
                ]}
              >
                <Text style={[styles.presetKind, { color: theme.colors.textSecondary }]}>
                  {p.kind === 'subject' ? '과목' : '시간'}
                </Text>
                <Text style={[styles.presetLabel, { color: theme.colors.text }]}>{p.label}</Text>
                {p.kind === 'subject' ? (
                  <Text style={[styles.presetSub, { color: theme.colors.textSecondary }]}>
                    {p.minutes}분
                  </Text>
                ) : null}
              </PressableScale>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
            직접 입력 (분)
          </Text>
          <View style={styles.customRow}>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              keyboardType="number-pad"
              placeholder="분 단위 입력"
              placeholderTextColor={theme.colors.textSecondary}
              style={[
                styles.input,
                {
                  color: theme.colors.text,
                  backgroundColor: theme.colors.chipBg,
                  borderColor: theme.colors.glassBorder,
                },
              ]}
            />
            <PressableScale
              strength="strong"
              onPress={handleCustom}
              disabled={!custom || parseInt(custom, 10) <= 0}
              style={[styles.setBtn, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={styles.setBtnText}>설정</Text>
            </PressableScale>
          </View>

          <PressableScale onPress={onClose} style={styles.cancel}>
            <Text style={[styles.cancelText, { color: theme.colors.textSecondary }]}>취소</Text>
          </PressableScale>
        </Animated.View>
      </View>
    </Modal>
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
    paddingBottom: 36,
    gap: 8,
  },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  presetCell: {
    width: '31.5%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  presetKind: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  presetLabel: { fontSize: 15, fontWeight: '700' },
  presetSub: { fontSize: 11, fontWeight: '600' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  customRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    fontWeight: '700',
  },
  setBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  setBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText: { fontSize: 13, fontWeight: '700' },
});
