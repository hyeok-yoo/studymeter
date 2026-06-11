import { useEffect, useRef, useState, useCallback } from 'react';

export interface FocusFeatures {
    saccade_rate: number;
    fixation_ratio: number;
    mean_fix_duration: number;
    mean_velocity: number;
    std_velocity: number;
    dispersion_x: number;
    dispersion_y: number;
    bpm: number;
    rmssd: number;
    sdnn: number;
    lf_hf: number;
    valid_ratio: number;
    mean_ear: number;
    min_ear: number;
    // 신규 졸음·자세 피처 (옵셔널, null 가능)
    perclos?: number | null;
    blink_rate_hz?: number | null;
    mean_blink_dur_s?: number | null;
    ear_norm?: number | null;
    disp_norm?: number | null;
    head_pitch_deg?: number | null;
    head_yaw_deg?: number | null;
    head_move_std_deg?: number | null;
    ear_slope_60s?: number | null;
    fix_ratio_slope_60s?: number | null;
}

export interface FocusUpdate {
    type: 'focus_update';
    ts: number;
    score: number;
    eta_s: number | null;
    features: FocusFeatures;
}

export interface PipelineState {
    running: boolean;
    model: string | null;
    calibration: string | null;
    fps: number;
}

interface PipelineStateMessage {
    type: 'pipeline_state';
    running: boolean;
    model: string | null;
    calibration: string | null;
    fps: number;
}

// ── 개발자 모드 프로토콜 ────────────────────────────────────────────────────────

export interface CollectState {
    active: boolean;
    label: 0 | 1 | null;
    rows: number;
    output: string;
}

export interface TrainStats {
    val_accuracy?: number | null;
    n_samples?: number | null;
    framework?: string | null;
    [key: string]: unknown;
}

export interface TrainResult {
    ok: boolean;
    model: string | null;
    stats: TrainStats | null;
    error: string | null;
}

export interface ModelInfo {
    name: string;
    mtime: number;
    size_kb: number;
    active: boolean;
}

interface CollectStateMessage {
    type: 'collect_state';
    active: boolean;
    label: 0 | 1 | null;
    rows: number;
    output: string;
}

interface TrainStateMessage {
    type: 'train_state';
    running: boolean;
}

interface TrainResultMessage {
    type: 'train_result';
    ok: boolean;
    model: string | null;
    stats: TrainStats | null;
    error: string | null;
}

interface ModelListMessage {
    type: 'model_list';
    models: ModelInfo[];
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

type CalibrationScenario = 'book' | 'monitor';

interface CalibrateStartMessage {
    type: 'calibrate_start';
    scenario: CalibrationScenario;
}

interface CalibrateCaptureMessage {
    type: 'calibrate_capture';
}

interface PingMessage {
    type: 'ping';
}

interface VideoFrameMessage {
    type: 'video_frame';
    data: string;
}

interface PipelineStartMessage {
    type: 'pipeline_start';
}

interface PipelineStopMessage {
    type: 'pipeline_stop';
}

interface PipelineStatusMessage {
    type: 'pipeline_status';
}

interface CollectStartMessage {
    type: 'collect_start';
    label: 0 | 1;
}

interface CollectStopMessage {
    type: 'collect_stop';
}

interface TrainStartMessage {
    type: 'train_start';
}

interface ModelListRequestMessage {
    type: 'model_list';
}

interface ModelApplyMessage {
    type: 'model_apply';
    name: string;
}

type OutgoingMessage =
    | CalibrateStartMessage
    | CalibrateCaptureMessage
    | PingMessage
    | VideoFrameMessage
    | PipelineStartMessage
    | PipelineStopMessage
    | PipelineStatusMessage
    | CollectStartMessage
    | CollectStopMessage
    | TrainStartMessage
    | ModelListRequestMessage
    | ModelApplyMessage;

export type ConnectionStatus =
    | 'idle'           // 연결 시도 안 함
    | 'connecting'     // 첫 연결 시도 중 (WebSocket 핸드셰이크)
    | 'connected'      // 연결됨
    | 'reconnecting'   // 끊김 → 자동 재시도 중
    | 'error';         // 연결 실패 (timeout/생성 실패)

interface UseFocusSyncOptions {
    autoConnect?: boolean; // 기본 true. false면 connect() 명시 호출 필요.
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const CONNECT_TIMEOUT_MS = 10000;

export function useFocusSync(
    serverUrl: string,
    options?: UseFocusSyncOptions
): {
    score: number | null;
    etaS: number | null;
    features: FocusFeatures | null;
    connected: boolean;
    status: ConnectionStatus;
    lastError: string | null;
    pipelineState: PipelineState | null;
    // 개발자 모드 상태
    collectState: CollectState | null;
    trainRunning: boolean;
    trainResult: TrainResult | null;
    modelList: ModelInfo[] | null;
    devError: string | null;
    clearDevError: () => void;
    connect: () => void;
    disconnect: () => void;
    sendCalibrateStart: (scenario: CalibrationScenario) => void;
    sendCalibrateCapture: () => void;
    sendVideoFrame: (dataUrl: string) => void;
    sendPipelineStart: () => void;
    sendPipelineStop: () => void;
    sendPipelineStatus: () => void;
    // 개발자 모드 명령
    sendCollectStart: (label: 0 | 1) => void;
    sendCollectStop: () => void;
    sendTrainStart: () => void;
    requestModelList: () => void;
    applyModel: (name: string) => void;
} {
    const autoConnect = options?.autoConnect !== false;

    const [score, setScore] = useState<number | null>(null);
    const [etaS, setEtaS] = useState<number | null>(null);
    const [features, setFeatures] = useState<FocusFeatures | null>(null);
    const [pipelineState, setPipelineState] = useState<PipelineState | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>('idle');
    const [lastError, setLastError] = useState<string | null>(null);
    // 개발자 모드 상태
    const [collectState, setCollectState] = useState<CollectState | null>(null);
    const [trainRunning, setTrainRunning] = useState<boolean>(false);
    const [trainResult, setTrainResult] = useState<TrainResult | null>(null);
    const [modelList, setModelList] = useState<ModelInfo[] | null>(null);
    const [devError, setDevError] = useState<string | null>(null);

    const wsRef = useRef<WebSocket | null>(null);
    const connectedRef = useRef<boolean>(false);
    const connectFnRef = useRef<() => void>(() => undefined);
    const disconnectFnRef = useRef<() => void>(() => undefined);

    const connected = status === 'connected';

    const send = useCallback((msg: OutgoingMessage) => {
        const ws = wsRef.current;
        if (!ws || !connectedRef.current || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(msg));
        } catch (e) {
            console.error('focusSync send failed', e);
        }
    }, []);

