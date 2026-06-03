/**
 * focus/rppgExtractor.ts — core/RPPGExtractor.kt 의 TS 포트.
 * 이마(w=2) + 좌/우 뺨(w=1) ROI 평균 RGB 추출.
 * OpenCV fillPoly+mean 대신, ImageData 위에서 폴리곤 내부 픽셀을 평균낸다.
 */
import type { RPPGSample } from './types';

const FOREHEAD_IDX = [67, 109, 10, 338, 297, 299, 151, 69];
const RIGHT_CHEEK_IDX = [116, 123, 147, 213, 192, 207, 117];
const LEFT_CHEEK_IDX = [345, 352, 376, 433, 416, 427, 346];

export class RPPGExtractor {
    private minRoiPixels: number;
    constructor(minRoiPixels = 50) { this.minRoiPixels = minRoiPixels; }

    processWithImageData(img: ImageData, landmarks: Float32Array, nowMs: number): RPPGSample {
        if (landmarks.length < 478 * 2) {
            return { timestampMs: nowMs, foreheadRGB: null, rightCheekRGB: null, leftCheekRGB: null };
        }
        return {
            timestampMs: nowMs,
            foreheadRGB: this.extractRoi(img, landmarks, FOREHEAD_IDX),
            rightCheekRGB: this.extractRoi(img, landmarks, RIGHT_CHEEK_IDX),
            leftCheekRGB: this.extractRoi(img, landmarks, LEFT_CHEEK_IDX),
        };
    }

    private extractRoi(img: ImageData, lm: Float32Array, indices: number[]): number[] | null {
        const w = img.width, h = img.height;
        const px: number[] = new Array(indices.length);
        const py: number[] = new Array(indices.length);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < indices.length; i++) {
            const ix = indices[i];
            const X = lm[ix * 2] * w;
            const Y = lm[ix * 2 + 1] * h;
            px[i] = X; py[i] = Y;
            if (X < minX) minX = X; if (X > maxX) maxX = X;
            if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
        }
        const x0 = Math.max(0, Math.floor(minX));
        const x1 = Math.min(w - 1, Math.ceil(maxX));
        const y0 = Math.max(0, Math.floor(minY));
        const y1 = Math.min(h - 1, Math.ceil(maxY));
        if (x0 >= x1 || y0 >= y1) return null;

        const data = img.data;
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (!pointInPolygon(x + 0.5, y + 0.5, px, py)) continue;
                const o = (y * w + x) * 4;
                sumR += data[o]; sumG += data[o + 1]; sumB += data[o + 2];
                count++;
            }
        }
        if (count < this.minRoiPixels) return null;
        return [sumR / count, sumG / count, sumB / count];
    }
}

/** even-odd ray casting */
function pointInPolygon(x: number, y: number, px: number[], py: number[]): boolean {
    let inside = false;
    const n = px.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = px[i], yi = py[i], xj = px[j], yj = py[j];
        const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}
