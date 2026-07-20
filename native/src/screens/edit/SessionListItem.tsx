/**
 * SessionListItem — 하루 세션 리스트의 한 줄(편집 화면용). 과목·유형·시작~끝·시간 +
 * 삭제 버튼. 리스트용이라 memo. 정보 영역과 삭제 버튼을 형제 컴포넌트로 분리해
 * PressableScale(제스처 기반) 중첩으로 인한 탭 충돌을 피한다.
 */
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '../../components/PressableScale';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDurationHourMinute, formatTimeHHMM } from '../../data/dao';
import type { StudySession } from '../../data/schema';

type SessionListItemProps = {
  session: StudySession;
  active?: boolean;
  delay?: number;
  onPress: () => void;
  onDelete: () => void;
};

function SessionListItemBase({ session, active, delay = 0, onPress, onDelete }: SessionListItemProps) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeInDown.springify().delay(delay)}>
      <View
        style={[
          styles.row,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
            borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <PressableScale onPress={onPress} strength="soft" style={styles.info}>
          <View style={styles.topLine}>
            <Text style={[styles.subject, { color: theme.colors.text }]} numberOfLines={1}>
              {session.subject}
            </Text>
            {session.subItem ? (
              <Text style={[styles.subItem, { color: theme.colors.primary }]} numberOfLines={1}>
                › {session.subItem}
              </Text>
            ) : null}
            <View style={[styles.typeChip, { backgroundColor: theme.colors.chipBg }]}>
              <Text style={[styles.typeText, { color: theme.colors.textSecondary }]}>{session.type}</Text>
            </View>
          </View>
          <Text style={[styles.timeLine, { color: theme.colors.textSecondary }]}>
            {formatTimeHHMM(session.startTime)} ~ {formatTimeHHMM(session.endTime)} ·{' '}
            {formatDurationHourMinute(session.duration)}
          </Text>
        </PressableScale>

        <PressableScale
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDelete();
          }}
          strength="strong"
          accessibilityLabel="세션 삭제"
        >
          <View style={[styles.deleteBtn, { backgroundColor: theme.colors.chipBg }]}>
            <Text style={styles.deleteGlyph}>✕</Text>
          </View>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
  },
  info: { flex: 1, gap: 6 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subject: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  subItem: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  typeChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  typeText: { fontSize: 11, fontWeight: '700' },
  timeLine: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteGlyph: { fontSize: 15, fontWeight: '800', color: '#ef4444' },
});

export const SessionListItem = memo(SessionListItemBase);
