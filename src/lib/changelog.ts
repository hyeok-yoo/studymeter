/**
 * changelog.ts — 앱 버전 + 변경 이력 데이터.
 *
 * 업데이트 후 최초 실행(PWA·APK 포함) 시 ChangelogModal 이 최신 항목을 보여준다.
 * 새 릴리스를 낼 때: APP_VERSION 을 올리고 CHANGELOG 맨 앞에 항목을 추가한다.
 * (package.json 의 version 과 맞춰 두면 관리가 편하다.)
 */

import { db } from './db';

/** 현재 앱 버전. 이 값이 바뀐 뒤 최초 실행 시 체인지로그가 뜬다. */
export const APP_VERSION = '1.7.0';

export interface ChangelogItem {
    /** iconify 아이콘 (mdi:*) — 없으면 기본 점 표시 */
    icon?: string;
    text: string;
}

export interface ChangelogEntry {
    version: string;
    date: string;       // YYYY-MM-DD
    title?: string;     // 릴리스 한 줄 제목 (선택)
    items: ChangelogItem[];
}

/** 최신이 맨 앞. */
export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.7.0',
        date: '2026-07-22',
        title: '더 깔끔하게, 종이 일기 그대로',
        items: [
            { icon: 'mdi:view-dashboard-outline', text: '홈 화면을 정리했어요 — 매일 쓰는 것만 앞에 두고, 주간 회고·학습 복기는 접이식 섹션으로 옮겨 한결 깔끔해졌어요.' },
            { icon: 'mdi:camera', text: '종이 일기를 사진·스캔으로 그대로 올릴 수 있어요 — 손으로 쓴 일기를 찍어 올리면 기록에 사진 그대로 남습니다.' },
            { icon: 'mdi:history', text: 'Gemini 대화가 저장돼요 — "이전 대화"에서 지난 대화를 다시 불러오고, "새 대화"로 새로 시작할 수 있어요.' },
            { icon: 'mdi:database-cog-outline', text: '데이터 관리 화면이 생겼어요 (설정 → 데이터 관리) — 저장소 사용량을 보고, 오래된 기록이나 대화·캐시를 골라 정리할 수 있어요.' },
            { icon: 'mdi:bug-check', text: '갤럭시탭 가로 화면의 공부 중 UI가 다시 넓게 보이도록, "새로워진 점" 안내가 제대로 뜨도록 고쳤어요.' },
        ],
    },
    {
        version: '1.6.0',
        date: '2026-07-22',
        title: '기록·복기·소통 대규모 업데이트',
        items: [
            { icon: 'mdi:sparkles', text: 'Gemini가 이제 사진·파일을 이해합니다 — 모르는 문제를 찍어 보내 풀거나, 손으로 쓴 일기·할 일 사진을 앱에 맞게 자동 정리·저장해요.' },
            { icon: 'mdi:check-decagram', text: 'Gemini 기록 정확도 개선 — 내 과목 목록 안에서만 골라 기록해, 없던 과목이 생겨 데이터가 꼬이지 않아요.' },
            { icon: 'mdi:format-list-checks', text: '체크리스트 추가 — 오늘·이번 주·이번 달 단위로 할 일을 만들고 지워나갈 수 있어요. Gemini로도 추가·완료 가능.' },
            { icon: 'mdi:calendar-star', text: 'D-day 위젯 — 수능처럼 중요한 날을 홈에 상시 표시. 개수·날짜 모두 커스텀할 수 있어요.' },
            { icon: 'mdi:brain', text: '세션별 학습 복기 — 세션에서 배운 걸 기록해 두면, 나중에 "예전에 공부한 개념 끌어와줘" 하고 물었을 때 Gemini가 찾아 답해줘요.' },
            { icon: 'mdi:notebook-heart', text: '주간 일기 추가 — 일간·세션 일기에 더해, 일요일 밤/월요일 아침에 쓰기 좋은 주간 회고를 상시 작성할 수 있어요.' },
            { icon: 'mdi:message-text', text: '관리자 ↔ 사용자 메시지 — 관리자가 보낸 메시지가 팝업으로 뜨고, 그 자리에서 답장할 수 있어요.' },
            { icon: 'mdi:tablet', text: '아이패드 가로 화면 개선 — 공부 중 화면에서 스톱워치가 잘리던 문제를 고쳤어요.' },
        ],
    },
];

const LAST_SEEN_KEY = 'studymeter_last_seen_version';

/** 저장된 "마지막으로 본 버전". 없으면 null. */
export function getLastSeenVersion(): string | null {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}

/** 현재 버전을 "봤음"으로 기록. */
export function markVersionSeen(version: string = APP_VERSION): void {
    try { localStorage.setItem(LAST_SEEN_KEY, version); } catch { /* ignore */ }
}

/** "vA" < "vB" 인지 단순 semver 비교 (숫자.숫자.숫자 기준, 부족한 자리는 0). */
function isOlder(a: string, b: string): boolean {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0, y = pb[i] ?? 0;
        if (x !== y) return x < y;
    }
    return false;
}

/**
 * 이 기기에 이미 앱을 써 온 흔적이 있는지 (기존 사용자 여부).
 * 체인지로그 도입 이전부터 써 온 사용자는 저장된 버전이 없지만 "신규 설치"가 아니다.
 * 이름 등록·공부 세션·일기 중 하나라도 있으면 기존 사용자로 본다.
 */
async function hasExistingData(): Promise<boolean> {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('studymeter_telemetry_name')) return true;
    } catch { /* ignore */ }
    try {
        if ((await db.sessions.count()) > 0) return true;
        if ((await db.diaryEntries.count()) > 0) return true;
    } catch { /* ignore */ }
    return false;
}

/**
 * 지금 체인지로그를 보여줘야 하는지 판단하고, 보여줄 항목을 반환한다.
 *  - 저장된 버전 == 현재: 표시 안 함.
 *  - 저장된 버전 < 현재: 그 사이(현재 버전 포함)의 항목들을 보여준다.
 *  - 저장된 버전 없음:
 *      · 기존 사용자(데이터 있음): 업데이트로 보고 최신 항목을 1회 보여준다.
 *        (예전엔 여기서 조용히 삼켜서 아무도 못 봤던 버그를 수정함.)
 *      · 진짜 신규 설치(데이터 없음): 표시하지 않고 현재 버전만 조용히 기록.
 * 반환이 빈 배열이면 모달을 띄우지 않는다. (모달 닫을 때 markVersionSeen 호출)
 */
export async function pendingChangelog(): Promise<ChangelogEntry[]> {
    const seen = getLastSeenVersion();

    if (seen === APP_VERSION) return [];

    if (seen === null) {
        if (await hasExistingData()) {
            // 기존 사용자에게 최신 릴리스 항목을 보여준다.
            return CHANGELOG.slice(0, 1);
        }
        // 진짜 신규 설치 — 업데이트가 아니므로 현재 버전만 기록하고 넘어간다.
        markVersionSeen();
        return [];
    }

    if (!isOlder(seen, APP_VERSION)) return [];

    // 마지막으로 본 버전보다 새로운 항목만 (여러 버전 건너뛴 경우 모두 보여준다).
    return CHANGELOG.filter(e => isOlder(seen, e.version));
}
