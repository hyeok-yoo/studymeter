/**
 * useFocusNative — Capacitor FocusPlugin 훅
 * 태블릿 자체 카메라로 집중도를 측정. useFocusSync와 동일한 핵심 인터페이스 유지.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { registerPlugin, Capacitor } from '@capacitor/core';
import type { FocusFeatures } from './focusSync';

export interface FocusUpdatePayload {
    type: 'focus_update';
    ts: number;
    score: number;
    eta_s: number | null;
    features: FocusFeatures;
    heuristic_mode: boolean;
    // new fields from native pipeline
    gaze_x?: number;           // normalized 0-1 screen x
    gaze_y?: number;           // normalized 0-1 screen y
    roi_forehead_hex?: string; // e.g. "#c87878"
    roi_right_cheek_hex?: string;
    roi_left_cheek_hex?: string;
}

interface PipelineStatePayload {
    type: 'pipeline_state';
    running: boolean;
    model: string | null;
    calibration: string | null;
}

interface FocusPluginInterface {
    startPipeline(): Promise<void>;
    stopPipeline(): Promise<void>;
    getPipelineState(): Promise<PipelineStatePayload>;
    startCalibration(options: { scenario: string }): Promise<{ success: boolean }>;
    addSessionRating(options: { mean_score: number; rating: number }): Promise<{ session_count: number; is_calibrated: boolean }>;
    getTrainingState(): Promise<{ session_count: number; is_calibrated: boolean }>;
    resetScoreCalibration(): Promise<void>;
    setDebugMode(options: { enabled: boolean }): Promise<void>;
    addListener(eventName: 'focusUpdate', cb: (data: FocusUpdatePayload) => void): Promise<{ remove: () => Promise<void> }>;
    addListener(eventName: 'pipelineState', cb: (data: PipelineStatePayload) => void): Promise<{ remove: () => Promise<void> }>;
    addListener(eventName: 'cameraFrame', cb: (data: { jpeg: string }) => void): Promise<{ remove: () => Promise<void> }>;
    removeAllListeners(): Promise<void>;
}

const FocusPlugin = registerPlugin<FocusPluginInterface>('FocusPlugin');

export type NativeStatus = 'unavailable' | 'idle' | 'starting' | 'running' | 'error';

export function useFocusNative() {
    const [score, setScore] = useState<number | null>(null);
    const [etaS, setEtaS] = useState<number | null>(null);
    const [features, setFeatures] = useState<FocusFeatures | null>(null);
    const [status, setStatus] = useState<NativeStatus>('idle');
    const [running, setRunning] = useState(false);
    const [cameraJpeg, setCameraJpeg] = useState<string | null>(null);
    const [gazeX, setGazeX] = useState<number | null>(null);
    const [gazeY, setGazeY] = useState<number | null>(null);
    const [roiColors, setRoiColors] = useState<{ forehead?: string; rightCheek?: string; leftCheek?: string } | null>(null);
    const [trainingState, setTrainingState] = useState<{ session_count: number; is_calibrated: boolean } | null>(null);

    const listenersRef = useRef<Array<{ remove: () => Promise<void> }>>([]);
    const isNative = Capacitor.isNativePlatform();

    useEffect(() => {
        if (!isNative) { setStatus('unavailable'); return; }
        let cancelled = false;

        const setup = async () => {
            try {
                const h1 = await FocusPlugin.addListener('focusUpdate', (data) => {
                    if (cancelled) return;
                    setScore(Math.round(data.score * 10) / 10);
                    setEtaS(data.eta_s);
                    setFeatures(data.features);
                    if (data.gaze_x != null) setGazeX(data.gaze_x);
                    if (data.gaze_y != null) setGazeY(data.gaze_y);
                    if (data.roi_forehead_hex || data.roi_right_cheek_hex || data.roi_left_cheek_hex) {
                        setRoiColors({
                            forehead: data.roi_forehead_hex,
                            rightCheek: data.roi_right_cheek_hex,
                            leftCheek: data.roi_left_cheek_hex,
                        });
                    }
                });
                const h2 = await FocusPlugin.addListener('pipelineState', (data) => {
                    if (cancelled) return;
                    setRunning(data.running);
                    setStatus(data.running ? 'running' : 'idle');
                });
                const h3 = await FocusPlugin.addListener('cameraFrame', (data) => {
                    if (cancelled) return;
                    setCameraJpeg(data.jpeg);
                });
                listenersRef.current = [h1, h2, h3];

                // Load training state
                const ts = await FocusPlugin.getTrainingState();
                if (!cancelled) setTrainingState(ts);
            } catch (e) {
                console.error('useFocusNative setup error', e);
                if (!cancelled) setStatus('error');
            }
        };
        setup();

        return () => {
            cancelled = true;
            listenersRef.current.forEach(h => h.remove().catch(() => {}));
            listenersRef.current = [];
        };
    }, [isNative]);

    const start = useCallback(async () => {
        if (!isNative) return;
        try { setStatus('starting'); await FocusPlugin.startPipeline(); }
        catch (e) { console.error('FocusPlugin.startPipeline error', e); setStatus('error'); }
    }, [isNative]);

    const stop = useCallback(async () => {
        if (!isNative) return;
        try { await FocusPlugin.stopPipeline(); setStatus('idle'); setRunning(false); }
        catch (e) { console.error('FocusPlugin.stopPipeline error', e); }
    }, [isNative]);

    const startCalibration = useCallback(async (scenario: 'book' | 'monitor' = 'monitor') => {
        if (!isNative) return false;
        try { const r = await FocusPlugin.startCalibration({ scenario }); return r.success; }
        catch (e) { console.error('FocusPlugin.startCalibration error', e); return false; }
    }, [isNative]);

    const addSessionRating = useCallback(async (meanScore: number, rating: number) => {
        if (!isNative) return;
        try {
            const ts = await FocusPlugin.addSessionRating({ mean_score: meanScore, rating });
            setTrainingState(ts);
        } catch (e) { console.error('addSessionRating error', e); }
    }, [isNative]);

    const resetScoreCalibration = useCallback(async () => {
        if (!isNative) return;
        try {
            await FocusPlugin.resetScoreCalibration();
            setTrainingState({ session_count: 0, is_calibrated: false });
        } catch (e) { console.error('resetScoreCalibration error', e); }
    }, [isNative]);

    const setDebugMode = useCallback(async (enabled: boolean) => {
        if (!isNative) return;
        try { await FocusPlugin.setDebugMode({ enabled }); }
        catch (e) { console.error('setDebugMode error', e); }
    }, [isNative]);

    return { score, etaS, features, running, status, isNative, cameraJpeg, gazeX, gazeY, roiColors, trainingState, start, stop, startCalibration, addSessionRating, resetScoreCalibration, setDebugMode };
}
