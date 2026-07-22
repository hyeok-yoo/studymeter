/**
 * gemini.ts — Google Gemini (Generative Language) API 연동 공통 모듈.
 *
 * 모델 목록을 앱에 하드코딩하지 않고, ListModels API 에서 "지금 그 키로 실제 사용
 * 가능한" 모델만 동적으로 가져온다. 모델 호출(generateContent)도 여기로 일원화한다.
 *
 * ListModels 가 알려주는 능력치(토큰 한도·온도 범위 등)와, 모델 이름으로 추론한
 * 부가 기능(추론/Thinking, Google 검색 그라운딩)을 함께 노출한다.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiModel {
    /** 'models/' 접두사를 제거한 모델 ID (예: gemini-2.0-flash) */
    name: string
    displayName: string
    description: string
    version?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
    /** 기본 샘플링 온도 */
    temperature?: number
    /** 허용 최대 온도 */
    maxTemperature?: number
    topP?: number
    topK?: number
    /** 단계적 추론(Thinking) 지원 추정치 (2.5 계열) */
    supportsThinking: boolean
    /** Google 검색 그라운딩 지원 추정치 (2.x 계열) */
    supportsGrounding: boolean
}

interface ApiModel {
    name: string
    displayName?: string
    description?: string
    version?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
    temperature?: number
    maxTemperature?: number
    topP?: number
    topK?: number
    supportedGenerationMethods?: string[]
}

function deriveThinking(id: string): boolean {
    return /2\.5/.test(id)
}
function deriveGrounding(id: string): boolean {
    // google_search 도구는 2.x 계열에서 지원. (1.5 는 별도 도구라 보수적으로 제외)
    return /gemini-2\.\d/.test(id)
}

/**
 * generateContent 를 지원하는(=채팅 가능한) 모델 목록을 API 에서 가져온다.
 * 최신(2.5 등) 모델이 위로 오도록 displayName 기준 내림차순 정렬한다.
 */
export async function fetchGeminiModels(apiKey: string): Promise<GeminiModel[]> {
    if (!apiKey) return []
    const res = await fetch(`${API_BASE}/models?key=${encodeURIComponent(apiKey)}`)
    if (!res.ok) throw new Error(`모델 목록을 불러오지 못했습니다 (HTTP ${res.status})`)
    const data = await res.json()
    const models = (data.models as ApiModel[] | undefined) ?? []
    return models
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m): GeminiModel => {
            const id = m.name.replace(/^models\//, '')
            return {
                name: id,
                displayName: m.displayName || id,
                description: m.description || '',
                version: m.version,
                inputTokenLimit: m.inputTokenLimit,
                outputTokenLimit: m.outputTokenLimit,
                temperature: m.temperature,
                maxTemperature: m.maxTemperature,
                topP: m.topP,
                topK: m.topK,
                supportsThinking: deriveThinking(id),
                supportsGrounding: deriveGrounding(id),
            }
        })
        .sort((a, b) => b.displayName.localeCompare(a.displayName))
}

export interface GroundingSource {
    title: string
    uri: string
}

/** 모델이 요청한 함수 호출 */
export interface GeminiFunctionCall {
    name: string
    args: Record<string, unknown>
}

/** Gemini contents 배열의 한 턴. 함수 호출 루프/멀티턴 대화에 사용. */
export interface GeminiContent {
    role: 'user' | 'model'
    parts: Array<Record<string, unknown>>
}

/** 함수 선언 (Gemini functionDeclarations 형식 — OpenAPI 스키마 서브셋) */
export interface GeminiFunctionDeclaration {
    name: string
    description: string
    parameters?: Record<string, unknown>
}

/** 추론(Thinking) 강도. 역할 프로파일/설정이 결정한다. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface GeminiReply {
    /** 사용자에게 보여줄 최종 답변 (마크다운) */
    text: string
    /** 모델의 추론(Thinking) 요약. 펼침/접기로 보여줄 용도. 없으면 undefined */
    reasoning?: string
    /** Google 검색 그라운딩 출처들 */
    grounding?: GroundingSource[]
    /** 모델이 요청한 함수 호출들 (있으면 호출자가 실행 후 continueWithFunctionResults 로 이어간다) */
    functionCalls?: GeminiFunctionCall[]
    /** 함수 호출 루프를 잇기 위한, 모델 응답 턴을 포함한 contents 스냅샷 */
    contents?: GeminiContent[]
    /** 실제로 응답을 생성한 모델명 (자동 전환 시 원래와 다를 수 있음) */
    usedModel: string
    /** 할당량 초과로 더 가벼운 모델로 자동 전환됐는지 */
    fellBack: boolean
}

