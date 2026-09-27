/**
 * useStudyTimer — 진행 중인 공부 세션의 시계.
 *
 * 이 훅이 존재하는 이유는 하나다: **경과 시간은 절대 시각으로만 계산한다.**
 * 앱이 꺼지든, 백그라운드로 밀려 setInterval 이 굶든, 알림 버튼이 앱 밖에서
 * 눌리든 결과가 같아야 하므로 tick 을 누적하지 않고 언제나
 * `now - 시작시각 - 누적 일시정지` 로 다시 계산한다.
 *
 * 이전에는 이 규칙이 Study 페이지 안에 여섯 개의 ref, 다섯 개의 effect,
 * 세 벌의 localStorage 직렬화 코드로 흩어져 있었다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeBridge } from './NativeBridge';

const STORAGE_KEY = 'studymeter_active_session';
/** 웹(비네이티브)용 생존 신호 — 화면에 떠 있는 동안 주기적으로 찍는다. */
const WEB_HEARTBEAT_KEY = 'studymeter_timer_heartbeat';
const WEB_HEARTBEAT_EVERY_MS = 15_000;
/** 네이티브 생존 신호는 15초마다 찍힌다. 이보다 오래 끊겼으면 나우바가 죽은 것이다. */
const NATIVE_STALE_GAP_MS = 3 * 60_000;

/**
 * 한 세션으로 믿을 수 있는 최대 길이. 이보다 길면 사람이 공부한 시간이 아니라
 * "앱이 죽은 채로 시계만 흐른" 흔적이다 (예: 40시간짜리 세션).
 */
export const MAX_PLAUSIBLE_SESSION_MS = 14 * 60 * 60 * 1000;

/** 복원 시 시계가 실제로는 멈춰 있었다고 판단해 잘라낸 경우의 안내 정보. */
export interface ClockRecovery {
    /** 시계를 멈춘 시각 (나우바가 마지막으로 살아 있던 시각) */
    stoppedAt: number;
    /** 잘라낸 시간 (ms) */
    cutMs: number;
}

/** 세션이 "무엇을 공부하는 중인지" — 시계와 함께 저장된다. */
export interface SessionDescriptor {
    subject: string;
    subItem?: string;
    type: string;
    /** 테스트 모드의 카운트다운 길이(ms). 없으면 스톱워치. */
    countdownMs?: number;
}

interface Persisted extends SessionDescriptor {
    isRunning: boolean;
    originalStartTime: number;
    totalPausedMs: number;
    pausedAtTime: number | null;
}

/** 저장된 진행 중 세션. 없거나 깨져 있으면 null. */
export function readActiveSession(): Persisted | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
        return null;
    }
}

