import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.studymeter.app',
  appName: 'StudyMeter',
  webDir: 'dist',
  android: {
    // WebView 의 origin 은 https://localhost 라서, 그대로 두면 집 안의
    // http://<HA>:8123 REST 호출과 ws:// 구독이 mixed content 로 차단된다.
    // androidScheme 를 http 로 바꾸면 origin 이 달라져 IndexedDB(공부 기록)가
    // 통째로 날아가므로, scheme 은 건드리지 않고 mixed content 만 허용한다.
    allowMixedContent: true,
  },
};

export default config;
