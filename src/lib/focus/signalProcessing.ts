/**
 * focus/signalProcessing.ts — utils/SignalProcessing.kt 의 TS 포트.
 * rPPG 펄스 추출(POS/CHROM) + 밴드패스 + FFT 심박/HRV 계산.
 * Apache commons FFT 대신 자체 radix-2 Cooley-Tukey FFT를 사용한다.
 */
import { type HRVMetrics, emptyHRV } from './types';

const HR_LOW_HZ = 0.7;
const HR_HIGH_HZ = 4.0;

function std(arr: number[] | Float32Array): number {
    if (arr.length < 2) return 0;
    let mean = 0;
    for (let i = 0; i < arr.length; i++) mean += arr[i];
    mean /= arr.length;
    let s = 0;
    for (let i = 0; i < arr.length; i++) { const d = arr[i] - mean; s += d * d; }
    return Math.sqrt(s / arr.length);
}

function avg(arr: number[] | Float32Array): number {
    if (arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function nextPow2(n: number): number {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

/** In-place iterative radix-2 FFT. re/im length must be power of 2. */
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curR = 1, curI = 0;
            for (let k = 0; k < len / 2; k++) {
                const aR = re[i + k];
                const aI = im[i + k];
                const bR = re[i + k + len / 2] * curR - im[i + k + len / 2] * curI;
                const bI = re[i + k + len / 2] * curI + im[i + k + len / 2] * curR;
                re[i + k] = aR + bR;
                im[i + k] = aI + bI;
                re[i + k + len / 2] = aR - bR;
                im[i + k + len / 2] = aI - bI;
                const nextR = curR * wr - curI * wi;
                curI = curR * wi + curI * wr;
                curR = nextR;
            }
        }
    }
}

/** magnitude spectrum (length n/2+1) of a real signal padded to nfft. */
function magnitudeSpectrum(signal: number[], nfft: number): Float64Array {
    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);
    for (let i = 0; i < signal.length && i < nfft; i++) re[i] = signal[i];
    fft(re, im);
    const half = (nfft >> 1) + 1;
    const mags = new Float64Array(half);
    for (let i = 0; i < half; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return mags;
}

// ── POS (Wang et al. 2017) ──────────────────────────────────────────────────
export function posMethod(rgb: number[][], fs: number, windowSeconds = 1.6): Float32Array {
    const N = rgb.length;
    if (N < 2) return new Float32Array(N);
    const L = Math.min(Math.max(Math.trunc(windowSeconds * fs), 32), N);
    if (N < L) {
        const g = new Float32Array(N);
        for (let i = 0; i < N; i++) g[i] = rgb[i][1];
        const mean = avg(g);
        for (let i = 0; i < N; i++) g[i] -= mean;
        return g;
    }
    const H = new Float32Array(N);
    for (let n = L; n <= N; n++) {
        const mu = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let i = 0; i < L; i++) s += rgb[n - L + i][c];
            mu[c] = s / L;
        }
        const s1 = new Float32Array(L);
        const s2 = new Float32Array(L);
        for (let i = 0; i < L; i++) {
            const cn = [0, 0, 0];
            for (let c = 0; c < 3; c++) {
                const m = Math.abs(mu[c]) < 1e-9 ? 1e-9 : mu[c];
                cn[c] = rgb[n - L + i][c] / m - 1;
            }
            s1[i] = cn[1] - cn[2];
            s2[i] = -2 * cn[0] + cn[1] + cn[2];
        }
        const sig1 = std(s1);
        const sig2 = std(s2);
        const alpha = sig2 > 1e-9 ? sig1 / sig2 : 1;
        const h = new Float32Array(L);
        for (let i = 0; i < L; i++) h[i] = s1[i] + alpha * s2[i];
        const hm = avg(h);
        for (let i = 0; i < L; i++) H[n - L + i] += h[i] - hm;
    }
    return H;
}

