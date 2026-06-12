/**
 * focus/localData.ts — 온디바이스 수집 데이터·학습 모델 저장소 (Dexie).
 *
 * 메인 앱 DB(lib/db.ts)와 분리된 독립 DB — 학습 데이터 양이 많아도
 * 앱 데이터 백업/마이그레이션에 영향을 주지 않는다.
 *
 * CSV는 focus_v2 v3 형식(engine/data_collector.py _COLUMNS)과 컬럼 호환 —
 * 내보낸 파일을 PC 백엔드 학습(train_from_csv)에 그대로 쓸 수 있다.
 */
import Dexie, { type Table } from 'dexie';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CSV_COLUMNS, FEATURE_NAMES_V3, featureVectorToRecord } from './featureNames';
import type { FeatureVector } from './types';
import type { LocalModelPayload } from './localModel';

export interface CollectedSample {
    id?: number;
    /** epoch 초 (Python time.time()과 동일 단위 — CSV timestamp 컬럼) */
    ts: number;
    windowS: number;
    label: 0 | 1;
    focusScore: number;
    hrvNBeats: number;
    /** v3 정규 이름(snake_case) → 값. 없는 피처는 NaN. */
    features: Record<string, number>;
}

export interface StoredModel {
    id?: number;
    name: string;
    createdAt: number; // epoch ms
    valAccuracy: number;
    valF1: number;
    nSamples: number;
    payload: LocalModelPayload;
}

class FocusLabDB extends Dexie {
    samples!: Table<CollectedSample, number>;
    models!: Table<StoredModel, number>;

    constructor() {
        super('StudyMeterFocusLab');
        this.version(1).stores({
            samples: '++id, ts, label',
            models: '++id, createdAt, name',
        });
    }
}

export const focusLabDB = new FocusLabDB();

/** 적용 중인 로컬 모델 id (localStorage). null이면 미적용. */
const ACTIVE_MODEL_KEY = 'sm_local_model_active';

export function getActiveLocalModelId(): number | null {
    const v = localStorage.getItem(ACTIVE_MODEL_KEY);
    if (v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
}

export function setActiveLocalModelId(id: number | null): void {
    if (id == null) localStorage.removeItem(ACTIVE_MODEL_KEY);
    else localStorage.setItem(ACTIVE_MODEL_KEY, String(id));
}

export async function loadActiveLocalModel(): Promise<StoredModel | null> {
    const id = getActiveLocalModelId();
    if (id == null) return null;
    const m = await focusLabDB.models.get(id);
    if (!m) setActiveLocalModelId(null); // 삭제된 모델 참조 정리
    return m ?? null;
}

/** FeatureVector + 라벨 → 수집 행 추가. */
export async function addSample(f: FeatureVector, label: 0 | 1, focusScore: number): Promise<void> {
    await focusLabDB.samples.add({
        ts: Date.now() / 1000,
        windowS: 10,
        label,
        focusScore,
        hrvNBeats: Number.isFinite(f.hrvNBeats) ? f.hrvNBeats : 0,
        features: featureVectorToRecord(f),
    });
}

// ── CSV 입출력 ────────────────────────────────────────────────────────────────

function numToCsv(v: number | undefined): string {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'nan';
    return String(v);
}

/** 전체 수집 데이터 → v3 CSV 문자열. */
export async function buildCsv(): Promise<{ csv: string; rows: number }> {
    const samples = await focusLabDB.samples.orderBy('ts').toArray();
    const lines = [CSV_COLUMNS.join(',')];
    for (const s of samples) {
        const cells = CSV_COLUMNS.map(col => {
            switch (col) {
                case 'timestamp': return numToCsv(s.ts);
                case 'window_s': return numToCsv(s.windowS);
                case 'hrv_n_beats': return numToCsv(s.hrvNBeats);
                case 'focus_score': return numToCsv(s.focusScore);
                case 'label': return String(s.label);
                default: return numToCsv(s.features[col]);
            }
        });
        lines.push(cells.join(','));
    }
    return { csv: lines.join('\n') + '\n', rows: samples.length };
}

/** CSV 내보내기 — 네이티브: Share 시트 / 웹: Blob 다운로드 (backup.ts 패턴). */
export async function exportCsv(): Promise<number> {
    const { csv, rows } = await buildCsv();
    if (rows === 0) throw new Error('내보낼 수집 데이터가 없습니다');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `training_v3_app_${stamp}.csv`;

    if (Capacitor.isNativePlatform()) {
        const result = await Filesystem.writeFile({
            path: fileName,
            data: csv,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });
        await Share.share({
            title: 'StudyMeter 학습 데이터',
            text: `집중도 학습 데이터 CSV (${rows}행, v3 24피처)`,
            url: result.uri,
            dialogTitle: 'CSV 저장/전송',
        });
    } else {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return rows;
}

/** CSV 가져오기 (v2 14피처/v3 24피처 모두 이름 기반 수용). 추가된 행수 반환. */
export async function importCsv(text: string): Promise<number> {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error('CSV에 데이터 행이 없습니다');
    const header = lines[0].split(',').map(h => h.trim());
    const labelIdx = header.indexOf('label');
    if (labelIdx < 0) throw new Error('label 컬럼이 없습니다');

    const rows: CollectedSample[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',');
        if (cells.length !== header.length) continue;
        const get = (name: string): number => {
            const idx = header.indexOf(name);
            if (idx < 0) return NaN;
            const v = parseFloat(cells[idx]);
            return Number.isFinite(v) ? v : NaN;
        };
        const labelRaw = parseInt(cells[labelIdx], 10);
        if (labelRaw !== 0 && labelRaw !== 1) continue;
        const features: Record<string, number> = {};
        for (const nm of FEATURE_NAMES_V3) features[nm] = get(nm);
        rows.push({
            ts: Number.isFinite(get('timestamp')) ? get('timestamp') : Date.now() / 1000,
            windowS: Number.isFinite(get('window_s')) ? get('window_s') : 10,
            label: labelRaw,
            focusScore: Number.isFinite(get('focus_score')) ? get('focus_score') : NaN,
            hrvNBeats: Number.isFinite(get('hrv_n_beats')) ? get('hrv_n_beats') : 0,
            features,
        });
    }
    if (rows.length === 0) throw new Error('가져올 수 있는 유효한 행이 없습니다');
    await focusLabDB.samples.bulkAdd(rows);
    return rows.length;
}
