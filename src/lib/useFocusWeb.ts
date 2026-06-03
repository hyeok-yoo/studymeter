/**
 * useFocusWeb — 브라우저 내 집중도 감지 훅.
 * useFocusNative 와 동일한 인터페이스를 제공하되, 안드로이드 네이티브 플러그인 대신
 * MediaPipe(WASM) + ONNX(WASM) 파이프라인을 브라우저에서 직접 구동한다.
 *
 * 무거운 파이프라인/모델은 measure 시작 시점에만 동적 import + 초기화하고,
 * 중지 시 카메라와 함께 완전히 해제한다 (대기 상태 자원 점유 최소화).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import type { FocusFeatures } from './focusSync';
import type { FocusResult } from './focus/types';
import { ScoreCalibrator } from './focus/scoreCalibrator';
import type { FocusPipeline } from './focus/pipeline';

export type WebStatus = 'idle' | 'starting' | 'running' | 'error';

const TARGET_FPS = 15;

export function useFocusWeb() {
    const [score, setScore] = useState<number | null>(null);
    const [etaS, setEtaS] = useState<number | null>(null);
    const [features, setFeatures] = useState<FocusFeatures | null>(null);
    const [status, setStatus] = useState<WebStatus>('idle');
    const [running, setRunning] = useState(false);
    const [cameraJpeg, setCameraJpeg] = useState<string | null>(null);
    const [gazeX, setGazeX] = useState<number | null>(null);
    const [gazeY, setGazeY] = useState<number | null>(null);
    const [roiColors, setRoiColors] = useState<{ forehead?: string; rightCheek?: string; leftCheek?: string } | null>(null);
    const [trainingState, setTrainingState] = useState<{ session_count: number; is_calibrated: boolean } | null>(null);

    const pipelineRef = useRef<FocusPipeline | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const loopRef = useRef<number | null>(null);
    const processingRef = useRef(false);
    const calibratorRef = useRef<ScoreCalibrator | null>(null);

    // ScoreCalibrator는 localStorage만 쓰므로 즉시 로드 가능 (가벼움)
    useEffect(() => {
        const c = new ScoreCalibrator();
        calibratorRef.current = c;
        setTrainingState({ session_count: c.sessionCount, is_calibrated: c.isCalibrated });
    }, []);

    const applyResult = useCallback((r: FocusResult) => {
        setScore(Math.round(r.score * 10) / 10);
        setEtaS(r.etaS);
        if (r.features) {
            const f = r.features;
            const fx: FocusFeatures = {
                saccade_rate: f.saccadeRateHz, fixation_ratio: f.fixationRatio,
                mean_fix_duration: f.meanFixDurationS, mean_velocity: f.meanVelocityPxS,
                std_velocity: f.stdVelocityPxS, dispersion_x: f.gazeDispersionXPx,
                dispersion_y: f.gazeDispersionYPx, bpm: f.bpm, rmssd: f.rmssdMs,
                sdnn: f.sdnnMs, lf_hf: f.lfHfRatio, valid_ratio: f.validRatio,
                mean_ear: f.meanEar, min_ear: f.minEar,
            };
            setFeatures(fx);
        }
        const p = pipelineRef.current;
        if (p) {
            if (r.gazeScreenX != null) setGazeX(r.gazeScreenX / p.screenWidth);
            if (r.gazeScreenY != null) setGazeY(r.gazeScreenY / p.screenHeight);
        }
        const hex = (rgb: number[] | null) => rgb
            ? '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
            : undefined;
        if (r.roiForehead || r.roiRightCheek || r.roiLeftCheek) {
            setRoiColors({ forehead: hex(r.roiForehead), rightCheek: hex(r.roiRightCheek), leftCheek: hex(r.roiLeftCheek) });
        }
    }, []);

    const stop = useCallback(() => {
        if (loopRef.current != null) { clearInterval(loopRef.current); loopRef.current = null; }
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
        pipelineRef.current?.close();
        pipelineRef.current = null;
        setRunning(false);
        setStatus('idle');
        setCameraJpeg(null);
    }, []);

    const start = useCallback(async () => {
        if (running || status === 'starting') return;
        setStatus('starting');
        try {
            // 1) 카메라
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
            });
            streamRef.current = stream;
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.srcObject = stream;
            await video.play();
            videoRef.current = video;

            // 2) 파이프라인 (동적 import → measure 시작 시에만 로드)
            const { FocusPipeline } = await import('./focus/pipeline');
            const pipeline = new FocusPipeline();
            await pipeline.init();
            pipelineRef.current = pipeline;

            // 3) 처리 루프
            setRunning(true);
            setStatus('running');
            const interval = Math.round(1000 / TARGET_FPS);
            loopRef.current = window.setInterval(async () => {
                const p = pipelineRef.current; const v = videoRef.current;
                if (!p || !v || processingRef.current || v.readyState < 2) return;
                processingRef.current = true;
                try {
                    const r = await p.processFrame(v, performance.now());
                    if (r) applyResult(r);
                    if (p.lastDebugJpeg) { setCameraJpeg(p.lastDebugJpeg); p.lastDebugJpeg = null; }
                } catch (e) {
                    console.error('focus web frame error', e);
                } finally {
                    processingRef.current = false;
                }
            }, interval);
        } catch (e) {
            console.error('useFocusWeb start error', e);
            setStatus('error');
            stop();
        }
    }, [running, status, applyResult, stop]);

    // 언마운트 시 정리
    useEffect(() => () => { stop(); }, [stop]);

    const setDebugMode = useCallback((enabled: boolean) => {
        if (pipelineRef.current) pipelineRef.current.debugEnabled = enabled;
        if (!enabled) setCameraJpeg(null);
    }, []);

    const addSessionRating = useCallback(async (meanScore: number, rating: number) => {
        const c = calibratorRef.current; if (!c) return;
        c.addSession(meanScore, rating);
        setTrainingState({ session_count: c.sessionCount, is_calibrated: c.isCalibrated });
    }, []);

    const resetScoreCalibration = useCallback(async () => {
        const c = calibratorRef.current; if (!c) return;
        c.reset();
        setTrainingState({ session_count: 0, is_calibrated: false });
    }, []);

    // 웹은 별도 캘리브레이션 UI가 없음 (미보정 fallback 사용)
    const startCalibration = useCallback(async () => false, []);

    return {
        score, etaS, features, running, status,
        isNative: false, isAvailable: true,
        cameraJpeg, gazeX, gazeY, roiColors,
        trainingState, start, stop, startCalibration,
        addSessionRating, resetScoreCalibration, setDebugMode,
    };
}
