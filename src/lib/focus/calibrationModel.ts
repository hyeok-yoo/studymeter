/**
 * focus/calibrationModel.ts — core/CalibrationModel.kt 의 TS 포트.
 *
 * MediaPipe FaceLandmarker(refine=true, 478 랜드마크)에서
 *  - 헤드포즈에 강건한 2D 시선 특징 추출 (extractGazeFeature)
 *  - EAR(눈 개폐) 계산 (computeMeanEar)
 *  - 시선 특징 → 화면 좌표 매핑 (apply)
 *
 * 웹에는 별도 캘리브레이션 UI가 아직 없으므로, 호모그래피가 없을 때는
 * identity 스케일(fx*W, fy*H)로 매핑해 시선 동역학(분산/사케이드)을 보존한다.
 * (네이티브는 미보정 시 화면 중앙 고정 — 웹 데모에서는 의미 있는 신호가 필요해 다르게 처리)
 */

const RIGHT_IRIS = [468, 469, 470, 471, 472];
const LEFT_IRIS = [473, 474, 475, 476, 477];
const R_CORNER_OUT = 33, R_CORNER_IN = 133;
const L_CORNER_IN = 362, L_CORNER_OUT = 263;
const R_EYE_TOP = 159, R_EYE_BOT = 145;
const L_EYE_TOP = 386, L_EYE_BOT = 374;
const RIGHT_EAR_IDX = [33, 160, 158, 133, 153, 144];
const LEFT_EAR_IDX = [362, 385, 387, 263, 373, 380];

const PREF_KEY_H = 'focus_web_homography';

export class CalibrationModel {
    private homography: number[] | null = null;
    screenWidth: number;
    screenHeight: number;

    constructor(screenWidth: number, screenHeight: number) {
        this.screenWidth = screenWidth;
        this.screenHeight = screenHeight;
    }

    get isReady(): boolean { return this.homography != null; }

    static load(screenW: number, screenH: number): CalibrationModel {
        const m = new CalibrationModel(screenW, screenH);
        try {
            const str = localStorage.getItem(PREF_KEY_H);
            if (str) {
                const vals = str.split(',').map(Number);
                if (vals.length === 9 && vals.every(Number.isFinite)) m.homography = vals;
            }
        } catch { /* ignore */ }
        return m;
    }

    /** 시선 특징(fx,fy) → 화면 픽셀 좌표. */
    apply(fx: number, fy: number): [number, number] {
        const h = this.homography;
        if (!h) {
            // 미보정: identity 스케일 (동역학 보존)
            return [fx * this.screenWidth, fy * this.screenHeight];
        }
        const w = h[6] * fx + h[7] * fy + h[8];
        if (Math.abs(w) < 1e-6) return [this.screenWidth / 2, this.screenHeight / 2];
        return [
            (h[0] * fx + h[1] * fy + h[2]) / w,
            (h[3] * fx + h[4] * fy + h[5]) / w,
        ];
    }

    /** 478*2 flat 랜드마크에서 2D 시선 특징 추출. 실패 시 null. */
    extractGazeFeature(lm: Float32Array): [number, number] | null {
        if (lm.length < 478 * 2) return null;
        const x = (i: number) => lm[i * 2];
        const y = (i: number) => lm[i * 2 + 1];
        const norm = (v: number, a: number, b: number): number | null => {
            const lo = Math.min(a, b), hi = Math.max(a, b);
            const span = hi - lo;
            if (span < 1e-6) return null;
            return (v - lo) / span;
        };
        const meanX = (idx: number[]) => idx.reduce((s, i) => s + x(i), 0) / idx.length;
        const meanY = (idx: number[]) => idx.reduce((s, i) => s + y(i), 0) / idx.length;

        const rIrisX = meanX(RIGHT_IRIS), rIrisY = meanY(RIGHT_IRIS);
        const lIrisX = meanX(LEFT_IRIS), lIrisY = meanY(LEFT_IRIS);

        const rx = norm(rIrisX, x(R_CORNER_OUT), x(R_CORNER_IN));
        const ry = norm(rIrisY, y(R_EYE_TOP), y(R_EYE_BOT));
        const lx = norm(lIrisX, x(L_CORNER_IN), x(L_CORNER_OUT));
        const ly = norm(lIrisY, y(L_EYE_TOP), y(L_EYE_BOT));
        if (rx == null || ry == null || lx == null || ly == null) return null;

        return [(rx + lx) / 2, (ry + ly) / 2];
    }

    /** EAR 계산. lm: 478*2 flat. */
    computeMeanEar(lm: Float32Array): number {
        if (lm.length < 478 * 2) return NaN;
        const single = (idx: number[]): number => {
            const pt = (k: number): [number, number] => [lm[idx[k] * 2], lm[idx[k] * 2 + 1]];
            const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
            const vert1 = dist(pt(1), pt(5));
            const vert2 = dist(pt(2), pt(4));
            const horiz = dist(pt(0), pt(3));
            if (horiz < 1e-6) return NaN;
            return (vert1 + vert2) / (2 * horiz);
        };
        const r = single(RIGHT_EAR_IDX);
        const l = single(LEFT_EAR_IDX);
        const valid = [r, l].filter(Number.isFinite);
        if (valid.length === 0) return NaN;
        return valid.reduce((a, b) => a + b, 0) / valid.length;
    }
}