// ── CHROM (De Haan & Jeanne 2013) ────────────────────────────────────────────
export function chromMethod(rgb: number[][], fs: number): Float32Array {
    const N = rgb.length;
    if (N < 8) return new Float32Array(N);
    const mu = [0, 0, 0];
    for (let c = 0; c < 3; c++) { let s = 0; for (let i = 0; i < N; i++) s += rgb[i][c]; mu[c] = s / N; }
    const X = new Float32Array(N);
    const Y = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const rn = [0, 0, 0];
        for (let c = 0; c < 3; c++) { const m = Math.abs(mu[c]) < 1e-9 ? 1e-9 : mu[c]; rn[c] = rgb[i][c] / m; }
        X[i] = 3 * rn[0] - 2 * rn[1];
        Y[i] = 1.5 * rn[0] + rn[1] - 1.5 * rn[2];
    }
    const Xf = bandpassIIR(X, fs);
    const Yf = bandpassIIR(Y, fs);
    const sx = std(Xf);
    const sy = std(Yf);
    const alpha = sy > 1e-9 ? sx / sy : 1;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = Xf[i] - alpha * Yf[i];
    return out;
}

// ── Bandpass IIR (zero-phase, 1차 HP + 1차 LP forward/backward) ────────────────
export function bandpassIIR(x: Float32Array, fs: number, lowHz = HR_LOW_HZ, highHz = HR_HIGH_HZ): Float32Array {
    if (x.length < 8) return x.slice();
    const Ts = 1 / fs;
    const rcHp = 1 / (2 * Math.PI * lowHz);
    const alphaHp = rcHp / (rcHp + Ts);
    const rcLp = 1 / (2 * Math.PI * highHz);
    const alphaLp = Ts / (rcLp + Ts);

    const hp = new Float32Array(x.length);
    let yPrev = 0;
    let xPrev = x[0];
    for (let i = 0; i < x.length; i++) {
        yPrev = alphaHp * (yPrev + x[i] - xPrev);
        xPrev = x[i];
        hp[i] = yPrev;
    }
    const lp = new Float32Array(hp.length);
    let lpPrev = hp[0];
    for (let i = 0; i < hp.length; i++) {
        lpPrev = alphaLp * hp[i] + (1 - alphaLp) * lpPrev;
        lp[i] = lpPrev;
    }
    const lpR = new Float32Array(lp.length);
    let lpRevPrev = lp[lp.length - 1];
    for (let i = lp.length - 1; i >= 0; i--) {
        lpRevPrev = alphaLp * lp[i] + (1 - alphaLp) * lpRevPrev;
        lpR[i] = lpRevPrev;
    }
    return lpR;
}

// ── FFT 기반 심박수 추정 ───────────────────────────────────────────────────────
export function estimateHeartRateBpm(
    signal: Float32Array, fs: number,
    hrMinBpm = 42, hrMaxBpm = 180, minSnr = 0
): number {
    if (signal.length < 16) return NaN;
    const x: number[] = new Array(signal.length);
    let mean = 0;
    for (let i = 0; i < signal.length; i++) mean += signal[i];
    mean /= signal.length;
    for (let i = 0; i < signal.length; i++) x[i] = signal[i] - mean;

    const nfft = Math.max(nextPow2(Math.max(signal.length, Math.trunc(fs * 30))), 2048);
    const mags = magnitudeSpectrum(x, nfft);
    const freqRes = fs / nfft;

    const idxMin = Math.max(Math.trunc(hrMinBpm / 60 / freqRes), 1);
    const idxMax = Math.min(Math.trunc(hrMaxBpm / 60 / freqRes), mags.length - 1);
    if (idxMin >= idxMax) return NaN;

    let peakLocalIdx = 0;
    let peakVal = -Infinity;
    for (let i = idxMin; i <= idxMax; i++) {
        if (mags[i] > peakVal) { peakVal = mags[i]; peakLocalIdx = i - idxMin; }
    }
    if (minSnr > 0) {
        const bg: number[] = [];
        for (let i = 0; i <= idxMax - idxMin; i++) {
            if (Math.abs(i - peakLocalIdx) > 1) bg.push(mags[idxMin + i]);
        }
        if (bg.length > 0) {
            bg.sort((a, b) => a - b);
            const m = bg.length >> 1;
            const bgMedian = bg.length % 2 === 0 ? (bg[m - 1] + bg[m]) / 2 : bg[m];
            if (peakVal / (bgMedian + 1e-12) < minSnr) return NaN;
        }
    }
    return (idxMin + peakLocalIdx) * freqRes * 60;
}

