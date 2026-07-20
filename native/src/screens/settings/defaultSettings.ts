/**
 * defaultSettings.ts — 설정이 아직 없을 때(최초 실행) 생성할 기본값.
 * 웹 src/lib/db.ts 의 initializeSettings() 기본 객체를 그대로 미러링한다.
 */
import type { Settings } from '../../data/schema';

export const DEFAULT_SETTINGS: Settings = {
  userName: '사용자',
  subjects: [
    { name: '국어', children: ['독서', '문학', '언매'] },
    { name: '수학', children: ['수학I', '수학II', '미적분', '확률과 통계'] },
    { name: '영어', children: ['구문해석', '독해'] },
    { name: '사문' },
    { name: '지구' },
    { name: '기타' },
  ],
  types: ['자습', '수업', '테스트', '과제'],
  theme: 'system',
  drowsinessThresholdSec: 15,
};
