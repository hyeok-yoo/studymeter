/**
 * useGeminiChat — Gemini 채팅 엔진 훅. 웹 pages/GeminiChat.tsx 의 대화 로직을 이식.
 *
 * 담당:
 *  - 멀티턴 히스토리 유지(trimHistory) + 역할 라우팅 체인(callModelWithRouting)
 *  - 함수 호출 4라운드 루프 + 실행 칩(functionActivity) 수집
 *  - 기록 공유(오늘/이번 주) 요약을 프롬프트 앞에 덧붙이기
 * UI(마크다운·입력바)는 화면 컴포넌트가 담당하고, 이 훅은 상태·엔진만 노출한다.
 */
import { useCallback, useState } from 'react';
import {
  formatDateYYYYMMDD,
  formatDuration,
  getSessionsByDate,
  getTodayDate,
} from '../../data/dao';
import type { Settings } from '../../data/schema';
import {
  buildFunctionResponseContent,
  buildModelChain,
  buildSystemInstruction,
  CHAT_FUNCTION_DECLARATIONS,
  executeChatFunction,
  fetchGeminiModels,
  generateContent,
  markModelCooldown,
  markModelExhausted,
  QuotaExceededError,
  supportsFunctionCalling,
  supportsGrounding,
  type GeminiContent,
  type GeminiModel,
  type GeminiReply,
  type GroundingSource,
} from '../../ai';

export type ShareData = 'none' | 'day' | 'week';

/** 어시스턴트 메시지 안에서 실행된 함수 호출 하나 (표시용). */
export interface FunctionActivityItem {
  name: string;
  label: string;
  error?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  grounding?: GroundingSource[];
  functionActivity?: FunctionActivityItem[];
}

/** 대화 히스토리(contents)로 유지할 최대 항목 수. 넘으면 오래된 턴부터 자른다. */
const MAX_HISTORY_ENTRIES = 40;
/** 함수 호출 루프 최대 라운드(모델 호출 횟수). */
const MAX_FUNCTION_ROUNDS = 4;

/** 저장류 함수 집합 (칩 아이콘 구분용). */
export const WRITE_FUNCTIONS = new Set(['log_session', 'save_diary']);

function trimHistory(contents: GeminiContent[]): GeminiContent[] {
  if (contents.length <= MAX_HISTORY_ENTRIES) return contents;
  let trimmed = contents.slice(contents.length - MAX_HISTORY_ENTRIES);
  // Gemini contents 는 관례적으로 'user' 턴으로 시작해야 하므로 앞머리를 맞춘다.
  while (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
  return trimmed;
}

/** 조회/저장 함수 실행 결과를 사람이 읽을 짧은 칩 문구로 변환한다. */
function describeFunctionActivity(name: string, result: Record<string, unknown>): FunctionActivityItem {
  const error = typeof result.error === 'string';
  if (error) {
    const label = name === 'log_session' ? `기록 실패: ${result.error}`
      : name === 'save_diary' ? `일기 저장 실패: ${result.error}`
        : `조회 실패: ${result.error}`;
    return { name, label, error: true };
  }
  switch (name) {
    case 'log_session':
      return { name, label: `${result.saved ?? '세션'} 기록됨` };
    case 'save_diary':
      return { name, label: `일기 저장됨${result.date ? ` (${result.date})` : ''}` };
    case 'get_study_data':
      return { name, label: '공부 기록 조회' };
    case 'get_diary':
      return { name, label: '일기 조회' };
    default:
      return { name, label: name };
  }
}

function summarizeSessions(label: string, sessions: Awaited<ReturnType<typeof getSessionsByDate>>): string {
  const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0);
  const selfStudyTime = sessions
    .filter(s => s.type === '자습' || s.type === '테스트')
    .reduce((sum, s) => sum + s.duration, 0);
  const bySubject = new Map<string, number>();
  sessions.forEach(s => bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + s.duration));
  return `[${label}]
- 총 공부 시간: ${formatDuration(totalTime)}
- 순공 시간 (자습): ${formatDuration(selfStudyTime)}
- 세션 수: ${sessions.length}회
- 과목별: ${Array.from(bySubject.entries()).map(([k, v]) => `${k}: ${formatDuration(v)}`).join(', ')}

`;
}

