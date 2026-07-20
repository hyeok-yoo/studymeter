/**
 * AboutSection — 앱 버전(app.json expo.version) + "네이티브 베타" 배지.
 * package.json 변경 없이 expo-constants 대신 app.json 을 JSON 모듈로 직접 import 한다
 * (tsconfig 가 expo/tsconfig.base 를 extends 하여 resolveJsonModule 이 이미 켜져 있음).
 */
import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel } from './SectionLabel';
import { SettingsRow } from './SettingsRow';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import appConfig from '../../../app.json';

const APP_VERSION: string = (appConfig as { expo?: { version?: string } }).expo?.version ?? '1.0.0';

export function AboutSection() {
  const theme = useTheme();

  return (
    <View>
      <SectionLabel>정보</SectionLabel>
      <GlassCard style={styles.card}>
        <SettingsRow first>
          <Text style={[styles.label, { color: theme.colors.text }]}>앱 버전</Text>
          <View style={styles.right}>
            <Text style={[styles.value, { color: theme.colors.textSecondary }]}>{APP_VERSION}</Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: `${theme.colors.primary}22`, borderColor: theme.colors.primary },
              ]}
            >
              <Text style={[styles.badgeText, { color: theme.colors.primary }]}>네이티브 베타</Text>
            </View>
          </View>
        </SettingsRow>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingVertical: 4 },
  label: { fontSize: 15, fontWeight: '700' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { fontSize: 14, fontWeight: '600' },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
});