export interface GenerateOptions {
    /** 시스템 지시(페르소나/형식 규칙). systemInstruction 으로 전달된다. */
    systemInstruction?: string
    /** Google 검색 그라운딩 사용 */
    useGrounding?: boolean
    /** 단계적 추론(Thinking) 요약 포함 */
    useThinking?: boolean
    /** 추론 강도. 지정 시 thinkingBudget 으로 변환된다 (지원 모델에서만 적용). */
    thinkingLevel?: ThinkingLevel
    /** 429 대체 모델 후보(미리 받아둔 목록) */
    availableModels?: GeminiModel[]
    /** 함수 선언 목록 (function calling) */
    functionDeclarations?: GeminiFunctionDeclaration[]
    /** prompt 대신 전체 contents 를 직접 전달 (멀티턴/함수 루프) */
    contents?: GeminiContent[]
    /** 429 자동 폴백 비활성화 (라우터가 체인을 직접 관리할 때) */
    noFallback?: boolean
}

/**
 * 쿼터 관련 429 에러. scope 로 성격을 구분한다:
 *  - 'daily': 일일 무료 한도 소진 — 그날은 그 모델을 쓸 수 없다.
 *  - 'rate' : 분당 요청 한도(RPM) — 몇 초~몇십 초 후 자동으로 풀린다.
 * 429 를 무조건 "일일 소진"으로 취급하면 순간적인 요청 몰림만으로 모델이
 * 하루 종일 차단되므로, 분류가 불확실하면 'rate' 로 본다.
 */
export class QuotaExceededError extends Error {
    model: string
    scope: 'daily' | 'rate'
    retryAfterMs?: number
    constructor(model: string, scope: 'daily' | 'rate' = 'rate', retryAfterMs?: number) {
        super(scope === 'daily'
            ? `일일 사용량 초과 (${model})`
            : `분당 요청 한도 도달 (${model}) — 잠시 후 자동으로 풀립니다`)
        this.name = 'QuotaExceededError'
        this.model = model
        this.scope = scope
        this.retryAfterMs = retryAfterMs
    }
}

/**
 * Gemini 429 에러 본문에서 쿼터 성격을 분류한다.
 * QuotaFailure.violations[].quotaId 에 'PerDay' 가 있으면 일일 소진,
 * RetryInfo.retryDelay 가 있으면 그 시간 후 재시도 가능(분당 한도).
 */
function classifyQuotaError(
    error: unknown,
): { scope: 'daily' | 'rate'; retryAfterMs?: number } {
    let scope: 'daily' | 'rate' = 'rate'
    let retryAfterMs: number | undefined
    const details = (error as { details?: Array<Record<string, unknown>> })?.details ?? []
    for (const d of details) {
        const type = String(d['@type'] ?? '')
        if (type.includes('QuotaFailure')) {
            for (const v of (d.violations as Array<{ quotaId?: string }> | undefined) ?? []) {
                if (/PerDay/i.test(String(v.quotaId ?? ''))) scope = 'daily'
            }
        }
        if (type.includes('RetryInfo') && d.retryDelay) {
            const secs = parseFloat(String(d.retryDelay).replace(/s$/i, ''))
            if (Number.isFinite(secs)) retryAfterMs = Math.ceil(secs * 1000)
        }
    }
    const msg = String((error as { message?: string })?.message ?? '')
    if (/per\s*day|daily/i.test(msg)) scope = 'daily'
    return { scope, retryAfterMs }
}

interface ParsedCandidate {
    answer: string
    reasoning: string
    grounding: GroundingSource[]
    functionCalls: GeminiFunctionCall[]
    modelParts: Array<Record<string, unknown>>
}