// ── 피크 검출 (단순 threshold-crossing) ─────────────────────────────────────────
export function detectPeaks(signal: Float32Array, fs: number, hrMaxBpm = 180): number[] {
    if (signal.length < 8) return [];
    const minDist = Math.max(Math.trunc((fs * 60) / hrMaxBpm), 1);
    const peaks: number[] = [];
    for (let i = 1; i < signal.length - 1; i++) {
        if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
            if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) peaks.push(i);
        }
    }
    return peaks;
}

// ── HRV 지표 ──────────────────────────────────────────────────────────────────
export function rmssd(rriMs: number[]): number {
    if (rriMs.length < 2) return NaN;
    let s = 0;
    for (let i = 0; i < rriMs.length - 1; i++) { const d = rriMs[i + 1] - rriMs[i]; s += d * d; }
    return Math.sqrt(s / (rriMs.length - 1));
}

export function sdnn(rriMs: number[]): number {
    if (rriMs.length < 2) return NaN;
    const mean = avg(rriMs);
    let s = 0;
    for (let i = 0; i < rriMs.length; i++) { const d = rriMs[i] - mean; s += d * d; }
    return Math.sqrt(s / (rriMs.length - 1));
}

function interp(x: number, xs: number[], ys: number[]): number {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = xs.findIndex(v => v >= x);
    if (i < 1) i = 1;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

export function lfHfPower(rriMs: number[], fsResample = 4): [number, number, number] {
    if (rriMs.length < 4) return [NaN, NaN, NaN];
    const rriS = rriMs.map(v => v / 1000);
    const t: number[] = new Array(rriS.length);
    let cum = 0;
    for (let i = 0; i < rriS.length; i++) { cum += rriS[i]; t[i] = cum; }
    const tUni: number[] = [];
    for (let v = t[0]; v <= t[t.length - 1]; v += 1 / fsResample) tUni.push(v);
    if (tUni.length < 16) return [NaN, NaN, NaN];
    const rriUni = tUni.map(v => interp(v, t, rriS));
    const uniMean = avg(rriUni);
    for (let i = 0; i < rriUni.length; i++) rriUni[i] -= uniMean;

    const nfft = nextPow2(rriUni.length);
    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);
    for (let i = 0; i < rriUni.length; i++) re[i] = rriUni[i];
    fft(re, im);
    const half = (nfft >> 1) + 1;
    const mags = new Float64Array(half);
    for (let i = 0; i < half; i++) mags[i] = (re[i] * re[i] + im[i] * im[i]) / nfft;
    const freqRes = fsResample / nfft;

    const bandPow = (lo: number, hi: number): number => {
        const i0 = Math.max(Math.trunc(lo / freqRes), 0);
        const i1 = Math.min(Math.trunc(hi / freqRes), mags.length - 1);
        if (i0 >= i1) return 0;
        let s = 0;
        for (let i = i0; i < i1; i++) s += ((mags[i] + mags[i + 1]) * freqRes) / 2;
        return s;
    };
    const lf = bandPow(0.04, 0.15);
    const hf = bandPow(0.15, 0.40);
    const ratio = hf > 1e-12 ? lf / hf : NaN;
    return [lf, hf, ratio];
}

// ── 전체 HRV 파이프라인 ─────────────────────────────────────────────────────────
export function computeHrv(rgbSeries: number[][], fs: number, method: 'pos' | 'chrom' = 'pos', minSnr = 1.5): HRVMetrics {
    const pulse = method === 'pos' ? posMethod(rgbSeries, fs) : chromMethod(rgbSeries, fs);
    const filtered = bandpassIIR(pulse, fs);
    const bpm = estimateHeartRateBpm(filtered, fs, 42, 180, minSnr);
    const peaks = detectPeaks(filtered, fs);
    if (!Number.isFinite(bpm)) {
        return { ...emptyHRV(), nBeats: peaks.length };
    }
    if (peaks.length < 3) {
        return { bpm, rmssdMs: NaN, sdnnMs: NaN, lfPower: NaN, hfPower: NaN, lfHfRatio: NaN, nBeats: peaks.length };
    }
    const rri: number[] = new Array(peaks.length - 1);
    for (let i = 0; i < peaks.length - 1; i++) rri[i] = ((peaks[i + 1] - peaks[i]) * 1000) / fs;
    const [lf, hf, ratio] = lfHfPower(rri);
    return { bpm, rmssdMs: rmssd(rri), sdnnMs: sdnn(rri), lfPower: lf, hfPower: hf, lfHfRatio: ratio, nBeats: peaks.length };
}