export function clearActiveSession(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * @param initial  라우터 state 로 넘어온 시작 조건 (저장된 세션이 있으면 그쪽이 이긴다)
 * @param onStop   알림의 종료 버튼이 눌렸을 때. 종료 시각은 이미 반영된 상태로 호출된다.
 */
export function useStudyTimer(initial: SessionDescriptor, onStop: () => void) {
    const [session, setSession] = useState<SessionDescriptor>(initial);
    const [isRunning, setIsRunning] = useState(true);
    const [elapsed, setElapsed] = useState(0);
    /** 복원이 끝나 저장·알림·이벤트를 시작해도 되는 시점 */
    const [ready, setReady] = useState(false);
    const readyRef = useRef(false);
    useEffect(() => {
        readyRef.current = ready;
    }, [ready]);

    // 절대 시각 3종. 렌더와 무관하게 읽고 써야 하므로 ref 로 둔다.
    const startedAt = useRef(Date.now());
    const pausedTotal = useRef(0);
    /** null 이면 실행 중, 아니면 멈춘 시각 */
    const pausedAt = useRef<number | null>(null);

    /** 앱이 닫힌 동안 알림에서 "종료"가 눌려 있었다 — 준비가 끝나면 종료 경로로 넘긴다. */
    const stopOnReady = useRef(false);
    const [recovery, setRecovery] = useState<ClockRecovery | null>(null);

    /** 세션 종료가 시작됐는지 — 종료 후 도착한 알림 액션을 무시하는 가드 */
    const ended = useRef(false);
    const onStopRef = useRef(onStop);
    onStopRef.current = onStop;

    /** 지금 이 순간의 경과 시간. 멈춰 있으면 멈춘 시점까지. */
    const elapsedNow = useCallback(
        () => (pausedAt.current ?? Date.now()) - startedAt.current - pausedTotal.current,
        [],
    );

    /** 세션의 실질 종료 시각 — 알림에서 멈춘 뒤 나중에 앱을 열어도 버튼 누른 시각이 남는다. */
    const endedAt = useCallback(() => pausedAt.current ?? Date.now(), []);

    // ── 알림 액션 적용 ───────────────────────────────────────────────────────
    // 알림 버튼(PAUSE/RESUME/STOP)은 앱이 닫혀 있을 때도 눌린다. "기록된 시각(at)"
    // 기준으로 ref 에 적용하고, 종료가 있었는지만 돌려준다 (종료 처리는 호출부 몫).
    const applyActions = useCallback((actions: { action: string; at: number }[]): boolean => {
        let stop = false;
        for (const { action, at } of [...actions].sort((a, b) => a.at - b.at)) {
            if (action === 'resume') {
                if (pausedAt.current === null) continue;
                pausedTotal.current += Math.max(0, at - pausedAt.current);
                pausedAt.current = null;
            } else {
                // pause 와 stop 은 둘 다 "그 시각에 시계를 멈춘다". stop 은 종료까지 이어진다.
                if (pausedAt.current === null) pausedAt.current = Math.max(at, startedAt.current);
                if (action === 'stop') {
                    stop = true;
                    break;
                }
            }
        }
        return stop;
    }, []);

    // ── 복원 ────────────────────────────────────────────────────────────────
    // 순서가 중요하다: ① 저장된 시계 → ② 앱이 닫힌 동안 눌린 알림 버튼 → ③ 시계가
    // 실제로 살아 있었는지 확인 → 그 다음에야 ready. 예전에는 ready 부터 세워서
    // 나우바 START 와 알림 "종료"의 STOP 이 동시에 날아가 앱이 죽거나, 끝난 세션의
    // 나우바가 다시 살아나 계속 흘렀다.
    useEffect(() => {
        (async () => {
            const saved = readActiveSession();
            if (saved && Number.isFinite(saved.originalStartTime)) {
                startedAt.current = saved.originalStartTime;
                pausedTotal.current = saved.totalPausedMs || 0;
                pausedAt.current = saved.isRunning ? null : (saved.pausedAtTime ?? Date.now());

                const stop = applyActions(await NativeBridge.consumePendingActions());
                if (stop) {
                    stopOnReady.current = true;
                } else if (pausedAt.current === null) {
                    const cut = await findDeadClockCut(startedAt.current);
                    if (cut !== null) {
                        const cutMs = Date.now() - cut;
                        pausedAt.current = cut;
                        setRecovery({ stoppedAt: cut, cutMs });
                    }
                }

                setSession({
                    subject: saved.subject,
                    subItem: saved.subItem,
                    type: saved.type,
                    countdownMs: saved.countdownMs,
                });
                setIsRunning(pausedAt.current === null);
                setElapsed(elapsedNow());
            } else {
                if (saved) clearActiveSession(); // 깨진 저장본
                // 새 세션: 이전 세션에서 남았을 수 있는 대기 액션은 소급 대상이 아니므로 버린다.
                await NativeBridge.consumePendingActions();
            }
            setReady(true);
        })();
        // 마운트 시 1회. initial 은 복원본이 없을 때의 기본값으로만 쓰인다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 알림에서 이미 끝낸 세션 — 준비되자마자 종료 경로로.
    useEffect(() => {
        if (!ready || !stopOnReady.current) return;
        stopOnReady.current = false;
        onStopRef.current();
    }, [ready]);

    // ── 저장 ────────────────────────────────────────────────────────────────
    // 저장되는 값은 전부 절대 시각(ref)이라 `elapsed` 와는 무관하다. 예전에는
    // `elapsed` 가 deps 에 있어 tick 마다, 즉 초당 10번 똑같은 JSON 을 다시 썼다.
    // 세 ref 가 바뀌는 지점(복원·toggle·restart·reconcile)은 모두 isRunning 이나
    // session 도 함께 바꾸므로, 그 둘만 보면 저장 시점을 하나도 놓치지 않는다.
    useEffect(() => {
        if (!ready || ended.current) return;
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                ...session,
                isRunning,
                originalStartTime: startedAt.current,
                totalPausedMs: pausedTotal.current,
                pausedAtTime: pausedAt.current,
            } satisfies Persisted),
        );
    }, [session, isRunning, ready]);

    // ── tick ────────────────────────────────────────────────────────────────
    // 값 자체는 절대 시각에서 나오므로 이 interval 은 "화면을 다시 그릴 때"만 정한다.
    // 그래서 화면이 가려지면 그냥 멈춘다 — 초당 10번의 리렌더는 보이지 않는 동안
    // 순수한 낭비고(발열·전력), 복귀 시 elapsedNow() 로 다시 계산하므로 시간은
    // 1ms 도 어긋나지 않는다. 이 훅의 존재 이유가 바로 그 성질이다.
    useEffect(() => {
        if (!isRunning) {
            NativeBridge.allowSleep();
            return;
        }
        NativeBridge.keepAwake();

        let id = 0;
        let lastBeat = 0;
        const tick = () => {
            setElapsed(elapsedNow());
            const now = Date.now();
            if (now - lastBeat >= WEB_HEARTBEAT_EVERY_MS) {
                lastBeat = now;
                try {
                    localStorage.setItem(WEB_HEARTBEAT_KEY, String(now));
                } catch {
                    /* 저장소가 가득 차도 타이머는 돈다 */
                }
            }
        };
        const startTicking = () => {
            if (id) return;
            tick(); // 복귀 직후 옛 값이 한 틱 남지 않도록 즉시 한 번
            id = window.setInterval(tick, 100);
        };
        const stopTicking = () => {
            if (!id) return;
            clearInterval(id);
            id = 0;
        };
        const onVisibility = () =>
            document.visibilityState === 'visible' ? startTicking() : stopTicking();

        onVisibility();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            stopTicking();
            document.removeEventListener('visibilitychange', onVisibility);
            NativeBridge.allowSleep();
        };
    }, [isRunning, elapsedNow]);

    // ── 조작 ────────────────────────────────────────────────────────────────

    const toggle = useCallback(() => {
        if (pausedAt.current === null) {
            pausedAt.current = Date.now();
            setIsRunning(false);
        } else {
            pausedTotal.current += Date.now() - pausedAt.current;
            pausedAt.current = null;
            setIsRunning(true);
        }
    }, []);

    /** 과목·유형 전환 등으로 새 세션을 시작한다 (이전 세션 저장은 호출부 책임). */
    const restart = useCallback((next: Partial<SessionDescriptor>) => {
        startedAt.current = Date.now();
        pausedTotal.current = 0;
        pausedAt.current = null;
        setElapsed(0);
        setIsRunning(true);
        setSession((s) => ({ ...s, ...next }));
    }, []);

    /** 종료 표시 — 이후의 저장·알림 액션을 모두 막는다. */
    const finish = useCallback(() => {
        ended.current = true;
        setIsRunning(false);
    }, []);

    // ── 알림 액션 소급 반영 (앱이 떠 있는 동안) ──────────────────────────────
    // 큐를 원자적으로 비우므로 리스너·visibility 가 동시에 호출해도 이중 적용되지 않는다.
    const reconcile = useCallback(async () => {
        // 복원이 끝나기 전에는 복원 경로가 큐를 직접 소비한다 — 여기서 가로채면 안 된다.
        if (!NativeBridge.isNative() || ended.current || !readyRef.current) return;
        const actions = await NativeBridge.consumePendingActions();
        if (!actions.length || ended.current) return;
        const stop = applyActions(actions);
        setIsRunning(pausedAt.current === null);
        setElapsed(elapsedNow());
        if (stop) onStopRef.current();
    }, [applyActions, elapsedNow]);

    /** 잘라낸 시간 안내를 닫는다 (멈춘 채로 둔다). */
    const dismissRecovery = useCallback(() => setRecovery(null), []);

    /** "그동안도 공부 중이었다" — 잘라낸 시간을 되돌리고 시계를 다시 돌린다. */
    const undoRecovery = useCallback(() => {
        if (pausedAt.current !== null) {
            pausedAt.current = null;
            setIsRunning(true);
            setElapsed(elapsedNow());
        }
        setRecovery(null);
    }, [elapsedNow]);

    // 알림 리스너와 포그라운드 복귀 — 둘 다 같은 소급 경로로 위임한다.
    useEffect(() => {
        let handle: Awaited<ReturnType<typeof NativeBridge.addTimerActionListener>> = null;
        NativeBridge.addTimerActionListener(() => reconcile()).then((h) => {
            handle = h;
        });
        const onVisible = () => document.visibilityState === 'visible' && reconcile();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            handle?.remove();
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [reconcile]);

    // 복원 직후에도 한 번 — 앱이 닫힌 동안 눌린 버튼을 반영한다.
    useEffect(() => {
        if (ready) reconcile();
    }, [ready, reconcile]);

    return {
        session,
        setSession,
        isRunning,
        elapsed,
        ready,
        /** 세션 시작 시각 (날짜 귀속·알림 기준점) */
        startedAt,
        elapsedNow,
        endedAt,
        toggle,
        restart,
        finish,
        /** 복원 때 죽은 시계를 잘라냈으면 그 정보 */
        recovery,
        dismissRecovery,
        undoRecovery,
        clear: clearActiveSession,
    };
}

