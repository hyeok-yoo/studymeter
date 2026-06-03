/**
 * focus/mlClassifier.ts — engine/MLClassifier.kt 의 TS 포트.
 * onnxruntime-web 로 LightGBM(focus_lgbm.onnx) 추론.
 * WASM 런타임은 공식 CDN에서 로드(단일 스레드 — GitHub Pages는 cross-origin isolation 미지원).
 */
import type { InferenceSession } from 'onnxruntime-web';
import { type FeatureVector, featureToArray } from './types';

const ORT_VERSION = '1.26.0';
const ORT_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const N_FEATURES = 14;

// onnxruntime-web 전체(wasm 26MB 포함)를 우리 번들에 넣지 않기 위해,
// 런타임에 CDN ESM 모듈로 동적 로드한다. (end-user 브라우저가 직접 CDN에서 받음)
type OrtModule = typeof import('onnxruntime-web');
let ortPromise: Promise<OrtModule> | null = null;
async function loadOrt(): Promise<OrtModule> {
    if (!ortPromise) {
        ortPromise = (import(/* @vite-ignore */ `${ORT_CDN_BASE}ort.wasm.min.mjs`) as Promise<OrtModule>)
            .then(ort => {
                ort.env.wasm.numThreads = 1; // GitHub Pages는 cross-origin isolation 미지원 → 단일 스레드
                ort.env.wasm.wasmPaths = ORT_CDN_BASE;
                return ort;
            });
    }
    return ortPromise;
}

export class MLClassifier {
    private session: InferenceSession | null = null;
    private inputName = '';
    private imputeMeans: number[] = new Array(N_FEATURES).fill(0);
    private modelUrl: string;
    private imputeUrl: string;

    get isReady(): boolean { return this.session != null; }

    constructor(modelUrl: string, imputeUrl: string) {
        this.modelUrl = modelUrl;
        this.imputeUrl = imputeUrl;
    }

    async load(): Promise<boolean> {
        try {
            const ort = await loadOrt();
            const buf = await (await fetch(this.modelUrl)).arrayBuffer();
            this.session = await ort.InferenceSession.create(new Uint8Array(buf), {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });
            this.inputName = this.session.inputNames[0];
            try {
                const txt = await (await fetch(this.imputeUrl)).text();
                const vals = txt.trim().split(',').map(s => parseFloat(s.trim()));
                if (vals.length === N_FEATURES && vals.every(Number.isFinite)) this.imputeMeans = vals;
            } catch { /* fallback zeros */ }
            return true;
        } catch (e) {
            console.error('MLClassifier load failed', e);
            this.session = null;
            return false;
        }
    }

    /** FeatureVector → 0~100 집중도 점수. 미로드 시 -1. */
    async predictFocusScore(features: FeatureVector): Promise<number> {
        const sess = this.session;
        if (!sess) return -1;
        const arr = featureToArray(features);
        for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) arr[i] = i < this.imputeMeans.length ? this.imputeMeans[i] : 0;
        }
        try {
            const ort = await loadOrt();
            const tensor = new ort.Tensor('float32', arr, [1, N_FEATURES]);
            const results = await sess.run({ [this.inputName]: tensor });
            const score = this.extractProbability(results);
            return Math.min(Math.max(score, 0), 100);
        } catch (e) {
            console.error('MLClassifier inference failed', e);
            return 50;
        }
    }

    /** P(focused=class0) * 100 을 출력에서 추출. ZipMap/Tensor 양쪽 대응. */
    private extractProbability(results: InferenceSession.OnnxValueMapType): number {
        // 확률 출력 후보: 'prob'를 포함하거나, label이 아닌 출력
        const names = Object.keys(results);
        let probName = names.find(n => /prob/i.test(n));
        if (!probName) probName = names.length > 1 ? names[1] : names[0];
        const out = results[probName] as unknown as { data?: ArrayLike<number>; dims?: number[] };

        // 표준 텐서 [1, nClasses]
        if (out && out.data && typeof out.data[0] === 'number') {
            const p0 = out.data[0];
            return p0 * 100;
        }
        // ZipMap (sequence of map) → onnxruntime-web 에서는 배열 형태
        const raw = results[probName] as unknown;
        if (Array.isArray(raw) && raw.length > 0) {
            const first = raw[0];
            if (first instanceof Map) {
                const v = first.get(0) ?? first.get('0') ?? first.values().next().value;
                if (typeof v === 'number') return v * 100;
            } else if (first && typeof first === 'object') {
                const obj = first as Record<string, number>;
                const v = obj['0'] ?? Object.values(obj)[0];
                if (typeof v === 'number') return v * 100;
            }
        }
        return 50;
    }

    close(): void {
        this.session = null;
    }
}
