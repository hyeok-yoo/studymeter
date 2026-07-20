/**
 * GeminiScreen — AI 학습 도우미 채팅. 웹 pages/GeminiChat.tsx 의 RN 이식.
 *
 * 구성:
 *  - 헤더: 타이틀 + 활성 모델 배지(추론/검색 능력 표시)
 *  - 키 없음: "설정에서 API 키" 안내 (키는 dao.getSettings()?.geminiApiKey)
 *  - 채팅: 멀티턴 + 역할 라우팅 + 함수 호출 루프(useGeminiChat) + 마크다운/출처
 *  - 입력바: 기록 공유(오늘/이번 주)·검색·추론 토글 + KeyboardAvoidingView + PressableScale 전송
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { PressableScale } from '../components';
import { getSettings } from '../data/dao';
import type { Settings } from '../data/schema';
import { fetchGeminiModels, type GeminiModel } from '../ai';
import { ChatMessage } from './gemini/ChatMessage';
import { useGeminiChat, type ShareData } from './gemini/useGeminiChat';

/** 목록을 아직 못 받았을 때 모델 이름만으로 능력 추정 (웹 deriveActiveCaps). */
function deriveActiveCaps(model: GeminiModel | undefined, name: string): GeminiModel {
  if (model) return model;
  return {
    name,
    displayName: name,
    description: '',
    supportsThinking: /2\.5/.test(name),
    supportsGrounding: /gemini-2\.\d/.test(name),
  };
}

