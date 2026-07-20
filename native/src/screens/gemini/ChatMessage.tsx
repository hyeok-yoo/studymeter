/**
 * ChatMessage — 채팅 메시지 버블. 웹 GeminiChat 의 메시지 렌더링을 RN 으로 이식.
 *
 * 사용자 메시지는 프라이머리 톤 버블(우측), 어시스턴트는 유리 카드(좌측)에
 *  - 추론 요약(펼침/접기)
 *  - 함수 실행 칩(functionActivity)
 *  - 마크다운 본문(AiMarkdown)
 *  - 검색 출처(grounding)
 * 를 순서대로 보여준다.
 */
import { memo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { PressableScale } from '../../components';
import { AiMarkdown } from './AiMarkdown';
import { WRITE_FUNCTIONS, type ChatMessage as ChatMessageData } from './useGeminiChat';

function ChatMessageBase({ message }: { message: ChatMessageData }) {
  const theme = useTheme();
  const c = theme.colors;
  const [showReasoning, setShowReasoning] = useState(false);

  if (message.role === 'user') {
    return (
      <View style={styles.rowEnd}>
        <View style={[styles.userBubble, { backgroundColor: c.primary }]}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rowStart}>
      <View
        style={[
          styles.assistantBubble,
          { backgroundColor: c.glassBg, borderColor: c.glassBorder },
        ]}
      >
        {/* 추론 과정 (펼침/접기) */}
        {message.reasoning ? (
          <View style={[styles.reasoningBox, { backgroundColor: c.chipBg, borderColor: c.border }]}>
            <PressableScale onPress={() => setShowReasoning(v => !v)} strength="soft">
              <View style={styles.reasoningHeader}>
                <Ionicons
                  name={showReasoning ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={c.textSecondary}
                />
                <Ionicons name="sparkles-outline" size={13} color={c.secondary} />
                <Text style={[styles.reasoningLabel, { color: c.textSecondary }]}>추론 과정 보기</Text>
              </View>
            </PressableScale>
            {showReasoning ? (
              <View style={[styles.reasoningBody, { borderTopColor: c.border }]}>
                <AiMarkdown fontSize={12} color={c.textSecondary}>{message.reasoning}</AiMarkdown>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 함수 실행 칩 */}
        {message.functionActivity && message.functionActivity.length > 0 ? (
          <View style={styles.chipWrap}>
            {message.functionActivity.map((fa, i) => (
              <View
                key={i}
                style={[
                  styles.chip,
                  fa.error
                    ? { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.3)' }
                    : { backgroundColor: c.chipBg, borderColor: c.border },
                ]}
              >
                <Text style={styles.chipIcon}>{fa.error ? '⚠️' : WRITE_FUNCTIONS.has(fa.name) ? '🔧' : '📂'}</Text>
                <Text
                  style={[styles.chipText, { color: fa.error ? '#ef4444' : c.textSecondary }]}
                  numberOfLines={2}
                >
                  {fa.name} — {fa.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* 본문 */}
        <AiMarkdown>{message.content}</AiMarkdown>

        {/* 검색 출처 */}
        {message.grounding && message.grounding.length > 0 ? (
          <View style={[styles.grounding, { borderTopColor: c.border }]}>
            <View style={styles.groundingHeader}>
              <Ionicons name="globe-outline" size={12} color={c.textSecondary} />
              <Text style={[styles.groundingLabel, { color: c.textSecondary }]}>검색 출처</Text>
            </View>
            {message.grounding.map((g, i) => (
              <PressableScale key={i} onPress={() => void Linking.openURL(g.uri)} strength="soft">
                <View style={styles.groundingItem}>
                  <Ionicons name="link-outline" size={12} color={c.accent} />
                  <Text style={[styles.groundingText, { color: c.accent }]} numberOfLines={1}>
                    {g.title}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const ChatMessage = memo(ChatMessageBase);

const styles = StyleSheet.create({
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end' },
  rowStart: { flexDirection: 'row', justifyContent: 'flex-start' },
  userBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  userText: { color: '#ffffff', fontSize: 15, lineHeight: 22 },
  assistantBubble: {
    maxWidth: '90%',
    padding: 14,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reasoningBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    overflow: 'hidden',
  },
  reasoningHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  reasoningLabel: { fontSize: 12, fontWeight: '700' },
  reasoningBody: { paddingHorizontal: 10, paddingBottom: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  chipIcon: { fontSize: 11 },
  chipText: { fontSize: 11, fontWeight: '500', flexShrink: 1 },
  grounding: { marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  groundingHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  groundingLabel: { fontSize: 11, fontWeight: '700' },
  groundingItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groundingText: { fontSize: 12, flexShrink: 1 },
});
