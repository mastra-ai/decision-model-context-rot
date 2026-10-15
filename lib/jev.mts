import {retryAfter} from './agent.mts';

// Decision models that speak Jev's request format: TypeSafe directly, any model on OpenRouter's decisions API,
// or Cloudflare's Clef models on Workers AI, which wrap the same response in {result}.
export const jev = decisionModel(() => 'https://api.typesafe.ai/v1/systemone', 'jev-1.13.0', () => process.env.TYPESAFE_API_KEY);
export const openRouterDecisions = (model: string) =>
  decisionModel(() => 'https://openrouter.ai/api/alpha/decisions', model, () => process.env.OPENROUTER_API_KEY);
export const cloudflare = (model: string) =>
  decisionModel(() => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/cloudflare/${model}`,
    model, () => process.env.CLOUDFLARE_API_TOKEN, wrapped => wrapped?.result);

function decisionModel(url: () => string, model: string, key: () => string | undefined, unwrap = (r: any) => r) {
  return async (input: {state: string; questions: Record<string, unknown>}) => {
  const body = {model, state: input.state, questions: input.questions};
  const request = {url: url(), method: 'POST',
    body, body_text: JSON.stringify(body)};
  let http: Response | undefined, response: any = null, response_text: string | null = null;
  try {
    http = await fetch(request.url, {method: 'POST', body: request.body_text, signal: AbortSignal.timeout(180000),
      headers: {Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json'}});
    response_text = await http.text();
    response = unwrap(JSON.parse(response_text));
  } catch { /* Log the response, or an unknown-cost transport failure. */ }
  const answers = response?.answers;
  const outcome = !http?.ok ? 'request_failure' : !String(response?.model ?? '').startsWith(model) ? 'model_mismatch'
    : !answers || Object.keys(input.questions).some(id => !answers[id]) ? 'parse_failure' : 'ok';
  return {request, response, response_text, http_status: response_text === null ? null : http?.status ?? null,
    usage: response?.usage ?? null, response_model: response?.model ?? null,
    parsed: outcome === 'ok' ? answers : null, outcome, retry_after_ms: retryAfter(http?.headers.get('retry-after'))};
}
}
