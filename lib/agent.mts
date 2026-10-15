import {Agent} from '@mastra/core/agent';
import {noopLogger} from '@mastra/core/logger';

export const instructions = 'Answer the supplied questions using the supplied state and return the requested structured output. For Noul return the probability of yes; for Choice and Score return the most likely option or level name (level_0 is the first Score criterion) and probabilities over all options or levels that sum to one.';

// Label-only mode for the sampling arm: answer labels, no probabilities.
export const labelInstructions = 'Answer the supplied questions using the supplied state and return only the most likely label for each question. For Noul use yes or no; for Choice use one of the supplied criterion keys. Do not return probabilities or explanations.';

type Question = {type: 'noul' | 'choice' | 'score'; instructions: unknown; criteria?: any};
const object = (properties: Record<string, any>) => ({type: 'object' as const, properties, required: Object.keys(properties), additionalProperties: false});
const probability = {type: 'number', minimum: 0, maximum: 1};
export const scoreLevels = (questions: Record<string, Question>) => Object.fromEntries(
  Object.entries(questions).filter(([, q]) => q.type === 'score')
    .map(([id, q]) => [id, Object.fromEntries(q.criteria.map((_: unknown, i: number) => [`level_${i}`, i]))]));

export function answerSchema(questions: Record<string, Question>) {
  return object({answers: object(Object.fromEntries(Object.entries(questions).map(([id, q]) => {
    if (q.type === 'noul') return [id, object({noul: probability})];
    const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_: unknown, i: number) => `level_${i}`);
    return [id, object({
      [q.type === 'choice' ? 'choice' : 'level']: {type: 'string', enum: keys},
      probabilities: object(Object.fromEntries(keys.map((key: string) => [key, probability]))),
    })];
  })))});
}

export function labelSchema(questions: Record<string, Question>) {
  return object({answers: object(Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, object({label: {type: 'string',
    enum: q.type === 'noul' ? ['yes', 'no'] : q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_: unknown, i: number) => `level_${i}`)}})])))});
}

// noThinking: turn reasoning off for models that reason by default (OpenRouter reasoning effort 'none').
export function agent(model: string, jsonPrompt = false, labelOnly = false, noThinking = false) {
  // respan/<model> goes through Respan's OpenAI-compatible gateway; everything else through Mastra's model router.
  const respan = model.startsWith('respan/');
  const instance = new Agent({id: 'agent', name: 'agent', instructions: labelOnly ? labelInstructions : instructions,
    model: respan ? {providerId: 'respan', modelId: model.slice(7), url: 'https://api.respan.ai/api', apiKey: process.env.RESPAN_API_KEY} as any
      : model as `openrouter/${string}`, maxRetries: 0});
  instance.__setLogger(noopLogger);
  return async (input: {state: string; questions: Record<string, Question>}) => {
    let step: any, error: any, parsed: unknown = null;
    try {
      const result = await instance.generate(`State:\n${input.state}\n\nQuestions:\n${JSON.stringify(input.questions)}`, {
        maxSteps: 1, maxProcessorRetries: 0,
        // Respan's Qwen3.5-4B host ignores enable_thinking; it only skips thinking when max_tokens is at most ~1,100.
        modelSettings: {maxRetries: 0, ...(noThinking && respan ? {maxOutputTokens: 1100} : {})},
        ...(noThinking ? {providerOptions: respan ? {respan: {chat_template_kwargs: {enable_thinking: false}}} : {openrouter: {reasoning: {effort: 'none'}}}} : {}),
        onStepFinish: value => {step = value;},
        structuredOutput: {schema: (labelOnly ? labelSchema : answerSchema)(input.questions), errorStrategy: 'strict', jsonPromptInjection: jsonPrompt},
      });
      step = result; parsed = result.object ?? null;
    } catch (e) {error = e;}
    const body = error?.requestBodyValues ?? step?.request?.body ?? null;
    const response_text = error?.responseBody ?? JSON.stringify(step?.response?.body ?? null);
    let response: any = null;
    try {response = JSON.parse(response_text);} catch { /* Keep non-JSON error text. */ }
    // OpenRouter can report an upstream error inside an HTTP 200 body; use its code so 429/5xx retry.
    const embedded = response?.error?.code ?? response?.choices?.[0]?.error?.code;
    const http_status = error?.statusCode ?? (Number.isInteger(embedded) ? embedded : response ? 200 : null);
    return {request: {url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST',
      body, body_text: JSON.stringify(body)}, response, response_text,
      usage: response?.usage ?? null, response_model: response?.model ?? null, http_status, parsed,
      outcome: parsed ? 'ok' : http_status === 200 ? 'parse_failure' : 'request_failure',
      retry_after_ms: retryAfter(error?.responseHeaders?.['retry-after'])};
  };
}

export function retryAfter(value: string | null | undefined) {
  return !value ? 0 : Number.isFinite(Number(value)) ? Number(value) * 1000
    : Math.max(0, Date.parse(value) - Date.now()) || 0;
}
