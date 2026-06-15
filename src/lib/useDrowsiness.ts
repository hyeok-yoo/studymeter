/**
 * useDrowsiness — 졸음(눈 감김/게슴츠레) 감지 훅.
 *
 * 집중도 엔진(네이티브 Kotlin · 웹 MediaPipe)이 공통으로 1초 주기로 방출하는
 * features.mean_ear(최근 10초 평균 EAR) 스트림만 사용한다. 따라서 파이프라인/네이티브
 * 코드 변경 없이 두 플랫폼에서 동일하게 동작한다.
 *
 * 동작:
 *  1) 세션 동안 mean_ear 샘플로 개인 "눈 뜬 상태" 베이스라인을 추정(90퍼센타일).
 *  2) mean_ear 가 베이스라인의 CLOSE_RATIO 미만으로 떨어지면 눈 감김 시작으로 보고
 *     지속시간을 누적. REOPEN_RATIO 이상으로 회복하면 0으로 리셋(히스테리시스).
 *  3) 누적 지속시간이 임계치를 넘으면 drowsy=true. 눈을 다시 뜨면 false.
 *
 * 주의: mean_ear 는 10초 트레일링 평균이라 눈을 감은 뒤 임계 교차까지 ~3–4초 지연이 있다.
 * 이를 감안해 누적 임계치를 12초로 두면 실제 연속 눈 감김 ≈ 15초 이상에 대응한다.
 */
import { useEffect, useRef, useState } from 'react';
import type { FocusFeatures } from './focusSync';

const CLOSE_RATIO = 0.65;    // mean_ear < 0.65×baseline → 눈 감김/게슴츠레
const REOPEN_RATIO = 0.8;    // mean_ear ≥ 0.80×baseline → 눈 뜸 (히스테리시스)
const SUSTAINED_MS = 12_000; // 누적 임계 (윈도우 지연 보정 시 실제 ≈15초)
const BASELINE_MIN_SAMPLES = 8;
const MAX_BUFFER = 180;      // 약 3분치 (1Hz)

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return NaN;
    const idx = Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)));
    return sorted[idx];
}

interface Tracker {
    buf: number[];
    closureStart: number | null;
    lastFeatures: FocusFeatures | null;
    drowsy: boolean;
}

function emptyTracker(): Tracker {
    return { buf: [], closureStart: null, lastFeatures: null, drowsy: false };
}

/** 트래커를 갱신하고 현재 졸음 여부를 반환. (순수 로직) */
function step(t: Tracker, ear: number, now: number): boolean {
    // 얼굴/눈 미검출(NaN) → 졸음 확정 불가. 진행 중이던 감김도 리셋(자리 비움 등).
    if (!Number.isFinite(ear)) {
        t.closureStart = null;
        return false;
    }
    t.buf.push(ear);
    if (t.buf.length > MAX_BUFFER) t.buf.shift();
    if (t.buf.length < BASELINE_MIN_SAMPLES) {
        return t.closureStart !== null && now - t.closureStart >= SUSTAINED_MS;
    }
    const baseline = percentile([...t.buf].sort((a, b) => a - b), 0.9);
    if (!Number.isFinite(baseline) || baseline <= 0) return false;

    if (ear < CLOSE_RATIO * baseline) {
        if (t.closureStart === null) t.closureStart = now;
        return now - t.closureStart >= SUSTAINED_MS;
    }
    if (ear >= REOPEN_RATIO * baseline) {
        t.closureStart = null;
        return false;
    }
    // 히스테리시스 밴드 — 현재 상태 유지
    return t.closureStart !== null && now - t.closureStart >= SUSTAINED_MS;
}

export interface DrowsinessState {
    /** 졸음 경고 활성 여부 (눈을 다시 뜰 때까지 true 유지). */
    drowsy: boolean;
}

export function useDrowsiness(
    features: FocusFeatures | null,
    running: boolean,
    enabled = true,
): DrowsinessState {
    const [drowsy, setDrowsy] = useState(false);
    const trackerRef = useRef<Tracker>(emptyTracker());

    // 측정이 멈추면(또는 비활성) 추적 리셋
    useEffect(() => {
        if (running && enabled) return;
        trackerRef.current = emptyTracker();
        // 측정 종료 시 1회 리셋 — cascading 없음. (의도적 예외)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDrowsy(false);
    }, [running, enabled]);

    // features 스트림(외부 시스템) 구독 → 졸음 상태 동기화. 변경 시에만 setState.
    useEffect(() => {
        if (!running || !enabled || !features) return;
        const t = trackerRef.current;
        if (features === t.lastFeatures) return;
        t.lastFeatures = features;
        const next = step(t, features.mean_ear, Date.now());
        if (next !== t.drowsy) {
            t.drowsy = next;
            setDrowsy(next);
        }
    }, [features, running, enabled]);

    return { drowsy };
}
