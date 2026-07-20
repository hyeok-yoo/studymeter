/**
 * RootTabs — 하단 5탭 내비게이션 (홈/기록/편집/Gemini/설정).
 *
 * 탭바는 반투명 크롬 느낌으로 다크/라이트 모두 대응한다(웹 .material-chrome 의도).
 * RN 에 backdrop-filter 가 없어 실제 블러는 없지만, 색/보더 토큰으로 크롬을 표현.
 * 아이콘은 1단계 스캐폴드라 이모지 자리표시자를 쓴다(벡터 아이콘 의존성 최소화).
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { HomeScreen } from '../screens/HomeScreen';
import { RecordsScreen } from '../screens/RecordsScreen';
import { EditScreen } from '../screens/EditScreen';
import { GeminiScreen } from '../screens/GeminiScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootTabParamList = {
  Home: undefined;
  Records: undefined;
  Edit: undefined;
  Gemini: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const ICONS: Record<keyof RootTabParamList, string> = {
  Home: '🏠',
  Records: '📊',
  Edit: '✏️',
  Gemini: '✨',
  Settings: '⚙️',
};

const LABELS: Record<keyof RootTabParamList, string> = {
  Home: '홈',
  Records: '기록',
  Edit: '편집',
  Gemini: 'Gemini',
  Settings: '설정',
};

export function RootTabs() {
  const theme = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarLabel: LABELS[route.name],
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: theme.colors.chromeBg,
          borderTopColor: theme.colors.glassBorder,
          borderTopWidth: 1,
        },
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.6 }}>{ICONS[route.name]}</Text>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Records" component={RecordsScreen} />
      <Tab.Screen name="Edit" component={EditScreen} />
      <Tab.Screen name="Gemini" component={GeminiScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