function parseCandidate(data: unknown): ParsedCandidate {
    const cand = (data as { candidates?: Array<Record<string, unknown>> })?.candidates?.[0]
    const content = cand?.content as { parts?: Array<Record<string, unknown>> } | undefined
    let answer = ''
    let reasoning = ''
    const functionCalls: GeminiFunctionCall[] = []
    const modelParts: Array<Record<string, unknown>> = []
    for (const part of content?.parts ?? []) {
        const fc = part.functionCall as { name?: string; args?: Record<string, unknown> } | undefined
        if (fc?.name) {
            functionCalls.push({ name: fc.name, args: fc.args ?? {} })
            modelParts.push(part)
            continue
        }
        if (typeof part.text !== 'string') continue
        if (part.thought) reasoning += part.text
        else { answer += part.text; modelParts.push(part) }
    }
    const meta = cand?.groundingMetadata as { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } | undefined
    const grounding: GroundingSource[] = []
    for (const chunk of meta?.groundingChunks ?? []) {
        if (chunk.web?.uri) grounding.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri })
    }
    return { answer: answer.trim(), reasoning: reasoning.trim(), grounding, functionCalls, modelParts }
}

/** ThinkingLevel → thinkingConfig 변환. off 는 thinking 을 끈다 (지연 최소화). */
/** 모델 세대 판별: Gemini 2.5 계열은 thinkingBudget, 그 외(3.x·-latest 별칭)는 thinkingLevel 을 쓴다. */
function usesLegacyThinkingBudget(model: string): boolean {
    return /2\.5/.test(model)
}
function isGemmaModel(model: string): boolean {
    return /gemma/i.test(model)
}

/**
 * 추론 설정 생성. 모델 세대에 맞는 파라미터를 고른다.
 *  - Gemini 3.x / -latest 별칭: thinkingLevel ("LOW"|"MEDIUM"|"HIGH")
 *  - Gemini 2.5: thinkingBudget (0=끔, 512=low, -1=동적)
 *  - Gemma: 이 경로로 제어하지 않음(생략)
 * thinkingLevel 과 thinkingBudget 을 함께 보내면 400 이므로 절대 동시 사용하지 않는다.
 */
function thinkingConfigFor(
    level: ThinkingLevel | undefined,
    includeThoughts: boolean,
    model: string,
): Record<string, unknown> | null {
    if (level === undefined && !includeThoughts) return null
    const config: Record<string, unknown> = {}
    if (includeThoughts) config.includeThoughts = true

    if (level !== undefined && !isGemmaModel(model)) {
        if (usesLegacyThinkingBudget(model)) {
            // Gemini 2.5 계열
            if (level === 'off') config.thinkingBudget = 0
            else if (level === 'low') config.thinkingBudget = 512
            else if (level === 'medium') config.thinkingBudget = 4096
            else config.thinkingBudget = -1 // high → 동적
        } else {
            // Gemini 3.x / -latest 별칭 — thinkingLevel. 'off'는 명시적 지원이 없어 최저(LOW)로.
            config.thinkingLevel = (level === 'off' ? 'low' : level).toUpperCase()
        }
    }
    return config
}

/**
 * 프롬프트를 모델에 전송해 응답을 받는다.
 * 429(할당량 초과)면 사용 가능한 'flash' 계열(가벼운) 모델로 1회 자동 재시도한다.
 * 전환 후보 역시 API 목록에서 동적으로 고른다(모델명 하드코딩 없음).
 */
