/**
 * ProfileSection — 이름 표시 + 수정. blur/제출 시점에 saveSettings.
 * 이름을 비우고 저장하면 웹 기본값('사용자')으로 되돌아간다(빈 상태 방지).
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { GlassCard } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel } from './SectionLabel';
import { SettingsRow } from './SettingsRow';
import type { Settings } from '../../data/schema';

type Props = {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => Promise<Settings>;
};

export function ProfileSection({ settings, onUpdate }: Props) {
  const theme = useTheme();
  const [name, setName] = useState(settings.userName);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const finalName = name.trim() || '사용자';
    if (finalName === settings.userName) {
      if (finalName !== name) setName(finalName);
      return;
    }
    setSaving(true);
    try {
      await onUpdate({ userName: finalName });
      setName(finalName);
    } catch {
      // 저장 실패해도 화면은 그대로 두어 재시도할 수 있게 한다 (크래시 방지).
    } finally {
      setSaving(false);
    }
  };

  const initial = (name.trim().charAt(0) || '?').toUpperCase();

  return (
    <View>
      <SectionLabel>프로필</SectionLabel>
      <GlassCard style={styles.card}>
        <SettingsRow first>
          <View style={[styles.avatar, { backgroundColor: theme.colors.primary }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.colors.textSecondary }]}>이름</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={commit}
              onSubmitEditing={commit}
              placeholder="사용자"
              placeholderTextColor={theme.colors.textSecondary}
              editable={!saving}
              returnKeyType="done"
              style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
            />
          </View>
        </SettingsRow>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingVertical: 4 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 브랜드색(primary)은 라이트/다크 공통이라 흰 텍스트로 항상 대비가 보장된다.
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  field: { flex: 1, alignItems: 'flex-end', gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  input: {
    width: '100%',
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
