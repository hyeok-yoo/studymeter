/**
 * AiMarkdown — AI 생성물(마크다운) 렌더러. 웹 components/AiMarkdown 의 RN 대체.
 *
 * react-native-markdown-display 에 테마 토큰 색을 입혀, 라이트/다크 모두에서
 * 본문·강조·목록·표·코드·링크가 앱 톤에 맞게 보이도록 한다. 링크는 기본
 * 동작(외부 브라우저 열기)을 그대로 사용한다.
 */
import { useMemo } from 'react';
import { Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../../theme/ThemeProvider';

type AiMarkdownProps = {
  children: string;
  /** 본문 폰트 크기 (기본 15). 추론 요약 등 작은 텍스트엔 12~13. */
  fontSize?: number;
  /** 본문 색 오버라이드 (기본 theme.colors.text). */
  color?: string;
};

export function AiMarkdown({ children, fontSize = 15, color }: AiMarkdownProps) {
  const theme = useTheme();
  const c = theme.colors;

  const styles = useMemo(() => {
    const textColor = color ?? c.text;
    const line = Math.round(fontSize * 1.5);
    return {
      body: { color: textColor, fontSize, lineHeight: line },
      paragraph: { marginTop: 0, marginBottom: 8, flexWrap: 'wrap', flexDirection: 'row' } as const,
      heading1: { color: textColor, fontSize: fontSize + 8, fontWeight: '800', marginTop: 6, marginBottom: 6 } as const,
      heading2: { color: textColor, fontSize: fontSize + 5, fontWeight: '800', marginTop: 6, marginBottom: 5 } as const,
      heading3: { color: textColor, fontSize: fontSize + 2, fontWeight: '700', marginTop: 4, marginBottom: 4 } as const,
      heading4: { color: textColor, fontSize: fontSize + 1, fontWeight: '700', marginTop: 4, marginBottom: 4 } as const,
      heading5: { color: textColor, fontSize, fontWeight: '700' } as const,
      heading6: { color: textColor, fontSize, fontWeight: '700' } as const,
      strong: { fontWeight: '800', color: textColor } as const,
      em: { fontStyle: 'italic' } as const,
      s: { textDecorationLine: 'line-through' } as const,
      link: { color: c.accent, textDecorationLine: 'underline' } as const,
      blockquote: {
        backgroundColor: c.chipBg,
        borderColor: c.primary,
        borderLeftWidth: 3,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginBottom: 8,
      } as const,
      bullet_list: { marginBottom: 8 } as const,
      ordered_list: { marginBottom: 8 } as const,
      list_item: { flexDirection: 'row', justifyContent: 'flex-start' } as const,
      bullet_list_icon: { color: c.primary } as const,
      ordered_list_icon: { color: c.primary } as const,
      code_inline: {
        backgroundColor: c.chipBg,
        color: textColor,
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
        fontFamily: undefined,
      } as const,
      code_block: {
        backgroundColor: c.chipBg,
        color: textColor,
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
      } as const,
      fence: {
        backgroundColor: c.chipBg,
        color: textColor,
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
      } as const,
      hr: { backgroundColor: c.border, height: StyleSheetHairline, marginVertical: 10 } as const,
      table: { borderColor: c.border, borderWidth: StyleSheetHairline, borderRadius: 10, marginBottom: 8 } as const,
      thead: { backgroundColor: c.chipBg } as const,
      th: { padding: 8, color: textColor, fontWeight: '700' } as const,
      td: { padding: 8, color: textColor, borderColor: c.border } as const,
      tr: { borderColor: c.border, borderBottomWidth: StyleSheetHairline } as const,
    };
  }, [c, fontSize, color]);

  return (
    <Markdown style={styles} onLinkPress={(url) => { void Linking.openURL(url); return false; }}>
      {children}
    </Markdown>
  );
}

// hairline 상수 (StyleSheet import 없이 얇은 선)
const StyleSheetHairline = 0.5;