export async function generateContent(
    apiKey: string,
    model: string,
    prompt: string,
    options: GenerateOptions = {},
): Promise<GeminiReply> {
    const {
        systemInstruction, useGrounding, useThinking, thinkingLevel,
        availableModels, functionDeclarations, contents, noFallback,
    } = options

    const requestContents: GeminiContent[] =
        contents ?? [{ role: 'user', parts: [{ text: prompt }] }]

    // 폴백으로 모델이 바뀌면 thinking 파라미터도 그 모델 세대에 맞게 재생성되도록 현재 모델을 추적
    let currentModel = model
    // 그라운딩(google_search)은 모델 쿼터와 별개의 쿼터를 쓴다.
    // 그라운딩 쿼터 429 를 모델 소진으로 오인하지 않도록, 429 시 검색만 빼고 재시도한다.
    let sendGrounding = !!useGrounding

    const buildBody = () => {
        const body: Record<string, unknown> = { contents: requestContents }
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] }
        }
        const tools: Array<Record<string, unknown>> = []
        if (sendGrounding) tools.push({ google_search: {} })
        if (functionDeclarations?.length) tools.push({ functionDeclarations })
        if (tools.length) body.tools = tools
        const thinkingConfig = thinkingConfigFor(thinkingLevel, !!useThinking, currentModel)
        if (thinkingConfig) {
            body.generationConfig = { thinkingConfig }
        }
        return body
    }

    const call = async (m: string): Promise<{ status: number; data: Record<string, unknown> & { error?: { code?: number; message?: string } } }> => {
        currentModel = m
        const res = await fetch(`${API_BASE}/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody()),
        })
        const data = await res.json().catch(() => ({}))
        return { status: res.status, data }
    }

    let usedModel = model
    let fellBack = false
    let { status, data } = await call(model)
    const is429 = () => status === 429 || data.error?.code === 429

    if (is429() && sendGrounding) {
        sendGrounding = false
        ;({ status, data } = await call(model))
    }

    if (is429() && !noFallback && !/flash/i.test(model)) {
        const models = availableModels ?? (await fetchGeminiModels(apiKey).catch(() => []))
        const fallback = models.find((m) => /flash/i.test(m.name) && m.name !== model)
        if (fallback) {
            usedModel = fallback.name
            fellBack = true
            ;({ status, data } = await call(fallback.name))
        }
    }

    if (is429()) {
        const { scope, retryAfterMs } = classifyQuotaError(data.error)
        throw new QuotaExceededError(usedModel, scope, retryAfterMs)
    }
    if (data.error) {
        throw new Error(`API 오류: ${data.error.message}`)
    }

    const { answer, reasoning, grounding, functionCalls, modelParts } = parseCandidate(data)
    if (!answer && functionCalls.length === 0) throw new Error('응답을 받지 못했습니다.')
    return {
        text: answer,
        reasoning: reasoning || undefined,
        grounding: grounding.length ? grounding : undefined,
        functionCalls: functionCalls.length ? functionCalls : undefined,
        contents: [...requestContents, { role: 'model', parts: modelParts }],
        usedModel,
        fellBack,
    }
}

// ── 임베딩 (의미 검색/RAG용) ──────────────────────────────────────────────────

/** 기본 임베딩 모델. 무료 티어에서 널리 제공되는 안정 모델. */
export const DEFAULT_EMBED_MODEL = 'text-embedding-004'

/**
 * 여러 문장의 임베딩 벡터를 한 번에 받는다 (batchEmbedContents).
 * 실패하면 빈 배열을 반환한다(호출 측이 키워드 검색으로 폴백).
 */
export async function embedTexts(
    apiKey: string,
    texts: string[],
    model: string = DEFAULT_EMBED_MODEL,
): Promise<number[][]> {
    if (!apiKey || texts.length === 0) return []
    const modelPath = model.startsWith('models/') ? model : `models/${model}`
    try {
        const res = await fetch(`${API_BASE}/${modelPath}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: texts.map((t) => ({
                    model: modelPath,
                    content: { parts: [{ text: t }] },
                })),
            }),
        })
        if (!res.ok) return []
        const data = await res.json().catch(() => ({}))
        const embeddings = (data.embeddings as Array<{ values?: number[] }> | undefined) ?? []
        return embeddings.map((e) => e.values ?? [])
    } catch {
        return []
    }
}

/** 단일 문장 임베딩. 실패 시 null. */
export async function embedText(
    apiKey: string,
    text: string,
    model: string = DEFAULT_EMBED_MODEL,
): Promise<number[] | null> {
    const [vec] = await embedTexts(apiKey, [text], model)
    return vec && vec.length ? vec : null
}

/**
 * 함수 실행 결과를 모델에 돌려주는 후속 턴용 content 를 만든다.
 * (호출자는 reply.contents + 이 content 로 다시 generateContent 를 호출)
 */
export function buildFunctionResponseContent(
    results: Array<{ name: string; response: Record<string, unknown> }>,
): GeminiContent {
    return {
        role: 'user',
        parts: results.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
    }
}
