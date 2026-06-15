/**
 * alarm.ts — 알림음/진동 유틸 (졸음 경고 · 테스트 타이머 종료음 공용).
 *
 * 소리는 Web Audio(AudioContext)로 합성한다. Android WebView에서 Web Audio 출력은
 * 미디어 스트림(STREAM_MUSIC)으로 재생되므로, ① 이어폰이 연결돼 있으면 이어폰으로 나가고
 * ② 벨소리/진동 모드와 무관하게 "미디어 볼륨"을 따른다. (별도 오디오 에셋 불필요)
 *
 * 진동은 navigator.vibrate 사용 (Android WebView에서 동작, VIBRATE 권한 필요 없음).
 */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            audioCtx = new AC();
        }
        // iOS/일부 WebView는 사용자 제스처 이후 suspended 상태일 수 있음 → resume 시도
        if (audioCtx.state === 'suspended') void audioCtx.resume();
        return audioCtx;
    } catch (e) {
        console.error('AudioContext init failed', e);
        return null;
    }
}

/** 단발 톤 1개 재생 (미디어 볼륨). */
function tone(freq: number, startAt: number, durationS: number, gain = 0.25, type: OscillatorType = 'sine'): void {
    const ac = ctx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    // 부드러운 어택/릴리즈로 클릭 노이즈 방지
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(gain, startAt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + durationS);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(startAt);
    osc.stop(startAt + durationS + 0.02);
}

/**
 * 테스트 타이머 종료음 — 상승하는 3음 차임 (미디어 볼륨/이어폰 라우팅).
 * 벨소리/진동/무음 모드와 무관하게 항상 재생된다 (미디어 스트림).
 */
export function playTimerEndSound(): void {
    const ac = ctx();
    if (!ac) return;
    const t0 = ac.currentTime + 0.02;
    tone(660, t0, 0.18, 0.3, 'triangle');        // E5
    tone(880, t0 + 0.20, 0.18, 0.3, 'triangle');  // A5
    tone(1175, t0 + 0.40, 0.34, 0.32, 'triangle'); // D6 (길게)
}

/** 졸음 경고용 날카로운 더블 비프 1세트. */
function drowsyBeepOnce(): void {
    const ac = ctx();
    if (!ac) return;
    const t0 = ac.currentTime + 0.01;
    tone(1320, t0, 0.16, 0.35, 'square');
    tone(1320, t0 + 0.22, 0.16, 0.35, 'square');
}

export type AlarmModality = 'sound' | 'vibrate' | 'silent';

/**
 * 졸음 경고 시작. modality 에 따라:
 *  - 'sound'   : 미디어 볼륨으로 반복 비프 (이어폰 라우팅)
 *  - 'vibrate' : 반복 진동
 *  - 'silent'  : 아무 출력 없음 (팝업만) — 무음 모드 존중
 * 반환된 stop() 호출 전까지 반복된다 (눈을 다시 뜰 때까지).
 */
export function startDrowsyAlarm(modality: AlarmModality): () => void {
    if (modality === 'silent') {
        return () => { /* 출력 없음 */ };
    }

    if (modality === 'vibrate') {
        const vib = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* ignore */ } };
        vib([400, 200, 400]);
        const id = window.setInterval(() => vib([400, 200, 400]), 1500);
        return () => { window.clearInterval(id); vib(0); };
    }

    // 'sound'
    drowsyBeepOnce();
    const id = window.setInterval(drowsyBeepOnce, 1200);
    return () => { window.clearInterval(id); };
}
