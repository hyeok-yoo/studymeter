/**
 * PressableScale — 눌리는 "순간" 즉시 스케일이 줄어드는 촉각적 버튼.
 *
 * 웹 press/pressStrong (whileTap scale 0.97/0.95 + snappy 스프링)의 RN 직역.
 * Gesture Handler 의 Tap 제스처로 pointer-down 을 즉시 감지하고, Reanimated
 * withSpring 으로 스케일을 애니메이션한다. 스프링은 현재 값에서 시작하므로
 * 연타/중단에도 자연스럽다(interruptible).
 */
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { pressScale, spring } from '../theme/motion';

type PressableScaleProps = {
  children?: ReactNode;
  onPress?: () => void;
  /** 눌림 강도 — 기본 soft(0.97), strong(0.95). */
  strength?: 'soft' | 'strong';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function PressableScale({
  children,
  onPress,
  strength = 'soft',
  disabled = false,
  style,
  accessibilityLabel,
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const target = strength === 'strong' ? pressScale.strong : pressScale.soft;

  const tap = Gesture.Tap()
    .enabled(!disabled)
    // 손가락을 오래 눌러도 취소되지 않도록 넉넉히
    .maxDuration(10_000)
    .onBegin(() => {
      scale.value = withSpring(target, spring.snappy);
    })
    .onEnd(() => {
      if (onPress) runOnJS(onPress)();
    })
    .onFinalize(() => {
      scale.value = withSpring(1, spring.snappy);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.5 : 1,
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={[styles.base, animatedStyle, style]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: {
    // 터치 대상은 스스로 레이아웃; 스케일 원점은 중앙(RN 기본).
  },
});
