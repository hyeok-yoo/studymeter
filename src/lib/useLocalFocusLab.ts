/**
 * useLocalFocusLab — 온디바이스 수집·학습·모델 적용 훅 (개발자 도구 전용).
 *
 * PC 서버(focus_v2) 없이 앱 단독으로:
 *   카메라 → 인브라우저 파이프라인(src/lib/focus) → 라벨 수집(Dexie)
 *   → 순수 TS 학습(localModel) → 모델 적용(파이프라인 점수 경로 최우선).
 *
 * useFocusWeb과 달리 raw FeatureVector를 그대로 다뤄야 해서 별도 훅으로 분리
 * (기존 Study 탭 경로 무변경 — 회귀 위험 0).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { FocusPipeline } from './focus/pipeline';
import type { FocusResult } from './focus/types';
import {
    focusLabDB, addSample, exportCsv, importCsv,
    getActiveLocalModelId, setActiveLocalModelId,
    type StoredModel,
} from './focus/localData';
import { trainLocalModel, type TrainProgress } from './focus/localModel';
import { FEATURE_NAMES_V3 } from './focus/featureNames';

export type LabStatus = 'idle' | 'starting' | 'running' | 'error';

const TARGET_FPS = 15;

export interface TrainResultLocal {
    ok: boolean;
    name?: string;
    valAccuracy?: number;
    valF1?: number;
    nSamples?: number;
    error?: string;
}

export function useLocalFocusLab() {
    const [status, setStatus] = useState<LabStatus>('idle');
    const [score, setScore] = useState<number | null>(null);
    const [scoreSource, setScoreSource] = useState<string | null>(null);
    const [collectLabel, setCollectLabel] = useState<0 | 1 | null>(null);
    const [training, setTraining] = useState(false);
    const [trainProgress, setTrainProgress] = useState<TrainProgress | null>(null);
    const [trainResult, setTrainResult] = useState<TrainResultLocal | null>(null);
    const [labError, setLabError] = useState<string | null>(null);
    const [activeModelId, setActiveModelIdState] = useState<number | null>(() => getActiveLocalModelId());

    // 수집 행수·라벨별 분포·모델 목록은 Dexie 라이브 쿼리로 항상 최신
    const rowCount = useLiveQuery(() => focusLabDB.samples.count(), [], 0);
    const focusedCount = useLiveQuery(() => focusLabDB.samples.where('label').equals(0).count(), [], 0);
    const models = useLiveQuery(
        () => focusLabDB.models.orderBy('createdAt').reverse().toArray(),
        [], [] as StoredModel[],
    );

    const pipelineRef = useRef<FocusPipeline | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const loopRef = useRef<number | null>(null);
    const processingRef = useRef(false);
    const collectLabelRef = useRef<0 | 1 | null>(null);
    collectLabelRef.current = collectLabel;

    const stopMeasure = useCallback(() => {
        if (loopRef.current != null) { clearInterval(loopRef.current); loopRef.current = null; }
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (videoRef.current) { videoRef.current.srcObject = null; videoRef.current = null; }
        pipelineRef.current?.close();
        pipelineRef.current = null;
        setStatus('idle');
        setScore(null);
        setScoreSource(null);
        setCollectLabel(null);
    }, []);

    const startMeasure = useCallback(async () => {
        if (status === 'running' || status === 'starting') return;
        setStatus('starting');
        setLabError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
            });
            streamRef.current = stream;
            const video = document.createElement('video');
            video.muted = true; video.playsInline = true; video.srcObject = stream;
            await video.play();
            videoRef.current = video;

            const { FocusPipeline } = await import('./focus/pipeline');
            const pipeline = new FocusPipeline();
            const ok = await pipeline.init();
            if (!ok) throw new Error('얼굴 인식 모델 초기화 실패 (네트워크/모델 파일 확인)');
            pipelineRef.current = pipeline;

            setStatus('running');
            const interval = Math.round(1000 / TARGET_FPS);
            loopRef.current = window.setInterval(async () => {
                const p = pipelineRef.current; const v = videoRef.current;
                if (!p || !v || processingRef.current || v.readyState < 2) return;
                processingRef.current = true;
                try {
                    const r: FocusResult | null = await p.processFrame(v, performance.now());
                    if (r) {
                        setScore(Math.round(r.score * 10) / 10);
                        setScoreSource(r.scoreSource === 'local' ? `로컬: ${r.localModelName ?? ''}` : r.scoreSource);
                        const label = collectLabelRef.current;
                        if (label != null && r.features) {
                            await addSample(r.features, label, r.score);
                        }
                    }
                } catch (e) {
                    console.error('local lab frame error', e);
                } finally {
                    processingRef.current = false;
                }
            }, interval);
        } catch (e) {
            setLabError(e instanceof Error ? e.message : String(e));
            setStatus('error');
            stopMeasure();
        }
    }, [status, stopMeasure]);

    /** 수집 시작 — 측정 미실행이면 자동 시작. 수집 중 재호출 = 라벨 변경. */
    const startCollect = useCallback(async (label: 0 | 1) => {
        setCollectLabel(label);
        if (status !== 'running') await startMeasure();
    }, [status, startMeasure]);

    const stopCollect = useCallback(() => setCollectLabel(null), []);

    const train = useCallback(async () => {
        if (training) return;
        setTraining(true);
        setTrainResult(null);
        setTrainProgress(null);
        setLabError(null);
        try {
            const samples = await focusLabDB.samples.orderBy('ts').toArray();
            const outcome = await trainLocalModel(
                samples.map(s => s.features),
                samples.map(s => s.label),
                { onProgress: p => { if (p.epoch % 10 === 0) setTrainProgress(p); } },
            );
            const name = `local_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
            const id = await focusLabDB.models.add({
                name,
                createdAt: Date.now(),
                valAccuracy: outcome.valAccuracy,
                valF1: outcome.valF1,
                nSamples: samples.length,
                payload: outcome.payload,
            });
            // 학습 성공 시 자동 적용 (focus_v2 train_start와 동일 UX)
            setActiveLocalModelId(id);
            setActiveModelIdState(id);
            await pipelineRef.current?.reloadLocalModel();
            setTrainResult({
                ok: true, name,
                valAccuracy: outcome.valAccuracy, valF1: outcome.valF1,
                nSamples: samples.length,
            });
        } catch (e) {
            setTrainResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setTraining(false);
            setTrainProgress(null);
        }
    }, [training]);

    const applyModel = useCallback(async (id: number | null) => {
        setActiveLocalModelId(id);
        setActiveModelIdState(id);
        await pipelineRef.current?.reloadLocalModel();
    }, []);

    const deleteModel = useCallback(async (id: number) => {
        await focusLabDB.models.delete(id);
        if (getActiveLocalModelId() === id) {
            setActiveLocalModelId(null);
            setActiveModelIdState(null);
            await pipelineRef.current?.reloadLocalModel();
        }
    }, []);

    const doExportCsv = useCallback(async () => {
        try { await exportCsv(); }
        catch (e) { setLabError(e instanceof Error ? e.message : String(e)); }
    }, []);

    const doImportCsv = useCallback(async (file: File) => {
        try {
            const text = await file.text();
            const n = await importCsv(text);
            setLabError(null);
            return n;
        } catch (e) {
            setLabError(e instanceof Error ? e.message : String(e));
            return 0;
        }
    }, []);

    const clearSamples = useCallback(async () => {
        await focusLabDB.samples.clear();
    }, []);

    // 언마운트 시 정리
    useEffect(() => () => { stopMeasure(); }, [stopMeasure]);

    return {
        status, score, scoreSource, labError,
        collectLabel, startCollect, stopCollect, startMeasure, stopMeasure,
        rowCount: rowCount ?? 0,
        focusedCount: focusedCount ?? 0,
        distractedCount: (rowCount ?? 0) - (focusedCount ?? 0),
        training, trainProgress, trainResult, train,
        models: models ?? [], activeModelId, applyModel, deleteModel,
        exportCsv: doExportCsv, importCsv: doImportCsv, clearSamples,
        featureCount: FEATURE_NAMES_V3.length,
        clearLabError: () => setLabError(null),
    };
}
