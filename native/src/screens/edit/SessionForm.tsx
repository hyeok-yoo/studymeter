/**
 * SessionForm — 수동 세션 추가/수정 폼. 웹 EditRecords.tsx 의 "공부 기록 추가" 섹션 미러.
 *
 * 과목/유형(하위 항목 있으면 함께) 칩 선택 + 시작~끝 시각 입력(HH/MM 숫자 필드) →
 * duration 자동 계산. 겹치는 세션이 있으면 Alert 로 확인 후 기존 세션 종료 시각을
 * 당기고 저장한다(웹의 겹침 경고 모달을 네이티브 Alert 로 단순화).
 *
 * 새 세션은 dao.saveSession(기존 dao 함수, 읽기 전용 사용) 으로 저장하고, 수정은
 * dao.ts 에 없는 update 를 이 폴더의 sessionHelpers.ts 로 처리한다(dao.ts 미변경).
 */
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '../../components/GlassCard';
import { PressableScale } from '../../components/PressableScale';
import { useTheme } from '../../theme/ThemeProvider';
import { formatTimeHHMM, saveSession } from '../../data/dao';
import type { Settings, StudySession } from '../../data/schema';
import { adjustOverlappingSessionEnd, findOverlappingSession, updateSession } from './sessionHelpers';

type SessionFormProps = {
  settings: Settings;
  date: string;
  editing: StudySession | null;
  onCancelEdit: () => void;
  onSaved: () => void;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clamp(value: string, max: number): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 0;
  return Math.min(Math.max(n, 0), max);
}

export function SessionForm({ settings, date, editing, onCancelEdit, onSaved }: SessionFormProps) {
  const theme = useTheme();
  const [subject, setSubject] = useState(settings.subjects[0]?.name ?? '');
  const [subItem, setSubItem] = useState<string | undefined>(undefined);
  const [type, setType] = useState(settings.types[0] ?? '');
  const [startH, setStartH] = useState('09');
  const [startM, setStartM] = useState('00');
  const [endH, setEndH] = useState('10');
  const [endM, setEndM] = useState('00');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setSubject(editing.subject);
      setSubItem(editing.subItem);
      setType(editing.type);
      const s = new Date(editing.startTime);
      const e = new Date(editing.endTime);
      setStartH(pad2(s.getHours()));
      setStartM(pad2(s.getMinutes()));
      setEndH(pad2(e.getHours()));
      setEndM(pad2(e.getMinutes()));
    } else {
      setSubject(settings.subjects[0]?.name ?? '');
      setSubItem(undefined);
      setType(settings.types[0] ?? '');
      setStartH('09');
      setStartM('00');
      setEndH('10');
      setEndM('00');
    }
  }, [editing, settings.subjects, settings.types]);

  const currentSubjectData = settings.subjects.find((s) => s.name === subject);
  const hasSubItems = !!currentSubjectData?.children?.length;

  const finalizeSave = async (startTime: number, endTime: number, duration: number) => {
    try {
      const merged: StudySession = editing
        ? { ...editing, date, subject, subItem, type, startTime, endTime, duration }
        : { date, subject, subItem, type, startTime, endTime, duration };
      if (editing?.id) {
        await updateSession(editing.id, merged);
      } else {
        await saveSession(merged);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!subject || !type || saving) return;
    setSaving(true);

    const base = new Date(`${date}T00:00:00`);
    const start = new Date(base);
    start.setHours(clamp(startH, 23), clamp(startM, 59), 0, 0);
    const end = new Date(base);
    end.setHours(clamp(endH, 23), clamp(endM, 59), 0, 0);
    const startTime = start.getTime();
    let endTime = end.getTime();
    if (endTime <= startTime) endTime += 24 * 60 * 60 * 1000; // 자정 넘어가는 세션 허용
    const duration = endTime - startTime;
    if (duration <= 0) {
      setSaving(false);
      return;
    }

    try {
      const overlap = await findOverlappingSession(date, startTime, endTime, editing?.id);
      if (overlap) {
        Alert.alert(
          '세션 시간 중복',
          `${overlap.subject} (${formatTimeHHMM(overlap.startTime)}~${formatTimeHHMM(
            overlap.endTime
          )})와 겹쳐요. 기존 세션의 종료 시각을 조정하고 저장할까요?`,
          [
            { text: '취소', style: 'cancel', onPress: () => setSaving(false) },
            {
              text: '조정하고 저장',
              onPress: async () => {
                await adjustOverlappingSessionEnd(overlap.id!, startTime - 1);
                await finalizeSave(startTime, endTime, duration);
              },
            },
          ]
        );
        return;
      }
      await finalizeSave(startTime, endTime, duration);
    } catch {
      setSaving(false);
    }
  };

  return (
    <GlassCard style={styles.card} radius={theme.radius.lg}>
      <View style={styles.headerRow}>
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
          {editing ? '기록 수정' : '기록 추가'}
        </Text>
        {editing ? (
          <PressableScale onPress={onCancelEdit} strength="soft">
            <Text style={[styles.cancelLink, { color: theme.colors.primary }]}>취소</Text>
          </PressableScale>
        ) : null}
      </View>

      <ChipRow
        items={settings.subjects.map((s) => s.name)}
        value={subject}
        onChange={(v) => {
          setSubject(v);
          setSubItem(undefined);
        }}
      />
      {hasSubItems ? (
        <ChipRow
          items={currentSubjectData?.children ?? []}
          value={subItem}
          onChange={(v) => setSubItem(v === subItem ? undefined : v)}
          small
        />
      ) : null}
      <ChipRow items={settings.types} value={type} onChange={setType} />

      <View style={styles.timeRow}>
        <TimeGroup label="시작" hour={startH} minute={startM} onHour={setStartH} onMinute={setStartM} />
        <Text style={[styles.tilde, { color: theme.colors.textSecondary }]}>~</Text>
        <TimeGroup label="종료" hour={endH} minute={endM} onHour={setEndH} onMinute={setEndM} />
      </View>

      <PressableScale onPress={handleSubmit} disabled={saving} strength="soft">
        <View style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]}>
          <Text style={styles.submitText}>{editing ? '수정 완료' : '기록 추가하기'}</Text>
        </View>
      </PressableScale>
    </GlassCard>
  );
}

