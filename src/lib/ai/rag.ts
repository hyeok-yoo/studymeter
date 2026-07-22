/**
 * rag.ts — 학습 복기(learning notes) 검색 레이어.
 *
 * 데이터가 많아져도 AI가 관련 기록을 잘 찾도록, 저장 시 임베딩 벡터를 붙여두고
 * 질의 시 코사인 유사도로 상위 K개를 뽑는다(의미 검색). 임베딩이 없거나 API가
 * 실패하면 키워드 매칭으로 자연스럽게 폴백한다.
 *
 * 모든 계산은 클라이언트(IndexedDB) 안에서 이뤄진다 — 별도 서버 없음.
 */
import {
    db,
    getAllLearningNotes,
    updateLearningNote,
    type LearningNote,
    type Settings,
} from '../db';
import { embedText, embedTexts, DEFAULT_EMBED_MODEL } from '../gemini';

/** 임베딩 대상 텍스트: 과목/세부항목 맥락을 함께 담아 검색 품질을 높인다. */
function embedInputFor(note: Pick<LearningNote, 'subject' | 'subItem' | 'content'>): string {
    const ctx = [note.subject, note.subItem].filter(Boolean).join(' > ');
    return ctx ? `[${ctx}] ${note.content}` : note.content;
}

function cosineSim(a: number[], b: number[]): number {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 아주 단순한 키워드 점수 (임베딩 폴백). 겹치는 토큰 수 / 질의 토큰 수. */
function keywordScore(query: string, note: LearningNote): number {
    const q = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (q.length === 0) return 0;
    const hay = embedInputFor(note).toLowerCase();
    let hits = 0;
    for (const tok of q) if (hay.includes(tok)) hits++;
    return hits / q.length;
}

export interface RagHit {
    note: LearningNote;
    score: number;
    method: 'semantic' | 'keyword';
}

/**
 * 저장된 학습 노트 중 임베딩이 없는 것을 채운다 (백필).
 * 한 번에 너무 많이 부르지 않도록 상한을 둔다. 실패는 조용히 무시.
 */
export async function backfillEmbeddings(settings: Settings, max = 32): Promise<number> {
    const apiKey = settings.geminiApiKey;
    if (!apiKey) return 0;
    const all = await getAllLearningNotes();
    const missing = all.filter(n => !n.embedding || n.embedding.length === 0).slice(0, max);
    if (missing.length === 0) return 0;
    const vectors = await embedTexts(apiKey, missing.map(embedInputFor));
    if (vectors.length !== missing.length) return 0;
    let updated = 0;
    for (let i = 0; i < missing.length; i++) {
        const vec = vectors[i];
        if (vec && vec.length) {
            await updateLearningNote(missing[i].id!, { embedding: vec, embeddingModel: DEFAULT_EMBED_MODEL });
            updated++;
        }
    }
    return updated;
}

/** 노트 저장 직후 임베딩을 생성해 붙인다 (실패해도 노트는 유지). */
export async function attachEmbedding(settings: Settings, noteId: number): Promise<void> {
    const apiKey = settings.geminiApiKey;
    if (!apiKey) return;
    const note = await db.learningNotes.get(noteId);
    if (!note) return;
    const vec = await embedText(apiKey, embedInputFor(note));
    if (vec) await updateLearningNote(noteId, { embedding: vec, embeddingModel: DEFAULT_EMBED_MODEL });
}

/**
 * 학습 노트 의미 검색. 임베딩이 있으면 코사인 유사도, 없으면 키워드 매칭.
 * 반환은 점수 내림차순 상위 topK.
 */
export async function searchLearningNotes(
    settings: Settings,
    query: string,
    topK = 6,
    opts: { subject?: string } = {},
): Promise<RagHit[]> {
    let notes = await getAllLearningNotes();
    if (opts.subject) notes = notes.filter(n => n.subject === opts.subject);
    if (notes.length === 0) return [];

    // 검색 전에 최근 노트의 누락 임베딩을 채워둔다 (베스트에포트).
    if (settings.geminiApiKey) {
        await backfillEmbeddings(settings).catch(() => { /* ignore */ });
        notes = opts.subject
            ? (await getAllLearningNotes()).filter(n => n.subject === opts.subject)
            : await getAllLearningNotes();
    }

    const queryVec = settings.geminiApiKey ? await embedText(settings.geminiApiKey, query) : null;

    const hits: RagHit[] = notes.map((note) => {
        if (queryVec && note.embedding && note.embedding.length === queryVec.length) {
            return { note, score: cosineSim(queryVec, note.embedding), method: 'semantic' as const };
        }
        return { note, score: keywordScore(query, note), method: 'keyword' as const };
    });

    return hits
        .filter(h => h.score > 0.01)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