export function GeminiScreen() {
  const theme = useTheme();
  const c = theme.colors;

  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [models, setModels] = useState<GeminiModel[]>([]);
  const [input, setInput] = useState('');
  const [shareData, setShareData] = useState<ShareData>('none');
  const [useGrounding, setUseGrounding] = useState(true);
  const [useThinking, setUseThinking] = useState(true);

  const scrollRef = useRef<ScrollView>(null);

  // 화면 진입마다 최신 설정을 읽는다 (설정에서 API 키/모델 변경 반영).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const s = await getSettings();
          if (cancelled) return;
          setSettings(s);
          setUseGrounding(s?.aiGroundingDefault !== false);
        } catch {
          if (!cancelled) setSettings(undefined);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // 사용 가능한 모델 목록을 받아 선택 모델의 능력치를 파악한다.
  useEffect(() => {
    const key = settings?.geminiApiKey;
    if (!key) return;
    let cancelled = false;
    fetchGeminiModels(key)
      .then((list) => { if (!cancelled) setModels(list); })
      .catch(() => { /* 무시: 이름 기반 추정으로 대체 */ });
    return () => { cancelled = true; };
  }, [settings?.geminiApiKey]);

  const activeModel = useMemo(() => {
    const found = models.find((m) => m.name === settings?.geminiModel) ?? models[0];
    return deriveActiveCaps(found, settings?.geminiModel || found?.name || '');
  }, [models, settings?.geminiModel]);

  // useGeminiChat 은 settings 를 요구하므로 키가 있을 때만 의미가 있다.
  const chatSettings = settings ?? ({ userName: '', subjects: [], types: [], theme: 'system' } as Settings);
  const { messages, loading, send } = useGeminiChat(chatSettings, models);

  useEffect(() => {
    // 메시지가 추가되면 맨 아래로 스크롤.
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, loading]);

  const onSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const sharedNow = shareData;
    setShareData('none');
    void send(text, sharedNow, {
      useGrounding,
      useThinking,
      activeSupportsThinking: activeModel.supportsThinking,
    });
  }, [input, loading, shareData, useGrounding, useThinking, activeModel.supportsThinking, send]);

  const hasKey = !!settings?.geminiApiKey;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: c.bg }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text }]}>Gemini</Text>
        {hasKey && activeModel.name ? (
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: c.chipBg, borderColor: c.border }]}>
              <Text style={[styles.badgeText, { color: c.textSecondary }]} numberOfLines={1}>
                {activeModel.displayName}
              </Text>
            </View>
            {activeModel.supportsThinking ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.25)' }]}>
                <Ionicons name="sparkles-outline" size={11} color={c.secondary} />
                <Text style={[styles.badgeText, { color: c.secondary }]}>추론</Text>
              </View>
            ) : null}
            {activeModel.supportsGrounding ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(6,182,212,0.15)', borderColor: 'rgba(6,182,212,0.25)' }]}>
                <Ionicons name="globe-outline" size={11} color={c.accent} />
                <Text style={[styles.badgeText, { color: c.accent }]}>검색</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {!hasKey ? (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyCard, { backgroundColor: c.glassBg, borderColor: c.glassBorder }]}>
            <Ionicons name="key-outline" size={44} color={c.primary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>API 키가 필요합니다</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              설정 화면에서 Gemini API 키를 입력하면 AI 학습 도우미를 사용할 수 있어요.
            </Text>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          {/* 메시지 */}
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.intro}>
                <Text style={styles.introEmoji}>✨</Text>
                <Text style={[styles.introTitle, { color: c.text }]}>오늘 공부한 걸 그냥 말해보세요</Text>
                <Text style={[styles.introBody, { color: c.textSecondary }]}>
                  "학원에서 수학 2시간 듣고 좀 졸았어, 영어 단어도 1시간 했고"
                </Text>
                <Text style={[styles.introHint, { color: c.textSecondary }]}>
                  → 세션 기록과 오늘 일기까지 알아서 정리해드려요. 기록 공유 버튼으로 데이터를 함께 보낼 수 있어요.
                </Text>
              </View>
            ) : null}

            {messages.map((m, i) => (
              <ChatMessage key={i} message={m} />
            ))}

            {loading ? (
              <View style={[styles.loadingBubble, { backgroundColor: c.glassBg, borderColor: c.glassBorder }]}>
                <ActivityIndicator size="small" color={c.primary} />
                <Text style={[styles.loadingText, { color: c.textSecondary }]}>생각 중...</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* 입력 바 */}
          <View style={[styles.inputBar, { backgroundColor: c.chromeBg, borderColor: c.border }]}>
            {/* 옵션 */}
            <View style={styles.optionsRow}>
              <Text style={[styles.optionLabel, { color: c.textSecondary }]}>기록 공유</Text>
              <Toggle
                label="오늘"
                active={shareData === 'day'}
                onPress={() => setShareData(shareData === 'day' ? 'none' : 'day')}
              />
              <Toggle
                label="이번 주"
                active={shareData === 'week'}
                onPress={() => setShareData(shareData === 'week' ? 'none' : 'week')}
              />
              <View style={styles.flex} />
              {activeModel.supportsGrounding ? (
                <Toggle label="검색" active={useGrounding} onPress={() => setUseGrounding(v => !v)} tone="accent" />
              ) : null}
              {activeModel.supportsThinking ? (
                <Toggle label="추론" active={useThinking} onPress={() => setUseThinking(v => !v)} tone="secondary" />
              ) : null}
            </View>
            {shareData !== 'none' ? (
              <Text style={styles.shareNote}>
                ✓ {shareData === 'day' ? '오늘' : '이번 주'} 기록이 다음 메시지에 포함됩니다
              </Text>
            ) : null}

            {/* 입력 */}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.textInput, { backgroundColor: c.glassBg, borderColor: c.border, color: c.text }]}
                value={input}
                onChangeText={setInput}
                placeholder="오늘 공부한 걸 말하거나 질문해보세요…"
                placeholderTextColor={c.textSecondary}
                multiline
                onSubmitEditing={onSend}
                blurOnSubmit={false}
                editable={!loading}
              />
              <PressableScale
                onPress={onSend}
                strength="strong"
                disabled={loading || !input.trim()}
                accessibilityLabel="전송"
              >
                <View style={[styles.sendBtn, { backgroundColor: c.primary }]}>
                  <Ionicons name="send" size={18} color="#ffffff" />
                </View>
              </PressableScale>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

/** 입력바 토글 칩. */
function Toggle({
  label, active, onPress, tone = 'primary',
}: { label: string; active: boolean; onPress: () => void; tone?: 'primary' | 'accent' | 'secondary' }) {
  const theme = useTheme();
  const c = theme.colors;
  const activeColor = tone === 'accent' ? c.accent : tone === 'secondary' ? c.secondary : c.primary;
  return (
    <PressableScale onPress={onPress} strength="soft">
      <View
        style={[
          styles.toggle,
          active
            ? { backgroundColor: activeColor, borderColor: activeColor }
            : { backgroundColor: c.glassBg, borderColor: c.border },
        ]}
      >
        <Text style={[styles.toggleText, { color: active ? '#ffffff' : c.textSecondary }]}>{label}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, justifyContent: 'flex-end' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
  },
  badgeText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    padding: 28,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 360,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptyBody: { fontSize: 14, lineHeight: 21, textAlign: 'center' },

  messages: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  intro: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  introEmoji: { fontSize: 44 },
  introTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  introBody: { fontSize: 13, textAlign: 'center' },
  introHint: { fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },

  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loadingText: { fontSize: 14, fontWeight: '600' },

  inputBar: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  optionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  optionLabel: { fontSize: 12, fontWeight: '600' },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleText: { fontSize: 12, fontWeight: '700' },
  shareNote: { fontSize: 11, fontWeight: '600', color: '#22c55e' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
