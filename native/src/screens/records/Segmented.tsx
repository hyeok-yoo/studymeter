/**
 * Segmented — 선택 배경이 스프링으로 미끄러지는 세그먼트 컨트롤 (Reanimated).
 *
 * 웹 Records.tsx 의 `layoutId` 세그먼트 인디케이터를 RN 으로 옮긴다:
 * 활성 배경 pill 하나가 translateX 스프링으로 이동한다(transform 만 사용).
 * 세그먼트는 균등 폭. 컨테이너 폭을 onLayout 으로 재서 한 칸 폭을 구한다.
 * 색은 전부 useTheme() 토큰.
 */
import { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { spring } from '../../theme/motion';

const PAD = 4;

type SegmentedProps<T extends string> = {
  segments: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
};

export function Segmented<T extends string>({ segments, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = segments.findIndex((s) => s.key === value);
  const segWidth = trackWidth > 0 ? (trackWidth - PAD * 2) / segments.length : 0;

  const pos = useSharedValue(index);
  useEffect(() => {
    pos.value = withSpring(index < 0 ? 0 : index, spring.default);
  }, [index, pos]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: segWidth,
    transform: [{ translateX: pos.value * segWidth }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.track,
        {
          backgroundColor: theme.colors.chipBg,
          borderColor: theme.colors.glassBorder,
          borderTopColor: theme.colors.glassHighlight,
        },
      ]}
    >
      {segWidth > 0 ? (
        <Animated.View
          style={[styles.indicator, { backgroundColor: theme.colors.primary }, indicatorStyle]}
        />
      ) : null}
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            style={styles.segment}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.label,
                { color: active ? '#ffffff' : theme.colors.textSecondary },
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: PAD,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
    borderRadius: 12,
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '700' },
});
