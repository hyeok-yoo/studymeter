/**
 * App.tsx — 루트. 프로바이더 스택을 구성한다:
 *   GestureHandlerRootView → SafeAreaProvider → ThemeProvider → NavigationContainer
 *
 * gesture-handler 는 반드시 앱 최상단을 GestureHandlerRootView 로 감싸야 제스처가
 * 동작한다. StatusBar 는 테마에 맞춰 자동(밝기 반전).
 */
import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import {
  DarkTheme as NavDarkTheme,
  DefaultTheme as NavLightTheme,
  NavigationContainer,
  type Theme as NavTheme,
} from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { RootTabs } from './src/navigation/RootTabs';
import { StudyScreen } from './src/screens/StudyScreen';
import type { RootStackParamList } from './src/screens/study/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * 루트 스택 — 하단 탭 전체(Tabs) 위에 몰입형 Study 타이머 화면을 올린다.
 * Study 는 아래에서 떠오르고, 스와이프 백을 막아(gestureEnabled: false) 실수 종료를
 * 방지한다(하드웨어 back 은 StudyScreen 의 usePreventRemove 가 확인 후 처리).
 */
function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={RootTabs} />
      <Stack.Screen
        name="Study"
        component={StudyScreen}
        options={{ animation: 'fade_from_bottom', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}

function ThemedNavigation() {
  const theme = useTheme();

  const base = theme.dark ? NavDarkTheme : NavLightTheme;
  const navTheme: NavTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.colors.primary,
      background: theme.colors.bg,
      card: theme.colors.chromeBg,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedNavigation />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
