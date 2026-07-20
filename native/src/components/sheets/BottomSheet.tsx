/**
 * BottomSheet — 간단 바텀시트.
 *
 * Modal(transparent) + Reanimated 슬라이드업(스프링, theme/motion.ts 의 spring.sheet)
 * 으로 구현한다. 스크림(배경) 탭으로 닫히고, 상단 드래그 핸들을 아래로 끌어도 닫힌다
 * (핸들 영역에만 제스처를 걸어 내부 ScrollView 스크롤과 충돌하지 않게 한다).
 * 안전영역은 useSafeAreaInsets 로 하단 패딩에 반영.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { spring } from '../../theme/motion';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DRAG_CLOSE_THRESHOLD = 120;
const DRAG_VELOCITY_THRESHOLD = 800;

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children?: ReactNode;
};

export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const scrimOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withSpring(0, spring.sheet);
      scrimOpacity.value = withSpring(1, spring.default);
    } else if (mounted) {
      translateY.value = withSpring(SCREEN_HEIGHT, spring.sheet, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
      scrimOpacity.value = withSpring(0, spring.default);
    }
    // mounted 는 애니메이션 완료 콜백으로만 갱신 — 의존성에 넣으면 재실행 루프.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const closeNow = () => {
    onClose();
  };

  const dragHandle = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const shouldClose = e.translationY > DRAG_CLOSE_THRESHOLD || e.velocityY > DRAG_VELOCITY_THRESHOLD;
      if (shouldClose) {
        translateY.value = withSpring(SCREEN_HEIGHT, spring.sheet, (finished) => {
          if (finished) {
            runOnJS(setMounted)(false);
            runOnJS(closeNow)();
          }
        });
      } else {
        translateY.value = withSpring(0, spring.sheet);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={closeNow} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { backgroundColor: theme.colors.scrim }, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeNow} accessibilityLabel="닫기" />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.glassBorder,
              paddingBottom: Math.max(insets.bottom, 16),
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={dragHandle}>
            <View style={styles.handleArea}>
              <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    // 웹 --glass-shadow 근사
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  handleArea: { paddingVertical: 10, alignItems: 'center' },
  handle: { width: 36, height: 5, borderRadius: 3 },
});
