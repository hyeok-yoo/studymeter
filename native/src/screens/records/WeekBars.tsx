/**
 * WeekBars — 최근 7일 막대 그래프. 차트 라이브러리 없이 View 높이로 직접 구현.
 *
 * 각 막대는 마운트 시 높이 0 → 목표로 스프링 등장(scaleY 아님 — 높이 애니메이션은
 * transform 이 아니므로, 대신 컨테이너 고정 높이 안에서 translateY + 고정 높이 막대의
 * scaleY 로 표현해 transform/opacity 규칙을 지킨다).
 * 색은 전부 useTheme() 토큰. 총합(진한 primary) 위에 순공(accent)을 겹쳐 표시.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { spring } from '../../theme/motion';
import { formatDurationHourMinute } from '../../data/dao';

export type WeekBarDatum = {
  date: string;
  label: string; // 요일/일 라벨
  totalMs: number;
  selfMs: number;
  isToday: boolean;
};

const TRACK_HEIGHT = 160;

type BarProps = {
  datum: WeekBarDatum;
  maxMs: number;
};

function Bar({ datum, maxMs }: BarProps) {
  const theme = useTheme();
  const grow = useSharedValue(0);

  const totalRatio = maxMs > 0 ? datum.totalMs / maxMs : 0;
  const selfRatio = maxMs > 0 ? datum.selfMs / maxMs : 0;
  // 값이 있으면 최소 높이를 보장(2px)하여 "존재"가 보이게.
  const totalH = datum.totalMs > 0 ? Math.max(TRACK_HEIGHT * totalRatio, 6) : 0;
  const selfH = datum.selfMs > 0 ? Math.max(TRACK_HEIGHT * selfRatio, 4) : 0;

  useEffect(() => {
    grow.value = withSpring(1, spring.momentum);
  }, [grow, totalH]);

  // scaleY 를 바닥 기준으로 키운다(등장은 transform 만).
  const totalStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: grow.value }],
  }));

  return (
    <View style={styles.barCol}>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.bar,
            { height: totalH, backgroundColor: theme.colors.primary },
            totalStyle,
          ]}
        >
          {selfH > 0 ? (
            <View
              style={[
                styles.selfBar,
                { height: selfH, backgroundColor: theme.colors.accent },
              ]}
            />
          ) : null}
        </Animated.View>
      </View>
      <Text
        style={[
          styles.dayLabel,
          { color: datum.isToday ? theme.colors.primary : theme.colors.textSecondary },
          datum.isToday && styles.dayLabelToday,
        ]}
      >
        {datum.label}
      </Text>
      <Text style={[styles.valueLabel, { color: theme.colors.textSecondary }]}>
        {datum.totalMs > 0 ? formatDurationHourMinute(datum.totalMs) : '-'}
      </Text>
    </View>
  );
}

type WeekBarsProps = {
  data: WeekBarDatum[];
};

export function WeekBars({ data }: WeekBarsProps) {
  const theme = useTheme();
  const maxMs = data.reduce((m, d) => Math.max(m, d.totalMs), 0);
  const hasAny = maxMs > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.chart}>
        {data.map((d) => (
          <Bar key={d.date} datum={d} maxMs={maxMs} />
        ))}
      </View>
      {!hasAny ? (
        <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
          최근 7일 기록이 없어요. 공부를 시작해 보세요!
        </Text>
      ) : (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
            <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>총합</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: theme.colors.accent }]} />
            <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
              순공 (자습+테스트)
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: TRACK_HEIGHT + 44,
  },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  track: { height: TRACK_HEIGHT, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: {
    width: '58%',
    borderRadius: 8,
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
    transformOrigin: 'bottom', // scaleY 등장이 바닥 기준으로 자라도록
  },
  selfBar: { width: '100%', borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  dayLabel: { fontSize: 12, fontWeight: '700' },
  dayLabelToday: { fontWeight: '800' },
  valueLabel: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { fontSize: 13, fontWeight: '500', fontStyle: 'italic', textAlign: 'center' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12, fontWeight: '600' },
});
