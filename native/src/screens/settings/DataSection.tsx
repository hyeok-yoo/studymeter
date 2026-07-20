/**
 * DataSection — 웹앱 백업 JSON 가져오기 (3단계 핵심 기능).
 *
 * 파일 선택은 expo-document-picker. 파일 내용 읽기는 expo-file-system 을 새로
 * 설치하지 않고(패키지 변경 금지) 두 경로로 처리한다:
 *  - 웹 빌드: DocumentPickerAsset.file (표준 File 객체) 이 있으면 File.text() 사용.
 *  - iOS/Android: copyToCacheDirectory:true 로 받은 file:// URI 를 RN 내장 fetch 로
 *    읽는다 — RN 의 fetch/네트워킹 레이어는 file:// 스킴을 로컬 읽기로 지원하므로
 *    (Expo SDK 57 확인) 별도 파일시스템 의존성 없이 텍스트를 얻을 수 있다.
 *
 * 실제 복원은 importBackup(jsonText) 하나로 위임 — 트랜잭션·검증은 그쪽 책임.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { GlassCard, PressableScale } from '../../components';
import { useTheme } from '../../theme/ThemeProvider';
import { SectionLabel } from './SectionLabel';
import { importBackup } from '../../data/importBackup';

type Props = {
  /** 임포트 성공 후 상위에서 설정을 다시 읽어와 화면을 갱신할 수 있게 알린다. */
  onImported?: () => void | Promise<void>;
};

async function readAssetText(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  // 웹: File 객체가 있으면 그대로 텍스트로 읽는다.
  if (asset.file) {
    return await asset.file.text();
  }
  // 네이티브: cache 디렉터리로 복사된 file:// URI 를 fetch 로 읽는다.
  const response = await fetch(asset.uri);
  return await response.text();
}

export function DataSection({ onImported }: Props) {
  const theme = useTheme();
  const [importing, setImporting] = useState(false);

  const runImport = async (asset: DocumentPicker.DocumentPickerAsset) => {
    setImporting(true);
    try {
      const text = await readAssetText(asset);
      const summary = await importBackup(text);
      Alert.alert(
        '복원 완료',
        `세션 ${summary.sessions}개, 일일기록 ${summary.dailyRecords}개, 일기 ${summary.diaryEntries}개, 메모 ${summary.thoughtNotes}개를 불러왔습니다.\n\n변경 사항을 온전히 반영하려면 앱을 완전히 종료했다가 다시 실행해주세요.`
      );
      await onImported?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      Alert.alert('가져오기 실패', message);
    } finally {
      setImporting(false);
    }
  };

  const handlePickFile = async () => {
    if (importing) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // .json 이 기기별로 다른 MIME 으로 인식될 수 있어 폭넓게 허용
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];

      Alert.alert(
        '데이터 복원',
        '현재 기기의 모든 설정·기록이 선택한 백업 파일 내용으로 교체됩니다. 계속하시겠습니까?',
        [
          { text: '취소', style: 'cancel' },
          { text: '복원', style: 'destructive', onPress: () => runImport(asset) },
        ]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '파일을 선택하지 못했습니다.';
      Alert.alert('가져오기 실패', message);
    }
  };

  return (
    <View>
      <SectionLabel>데이터</SectionLabel>
      <GlassCard style={styles.card}>
        <Text style={[styles.desc, { color: theme.colors.textSecondary }]}>
          웹앱(studymeter)에서 내보낸 백업 JSON 파일을 가져와 이 기기의 데이터를 교체합니다.
        </Text>
        <PressableScale
          onPress={handlePickFile}
          disabled={importing}
          accessibilityLabel="웹앱 백업 가져오기"
          style={[styles.button, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}
        >
          <View style={styles.buttonContent}>
            {importing ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
            <Text style={styles.buttonText}>{importing ? '가져오는 중…' : '웹앱 백업 가져오기'}</Text>
          </View>
        </PressableScale>
        <Text style={[styles.warning, { color: theme.colors.textSecondary }]}>
          기존 기록이 백업 내용으로 전부 교체됩니다. 되돌릴 수 없으니 신중히 선택하세요.
        </Text>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  desc: { fontSize: 13, lineHeight: 19 },
  button: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  spinner: { marginRight: 8 },
  // 버튼 배경은 브랜드색(라이트/다크 공통)이라 흰 텍스트가 항상 대비를 보장한다.
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  warning: { fontSize: 11, lineHeight: 15, opacity: 0.8 },
});
