/**
 * gemini.ts — Google Gemini (Generative Language) API 연동 공통 모듈.
 *
 * 모델 목록을 앱에 하드코딩하지 않고, ListModels API 에서 "지금 그 키로 실제 사용
 * 가능한" 모델만 동적으로 가져온다. 모델 호출(generateContent)도 여기로 일원화한다.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GeminiModel {
    /** 'models/' 접두사를 제거한 모델 ID (예: gemini-2.0-flash) */
    name: string
    displayName: string
    description: string
}

interface ApiModel {
    name: string
    displayName?: string
    description?: string
    supportedGenerationMethods?: string[]
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
                description: (m.description || '').slice(0, 60),
            }
        })
        .sort((a, b) => b.displayName.localeCompare(a.displayName))
}

export interface GeminiReply {
    text: string
    /** 실제로 응답을 생성한 모델명 (자동 전환 시 원래와 다를 수 있음) */
    usedModel: string
    /** 할당량 초과로 더 가벼운 모델로 자동 전환됐는지 */
    fellBack: boolean
}

/**
 * 프롬프트를 모델에 전송해 응답 텍스트를 받는다.
 * 429(할당량 초과)면 사용 가능한 'flash' 계열(가벼운) 모델로 1회 자동 재시도한다.
 * 전환 후보 역시 API 목록에서 동적으로 고른다(모델명 하드코딩 없음).
 */
export async function generateContent(
    apiKey: string,
    model: string,
    prompt: string,
    availableModels?: GeminiModel[],
): Promise<GeminiReply> {
    const call = (m: string) =>
        fetch(`${API_BASE}/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
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

    const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('응답을 받지 못했습니다.')
    return { text, usedModel, fellBack }
}