/**
 * 복원한 "실행 중" 세션의 시계가 실제로는 언제 멈췄는지 찾는다. 멀쩡하면 null.
 *
 * 네이티브: 나우바 서비스가 없고, 이 세션 동안 찍힌 마지막 생존 신호가 몇 분 이상
 * 지났다면 그때 프로세스째 죽은 것이다 — 사용자는 나우바가 사라진 걸 보고 공부를
 * 멈췄을 가능성이 높고, 적어도 앱은 그 뒤를 모른다.
 *
 * 웹/근거 없음: 믿을 수 없을 만큼(14시간+) 길 때만 마지막으로 화면에 떠 있던 시각에서 자른다.
 */
async function findDeadClockCut(start: number): Promise<number | null> {
    const now = Date.now();
    const state = await NativeBridge.getServiceState();
    if (state && !state.running && state.heartbeat > start && now - state.heartbeat > NATIVE_STALE_GAP_MS) {
        return state.heartbeat;
    }
    if (state?.running) return null;
    if (now - start <= MAX_PLAUSIBLE_SESSION_MS) return null;
    let beat = 0;
    try {
        beat = Number(localStorage.getItem(WEB_HEARTBEAT_KEY)) || 0;
    } catch {
        /* 무시 */
    }
    if (state && state.heartbeat > beat) beat = state.heartbeat;
    // 근거가 하나도 없으면 시작 시각에서 자른다 — 14시간짜리 유령 세션을 남기는 것보다 낫고,
    // 사용자가 안내에서 "계속 공부 중이었어요"로 되돌릴 수 있다.
    return beat > start ? beat : start;
}
