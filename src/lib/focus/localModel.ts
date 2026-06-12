/**
 * focus/localModel.ts — 온디바이스 학습기 (순수 TypeScript, 외부 의존성 없음).
 *
 * 모델: 표준화 → 1-히든레이어 MLP(tanh 16유닛) → 시그모이드 P(산만).
 * 24피처 × 수천 행 규모는 Snapdragon 8 Gen 2에서 1초 내 학습된다.
 *
 * 설계 원칙 (focus_v2 분류기와 동일 철학):
 *  - 피처는 이름 기반 매핑 — 없는 피처(예: 헤드포즈)는 NaN → 학습 데이터 열 평균 대치.
 *  - 전처리 파라미터(대치값·평균·표준편차)를 가중치와 함께 직렬화해 추론 시 재사용.
 *  - 검증 분할은 클래스별 시간순 뒤 20% — 인접 윈도우 90% 중첩 누수를 줄이면서
 *    검증셋에 양 클래스를 보장한다 (랜덤 분할은 누수로 val acc 과대평가).
 */
import { FEATURE_NAMES_V3 } from './featureNames';

export interface LocalModelPayload {
    version: 1;
    featureNames: string[];
    imputeMeans: number[];
    means: number[];
    stds: number[];
    hidden: number;
    /** W1[hidden][nFeat], b1[hidden], W2[hidden], b2 */
    W1: number[][];
    b1: number[];
    W2: number[];
    b2: number;
}

export interface TrainProgress {
    epoch: number;
    totalEpochs: number;
    loss: number;
}

export interface TrainOutcome {
    payload: LocalModelPayload;
    valAccuracy: number;
    valF1: number;
    nTrain: number;
    nVal: number;
}

// 재현 가능한 PRNG (mulberry32)
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }

/** 이름 기반 레코드 → 피처 행렬 행 (없는 키/비유한값은 NaN). */
function recordToRow(rec: Record<string, number>, names: string[]): number[] {
    return names.map(n => {
        const v = rec[n];
        return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    });
}

/**
 * 학습. rows는 시간순 정렬 가정 (수집 순서 = 삽입 순서).
 * yieldEvery 에폭마다 이벤트 루프에 양보해 UI 블로킹을 방지한다.
 */
