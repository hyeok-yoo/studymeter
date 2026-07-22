/**
 * image.ts — 브라우저에서 이미지 파일을 다운스케일·압축해 base64 data URL 로 만드는 유틸.
 *
 * 종이 일기 사진처럼 사용자가 올린 원본은 수 MB에 달할 수 있어 IndexedDB 에 그대로
 * 담으면 저장소가 금세 부풀어 오른다. 캔버스로 최대 변 길이를 제한하고 JPEG 로 다시
 * 인코딩해 용량을 크게 줄인 뒤 저장한다. (문서/스캔 가독성을 위해 기본 1600px, 품질 0.82)
 */

export interface CompressOptions {
    /** 긴 변 최대 픽셀. 초과 시 비율 유지하며 축소. */
    maxDimension?: number;
    /** JPEG 품질 0~1. */
    quality?: number;
    /** 결과 MIME. 기본 image/jpeg (사진·스캔에 적합). */
    mimeType?: string;
}

const DEFAULTS: Required<CompressOptions> = {
    maxDimension: 1600,
    quality: 0.82,
    mimeType: 'image/jpeg',
};

/** 파일을 data URL 로 읽는다. */
function readAsDataURL(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.readAsDataURL(file);
    });
}

/** data URL 로부터 HTMLImageElement 를 로드한다. */
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = src;
    });
}

/**
 * 이미지 파일을 다운스케일·재인코딩해 압축된 data URL 을 반환한다.
 * 캔버스/디코딩이 실패하면 원본을 그대로 data URL 로 반환한다(최선 노력).
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<string> {
    const { maxDimension, quality, mimeType } = { ...DEFAULTS, ...opts };
    const original = await readAsDataURL(file);

    // 이미 작은 이미지(수백 KB 미만)거나 캔버스 처리 실패 시 원본 유지.
    try {
        const img = await loadImage(original);
        const longest = Math.max(img.width, img.height);
        const scale = longest > maxDimension ? maxDimension / longest : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return original;
        // 흰 배경(투명 PNG → JPEG 시 검게 변하는 것 방지)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const out = canvas.toDataURL(mimeType, quality);
        // 재인코딩 결과가 오히려 더 크면 원본을 쓴다.
        return out.length < original.length ? out : original;
    } catch {
        return original;
    }
}

/** 여러 파일을 순차 압축. 실패한 항목은 건너뛴다. */
export async function compressImages(files: File[], opts: CompressOptions = {}): Promise<string[]> {
    const out: string[] = [];
    for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        try {
            out.push(await compressImage(f, opts));
        } catch {
            /* skip */
        }
    }
    return out;
}