function ChipRow({
  items,
  value,
  onChange,
  small,
}: {
  items: string[];
  value?: string;
  onChange: (v: string) => void;
  small?: boolean;
}) {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {items.map((item) => {
        const active = item === value;
        return (
          <PressableScale key={item} onPress={() => onChange(item)} strength="soft">
            <View
              style={[
                small ? styles.chipSmall : styles.chip,
                { backgroundColor: active ? theme.colors.primary : theme.colors.chipBg },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? '#ffffff' : theme.colors.textSecondary }]}>
                {item}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

function TimeGroup({
  label,
  hour,
  minute,
  onHour,
  onMinute,
}: {
  label: string;
  hour: string;
  minute: string;
  onHour: (v: string) => void;
  onMinute: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.timeGroup}>
      <Text style={[styles.timeLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      <View style={styles.timeInputs}>
        <TextInput
          value={hour}
          onChangeText={(v) => onHour(v.replace(/[^0-9]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          style={[styles.timeInput, { color: theme.colors.text, backgroundColor: theme.colors.chipBg }]}
        />
        <Text style={[styles.colon, { color: theme.colors.textSecondary }]}>:</Text>
        <TextInput
          value={minute}
          onChangeText={(v) => onMinute(v.replace(/[^0-9]/g, '').slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          style={[styles.timeInput, { color: theme.colors.text, backgroundColor: theme.colors.chipBg }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cancelLink: { fontSize: 13, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  chipSmall: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '700' },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  tilde: { fontSize: 16, fontWeight: '700', paddingBottom: 10 },
  timeGroup: { gap: 6, flex: 1 },
  timeLabel: { fontSize: 11, fontWeight: '700' },
  timeInputs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeInput: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  colon: { fontSize: 16, fontWeight: '800' },
  submitBtn: { paddingVertical: 15, borderRadius: 18, alignItems: 'center' },
  submitText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
});