export async function trainLocalModel(
    records: Record<string, number>[],
    labels: (0 | 1)[],
    opts?: {
        hidden?: number; epochs?: number; lr?: number; batchSize?: number;
        seed?: number; onProgress?: (p: TrainProgress) => void;
    },
): Promise<TrainOutcome> {
    const names = [...FEATURE_NAMES_V3];
    const hidden = opts?.hidden ?? 16;
    const epochs = opts?.epochs ?? 150;
    const lr = opts?.lr ?? 0.01;
    const batchSize = opts?.batchSize ?? 32;
    const rand = mulberry32(opts?.seed ?? 42);

    const n = records.length;
    if (n < 40) throw new Error(`데이터가 부족합니다 (${n}행 — 최소 40행 필요)`);
    const X = records.map(r => recordToRow(r, names));
    const y = labels.map(Number);
    if (!y.includes(0) || !y.includes(1)) {
        throw new Error('집중(0)과 산만(1) 라벨이 모두 필요합니다');
    }

    // 검증 분할: 클래스별 시간순 뒤 20% (누수 완화 + 양 클래스 보장)
    const valIdx = new Set<number>();
    for (const cls of [0, 1]) {
        const idxs = y.map((v, i) => (v === cls ? i : -1)).filter(i => i >= 0);
        const nVal = Math.max(1, Math.floor(idxs.length * 0.2));
        for (const i of idxs.slice(idxs.length - nVal)) valIdx.add(i);
    }
    const trIdx = X.map((_, i) => i).filter(i => !valIdx.has(i));

    // 전처리 파라미터는 train 분할에서만 추정 (val 누수 방지)
    const nF = names.length;
    const imputeMeans = new Array<number>(nF).fill(0);
    const means = new Array<number>(nF).fill(0);
    const stds = new Array<number>(nF).fill(1);
    for (let j = 0; j < nF; j++) {
        const vals = trIdx.map(i => X[i][j]).filter(Number.isFinite);
        imputeMeans[j] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const filled = trIdx.map(i => (Number.isFinite(X[i][j]) ? X[i][j] : imputeMeans[j]));
        const m = filled.reduce((a, b) => a + b, 0) / filled.length;
        const v = filled.reduce((a, b) => a + (b - m) * (b - m), 0) / filled.length;
        means[j] = m;
        stds[j] = Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1;
    }
    const prep = (row: number[]) =>
        row.map((v, j) => ((Number.isFinite(v) ? v : imputeMeans[j]) - means[j]) / stds[j]);
    const Xp = X.map(prep);

    // 클래스 가중치 (balanced)
    const n1 = trIdx.filter(i => y[i] === 1).length;
    const n0 = trIdx.length - n1;
    const w0 = trIdx.length / (2 * Math.max(n0, 1));
    const w1 = trIdx.length / (2 * Math.max(n1, 1));

    // 파라미터 초기화 (Xavier)
    const W1 = Array.from({ length: hidden }, () =>
        Array.from({ length: nF }, () => (rand() * 2 - 1) * Math.sqrt(6 / (nF + hidden))));
    const b1 = new Array<number>(hidden).fill(0);
    const W2 = Array.from({ length: hidden }, () => (rand() * 2 - 1) * Math.sqrt(6 / (hidden + 1)));
    let b2 = 0;

    // Adam 상태
    const zeros2 = () => Array.from({ length: hidden }, () => new Array<number>(nF).fill(0));
    const mW1 = zeros2(), vW1 = zeros2();
    const mb1 = new Array<number>(hidden).fill(0), vb1 = new Array<number>(hidden).fill(0);
    const mW2 = new Array<number>(hidden).fill(0), vW2 = new Array<number>(hidden).fill(0);
    let mb2 = 0, vb2 = 0;
    const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
    let adamT = 0;

    const forward = (x: number[]): { h: number[]; p: number } => {
        const h = new Array<number>(hidden);
        for (let k = 0; k < hidden; k++) {
            let z = b1[k];
            const w = W1[k];
            for (let j = 0; j < nF; j++) z += w[j] * x[j];
            h[k] = Math.tanh(z);
        }
        let z2 = b2;
        for (let k = 0; k < hidden; k++) z2 += W2[k] * h[k];
        return { h, p: sigmoid(z2) };
    };

    const order = [...trIdx];
    for (let epoch = 0; epoch < epochs; epoch++) {
        // Fisher–Yates 셔플
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        let epochLoss = 0;
        for (let s = 0; s < order.length; s += batchSize) {
            const batch = order.slice(s, s + batchSize);
            const gW1 = zeros2();
            const gb1 = new Array<number>(hidden).fill(0);
            const gW2 = new Array<number>(hidden).fill(0);
            let gb2 = 0;
            for (const i of batch) {
                const x = Xp[i];
                const { h, p } = forward(x);
                const w = y[i] === 1 ? w1 : w0;
                const pc = Math.min(Math.max(p, 1e-7), 1 - 1e-7);
                epochLoss += -w * (y[i] * Math.log(pc) + (1 - y[i]) * Math.log(1 - pc));
                const dz2 = w * (p - y[i]); // BCE+시그모이드 결합 기울기
                gb2 += dz2;
                for (let k = 0; k < hidden; k++) {
                    gW2[k] += dz2 * h[k];
                    const dh = dz2 * W2[k] * (1 - h[k] * h[k]); // tanh'
                    gb1[k] += dh;
                    const gw = gW1[k];
                    for (let j = 0; j < nF; j++) gw[j] += dh * x[j];
                }
            }
            // Adam 업데이트
            adamT++;
            const c1 = 1 - Math.pow(beta1, adamT), c2 = 1 - Math.pow(beta2, adamT);
            const bs = batch.length;
            const step = (g: number, m: number, v: number): [number, number, number] => {
                const gn = g / bs;
                const nm = beta1 * m + (1 - beta1) * gn;
                const nv = beta2 * v + (1 - beta2) * gn * gn;
                return [lr * (nm / c1) / (Math.sqrt(nv / c2) + eps), nm, nv];
            };
            for (let k = 0; k < hidden; k++) {
                for (let j = 0; j < nF; j++) {
                    const [d, nm, nv] = step(gW1[k][j], mW1[k][j], vW1[k][j]);
                    W1[k][j] -= d; mW1[k][j] = nm; vW1[k][j] = nv;
                }
                {
                    const [d, nm, nv] = step(gb1[k], mb1[k], vb1[k]);
                    b1[k] -= d; mb1[k] = nm; vb1[k] = nv;
                }
                {
                    const [d, nm, nv] = step(gW2[k], mW2[k], vW2[k]);
                    W2[k] -= d; mW2[k] = nm; vW2[k] = nv;
                }
            }
            {
                const [d, nm, nv] = step(gb2, mb2, vb2);
                b2 -= d; mb2 = nm; vb2 = nv;
            }
        }
        opts?.onProgress?.({ epoch: epoch + 1, totalEpochs: epochs, loss: epochLoss / order.length });
        if ((epoch + 1) % 10 === 0) await new Promise(r => setTimeout(r, 0)); // UI 양보
    }

    // 검증 지표
    let tp = 0, fp = 0, fn = 0, correct = 0;
    for (const i of valIdx) {
        const { p } = forward(Xp[i]);
        const pred = p >= 0.5 ? 1 : 0;
        if (pred === y[i]) correct++;
        if (pred === 1 && y[i] === 1) tp++;
        if (pred === 1 && y[i] === 0) fp++;
        if (pred === 0 && y[i] === 1) fn++;
    }
    const valAccuracy = valIdx.size ? correct / valIdx.size : NaN;
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
    const valF1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;

    return {
        payload: {
            version: 1, featureNames: names, imputeMeans, means, stds,
            hidden, W1, b1, W2, b2,
        },
        valAccuracy, valF1,
        nTrain: trIdx.length, nVal: valIdx.size,
    };
}

/** 직렬화된 로컬 모델의 추론 러너. */
export class LocalModelRunner {
    private payload: LocalModelPayload;

    constructor(payload: LocalModelPayload) {
        this.payload = payload;
    }

    /** 이름 기반 레코드 → P(산만). */
    predictDistractProba(rec: Record<string, number>): number {
        const { featureNames, imputeMeans, means, stds, hidden, W1, b1, W2, b2 } = this.payload;
        const x = featureNames.map((nm, j) => {
            const raw = rec[nm];
            const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : imputeMeans[j];
            return (v - means[j]) / stds[j];
        });
        let z2 = b2;
        for (let k = 0; k < hidden; k++) {
            let z = b1[k];
            const w = W1[k];
            for (let j = 0; j < x.length; j++) z += w[j] * x[j];
            z2 += W2[k] * Math.tanh(z);
        }
        return sigmoid(z2);
    }

    /** 0~100 집중 점수 (focus_v2 predict_focus_score와 동일 규약: 높을수록 집중). */
    predictFocusScore(rec: Record<string, number>): number {
        return (1 - this.predictDistractProba(rec)) * 100;
    }
}