    const sendCalibrateStart = useCallback(
        (scenario: CalibrationScenario) => send({ type: 'calibrate_start', scenario }),
        [send]
    );
    const sendCalibrateCapture = useCallback(() => send({ type: 'calibrate_capture' }), [send]);
    const sendVideoFrame = useCallback((dataUrl: string) => send({ type: 'video_frame', data: dataUrl }), [send]);
    const sendPipelineStart = useCallback(() => send({ type: 'pipeline_start' }), [send]);
    const sendPipelineStop = useCallback(() => send({ type: 'pipeline_stop' }), [send]);
    const sendPipelineStatus = useCallback(() => send({ type: 'pipeline_status' }), [send]);

    // 개발자 모드 명령
    const sendCollectStart = useCallback((label: 0 | 1) => send({ type: 'collect_start', label }), [send]);
    const sendCollectStop = useCallback(() => send({ type: 'collect_stop' }), [send]);
    const sendTrainStart = useCallback(() => send({ type: 'train_start' }), [send]);
    const requestModelList = useCallback(() => send({ type: 'model_list' }), [send]);
    const applyModel = useCallback((name: string) => send({ type: 'model_apply', name }), [send]);
    const clearDevError = useCallback(() => setDevError(null), []);

    const connect = useCallback(() => connectFnRef.current(), []);
    const disconnect = useCallback(() => disconnectFnRef.current(), []);

