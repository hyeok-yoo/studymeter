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

export interface GeminiReply {
    /** 사용자에게 보여줄 최종 답변 (마크다운) */
    text: string
    /** 모델의 추론(Thinking) 요약. 펼침/접기로 보여줄 용도. 없으면 undefined */
    reasoning?: string
    /** Google 검색 그라운딩 출처들 */
    grounding?: GroundingSource[]
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
    /** 429 대체 모델 후보(미리 받아둔 목록) */
    availableModels?: GeminiModel[]
}

interface ParsedCandidate {
    answer: string
    reasoning: string
    grounding: GroundingSource[]
}

function parseCandidate(data: unknown): ParsedCandidate {
    const cand = (data as { candidates?: Array<Record<string, unknown>> })?.candidates?.[0]
    const content = cand?.content as { parts?: Array<{ text?: string; thought?: boolean }> } | undefined
    let answer = ''
    let reasoning = ''
    for (const part of content?.parts ?? []) {
        if (typeof part.text !== 'string') continue
        if (part.thought) reasoning += part.text
        else answer += part.text
    }
    const meta = cand?.groundingMetadata as { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } | undefined
    const grounding: GroundingSource[] = []
    for (const chunk of meta?.groundingChunks ?? []) {
        if (chunk.web?.uri) grounding.push({ uri: chunk.web.uri, title: chunk.web.title || chunk.web.uri })
    }
    return { answer: answer.trim(), reasoning: reasoning.trim(), grounding }
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
    const { systemInstruction, useGrounding, useThinking, availableModels } = options

    const buildBody = () => {
        const body: Record<string, unknown> = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }
        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] }
        }
        if (useGrounding) {
            body.tools = [{ google_search: {} }]
        }
        if (useThinking) {
            body.generationConfig = { thinkingConfig: { includeThoughts: true } }
        }
        return body
    }

    const call = (m: string) =>
        fetch(`${API_BASE}/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody()),
        })

    let usedModel = model
    let fellBack = false
    let res = await call(model)

    if (res.status === 429 && !/flash/i.test(model)) {
        const models = availableModels ?? (await fetchGeminiModels(apiKey).catch(() => []))
        const fallback = models.find((m) => /flash/i.test(m.name) && m.name !== model)
        if (fallback) {
            usedModel = fallback.name
            fellBack = true
            res = await call(fallback.name)
        }
    }

    const data = await res.json()
    if (data.error) {
        const msg =
            data.error.code === 429
                ? '일일 사용량이 초과되었습니다. 내일 다시 시도하거나, Pay-as-you-go 가 활성화된 프로젝트의 API 키를 사용해주세요.'
                : `API 오류: ${data.error.message}`
        throw new Error(msg)
    }

    const { answer, reasoning, grounding } = parseCandidate(data)
    if (!answer) throw new Error('응답을 받지 못했습니다.')
    return {
        text: answer,
        reasoning: reasoning || undefined,
        grounding: grounding.length ? grounding : undefined,
        usedModel,
        fellBack,
    }
}