export function useGeminiChat(settings: Settings, models: GeminiModel[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<GeminiContent[]>([]);
  const [loading, setLoading] = useState(false);

  const getStudyDataSummary = useCallback(async (shareData: ShareData): Promise<string> => {
    if (shareData === 'none') return '';
    if (shareData === 'day') {
      const sessions = await getSessionsByDate(getTodayDate());
      return summarizeSessions('오늘 공부 데이터', sessions);
    }
    // Week — 월~일 (로컬 날짜 기준; toISOString 은 UTC 라 KST 에서 하루 어긋남)
    const todayDate = new Date();
    const day = todayDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(todayDate);
    monday.setDate(todayDate.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const all = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      all.push(...(await getSessionsByDate(formatDateYYYYMMDD(d))));
    }
    return summarizeSessions('이번 주 공부 데이터 (월~일)', all);
  }, []);

  /**
   * 역할 기반 라우팅으로 모델을 골라 generateContent 를 호출한다.
   * - settings.geminiModel 이 지정돼 있으면 그 모델만 사용 (내부 429 자동 폴백 허용).
   * - 없으면 buildModelChain('interactive') 후보를 순서대로 시도하고 429 시 다음 후보.
   */
  const callModelWithRouting = useCallback(async (
    contents: GeminiContent[],
    wantFunctions: boolean,
    useGrounding: boolean,
    useThinking: boolean,
    activeSupportsThinking: boolean,
  ): Promise<GeminiReply> => {
    const apiKey = settings.geminiApiKey ?? '';
    if (!apiKey) {
      throw new Error('API 키가 설정되어 있지 않습니다. 설정 페이지에서 확인해주세요.');
    }
    const explicitModel = settings.geminiModel?.trim();
    let chain: string[];
    if (explicitModel) {
      chain = [explicitModel];
    } else {
      chain = await buildModelChain('interactive', settings);
      if (chain.length === 0) {
        const list = models.length ? models : await fetchGeminiModels(apiKey).catch(() => []);
        chain = list[0] ? [list[0].name] : [];
      }
    }
    if (chain.length === 0) {
      throw new Error('사용 가능한 모델이 없습니다. 설정에서 API 키와 모델을 확인해주세요.');
    }

    let lastErr: unknown = null;
    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i];
      const isLast = i === chain.length - 1;
      const useFn = wantFunctions && supportsFunctionCalling(candidate);
      try {
        // Gemini 3.x 는 그라운딩 + 함수 호출을 동시 지원한다. 각 후보 능력에 맞춰 게이팅.
        const reply = await generateContent(apiKey, candidate, '', {
          systemInstruction: buildSystemInstruction(settings, 'chat'),
          useGrounding: useGrounding && supportsGrounding(candidate),
          useThinking: useThinking && activeSupportsThinking,
          thinkingLevel: settings.aiThinkingLevels?.interactive,
          availableModels: models,
          contents,
          functionDeclarations: useFn ? CHAT_FUNCTION_DECLARATIONS : undefined,
          // 후보가 더 남아있으면 우리가 직접 다음 후보로 넘어가도록 자동 폴백을 끈다.
          // 마지막 후보에서는 generateContent 자체의 1회 자동 폴백(flash 전환)을 허용한다.
          noFallback: !isLast,
        });
        // 내부 자동 폴백은 429 성격을 모르므로 보수적으로 짧은 쿨다운만 건다
        if (reply.fellBack) await markModelCooldown(candidate);
        return reply;
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          // 일일 소진만 하루 차단, 분당(RPM) 한도는 짧은 쿨다운 후 자동 복구
          if (err.scope === 'daily') await markModelExhausted(candidate);
          else await markModelCooldown(candidate, err.retryAfterMs);
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (lastErr instanceof QuotaExceededError && lastErr.scope === 'rate') {
      const secs = Math.max(5, Math.ceil((lastErr.retryAfterMs ?? 30_000) / 1000));
      throw new Error(`요청이 잠깐 몰렸어요 (분당 한도). 약 ${secs}초 후에 다시 보내주세요 — 일일 사용량 초과가 아닙니다.`);
    }
    throw lastErr instanceof Error ? lastErr : new Error('모든 모델의 할당량이 초과되었습니다.');
  }, [settings, models]);

  const send = useCallback(async (
    input: string,
    shareData: ShareData,
    opts: { useGrounding: boolean; useThinking: boolean; activeSupportsThinking: boolean },
  ) => {
    if (!input.trim() || !settings.geminiApiKey || loading) return;

    setLoading(true);
    const dataSummary = await getStudyDataSummary(shareData);
    const fullPrompt = dataSummary + input;
    const userMessage = input;

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      // 함수 호출(자연어 자동 기록)은 항상 우선 활성화한다.
      const wantFunctions = true;

      let contents = trimHistory([...history, { role: 'user', parts: [{ text: fullPrompt }] }]);
      const functionActivity: FunctionActivityItem[] = [];
      let reply: GeminiReply | null = null;

      for (let round = 0; round < MAX_FUNCTION_ROUNDS; round++) {
        reply = await callModelWithRouting(
          contents, wantFunctions, opts.useGrounding, opts.useThinking, opts.activeSupportsThinking,
        );
        if (!reply.functionCalls?.length) break;
        // 마지막 라운드에서도 함수 호출을 요청했다면, 더 이어갈 라운드가 없으니 여기서 종료.
        if (round === MAX_FUNCTION_ROUNDS - 1) break;

        contents = reply.contents ?? contents;
        const responses: Array<{ name: string; response: Record<string, unknown> }> = [];
        for (const fc of reply.functionCalls) {
          const fnResult = await executeChatFunction(fc.name, fc.args, settings);
          responses.push({ name: fc.name, response: fnResult });
          functionActivity.push(describeFunctionActivity(fc.name, fnResult));
        }
        contents = [...contents, buildFunctionResponseContent(responses)];
      }

      if (!reply) throw new Error('응답을 받지 못했습니다.');

      setHistory(trimHistory(reply.contents ?? contents));

      let content = reply.text;
      if (!content && functionActivity.length) content = '(요청하신 작업을 완료했습니다.)';
      if (reply.fellBack) {
        content += '\n\n> 선택한 모델의 할당량이 초과되어 더 가벼운 모델로 자동 전환해 답변했습니다.';
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content,
        reasoning: reply!.reasoning,
        grounding: reply!.grounding,
        functionActivity: functionActivity.length ? functionActivity : undefined,
      }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '오류가 발생했습니다. API 키를 확인해주세요.';
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }, [settings, history, loading, callModelWithRouting, getStudyDataSummary]);

  return { messages, loading, send };
}