    useEffect(() => {
        if (!serverUrl) {
            setStatus('idle');
            setLastError(null);
            return;
        }

        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        let shouldReconnect = autoConnect;
        let isFirstAttempt = true;
        let cancelled = false;

        const clearTimers = () => {
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
        };

        const openConnection = () => {
            if (cancelled) return;
            clearTimers();
            setStatus(isFirstAttempt ? 'connecting' : 'reconnecting');

            let ws: WebSocket;
            try {
                ws = new WebSocket(serverUrl);
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'WebSocket 생성 실패 (URL 형식 확인)';
                console.error('focusSync WebSocket construction failed', e);
                setLastError(msg);
                setStatus('error');
                if (shouldReconnect) {
                    isFirstAttempt = false;
                    scheduleReconnect();
                }
                return;
            }
            wsRef.current = ws;

            timeoutTimer = setTimeout(() => {
                if (ws.readyState === WebSocket.CONNECTING) {
                    setLastError(`연결 시간 초과 (${CONNECT_TIMEOUT_MS / 1000}초) — 서버 실행/방화벽/IP 확인`);
                    try {
                        ws.close();
                    } catch {
                        // ignore
                    }
                }
            }, CONNECT_TIMEOUT_MS);

            ws.onopen = () => {
                if (cancelled) return;
                if (timeoutTimer !== null) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                connectedRef.current = true;
                setStatus('connected');
                setLastError(null);
                reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
                isFirstAttempt = false;
                try {
                    ws.send(JSON.stringify({ type: 'pipeline_status' }));
                } catch (e) {
                    console.error('focusSync initial pipeline_status send failed', e);
                }
            };

            ws.onmessage = (event) => {
                if (typeof event.data !== 'string') return;
                let parsed: unknown;
                try {
                    parsed = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (!parsed || typeof parsed !== 'object') return;
                const msgType = (parsed as { type?: unknown }).type;

                if (msgType === 'focus_update') {
                    const update = parsed as FocusUpdate;
                    setScore(typeof update.score === 'number' ? update.score : null);
                    setEtaS(typeof update.eta_s === 'number' ? update.eta_s : null);
                    if (update.features && typeof update.features === 'object') {
                        setFeatures(update.features);
                    }
                    return;
                }

                if (msgType === 'pipeline_state') {
                    const ps = parsed as PipelineStateMessage;
                    setPipelineState({
                        running: ps.running === true,
                        model: typeof ps.model === 'string' ? ps.model : null,
                        calibration: typeof ps.calibration === 'string' ? ps.calibration : null,
                        fps: typeof ps.fps === 'number' ? ps.fps : 0,
                    });
                    return;
                }

                if (msgType === 'collect_state') {
                    const cs = parsed as CollectStateMessage;
                    setCollectState({
                        active: cs.active === true,
                        label: cs.label === 0 || cs.label === 1 ? cs.label : null,
                        rows: typeof cs.rows === 'number' ? cs.rows : 0,
                        output: typeof cs.output === 'string' ? cs.output : '',
                    });
                    return;
                }

                if (msgType === 'train_state') {
                    const ts = parsed as TrainStateMessage;
                    setTrainRunning(ts.running === true);
                    return;
                }

                if (msgType === 'train_result') {
                    const tr = parsed as TrainResultMessage;
                    setTrainResult({
                        ok: tr.ok === true,
                        model: typeof tr.model === 'string' ? tr.model : null,
                        stats: tr.stats && typeof tr.stats === 'object' ? tr.stats : null,
                        error: typeof tr.error === 'string' ? tr.error : null,
                    });
                    setTrainRunning(false);
                    return;
                }

                if (msgType === 'model_list') {
                    const ml = parsed as ModelListMessage;
                    setModelList(Array.isArray(ml.models) ? ml.models : []);
                    return;
                }

                if (msgType === 'error') {
                    const em = parsed as ErrorMessage;
                    setDevError(typeof em.message === 'string' ? em.message : '알 수 없는 오류');
                    return;
                }
            };

            ws.onerror = () => {
                // 브라우저 보안 제약상 상세 메시지 X. close 핸들러가 후속 처리.
                setLastError((prev) =>
                    prev ?? '연결 오류 — 서버 실행/방화벽(8765)/IP/같은 WiFi 확인'
                );
            };

            ws.onclose = (ev) => {
                if (timeoutTimer !== null) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                connectedRef.current = false;
                if (wsRef.current === ws) {
                    wsRef.current = null;
                }
                setPipelineState(null);
                setCollectState(null);
                setTrainRunning(false);
                if (cancelled) return;

                isFirstAttempt = false;
                if (shouldReconnect) {
                    setStatus('reconnecting');
                    setLastError((prev) => prev ?? `연결 끊김 (code ${ev.code}) — 재시도 중`);
                    scheduleReconnect();
                } else if (ev.code === 1000) {
                    setStatus('idle');
                    setLastError(null);
                } else {
                    setStatus('error');
                    setLastError((prev) => prev ?? `연결 실패 (code ${ev.code})`);
                }
            };
        };

        const scheduleReconnect = () => {
            if (!shouldReconnect || cancelled) return;
            clearTimers();
            const delay = reconnectDelay;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                openConnection();
            }, delay);
            reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        };

        const triggerConnect = () => {
            shouldReconnect = true;
            reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
            isFirstAttempt = true;
            setLastError(null);
            const ws = wsRef.current;
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                return;
            }
            openConnection();
        };

        const triggerDisconnect = () => {
            shouldReconnect = false;
            clearTimers();
            const ws = wsRef.current;
            wsRef.current = null;
            connectedRef.current = false;
            if (ws) {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    try {
                        ws.close(1000, 'manual disconnect');
                    } catch (e) {
                        console.error('focusSync close failed', e);
                    }
                }
            }
            setStatus('idle');
            setLastError(null);
            setPipelineState(null);
        };

        connectFnRef.current = triggerConnect;
        disconnectFnRef.current = triggerDisconnect;

        if (autoConnect) {
            openConnection();
        } else {
            setStatus('idle');
            setLastError(null);
        }

        return () => {
            cancelled = true;
            shouldReconnect = false;
            clearTimers();
            const ws = wsRef.current;
            wsRef.current = null;
            connectedRef.current = false;
            connectFnRef.current = () => undefined;
            disconnectFnRef.current = () => undefined;
            if (ws) {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    try {
                        ws.close(1000, 'client unmount');
                    } catch (e) {
                        console.error('focusSync close failed', e);
                    }
                }
            }
            setStatus('idle');
            setPipelineState(null);
        };
    }, [serverUrl, autoConnect]);

    return {
        score,
        etaS,
        features,
        connected,
        status,
        lastError,
        pipelineState,
        collectState,
        trainRunning,
        trainResult,
        modelList,
        devError,
        clearDevError,
        connect,
        disconnect,
        sendCalibrateStart,
        sendCalibrateCapture,
        sendVideoFrame,
        sendPipelineStart,
        sendPipelineStop,
        sendPipelineStatus,
        sendCollectStart,
        sendCollectStop,
        sendTrainStart,
        requestModelList,
        applyModel,
    };
}
