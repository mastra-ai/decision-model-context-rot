import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import {parseArgs} from 'node:util';
import {setTimeout as sleep} from 'node:timers/promises';
import {cloudflare, jev, openRouterDecisions} from './jev.mts';
import {agent, scoreLevels} from './agent.mts';

async function main() {
  const options = Object.fromEntries(['input', 'out', 'contender', 'cap', 'concurrency', 'retries', 'rpm']
    .map(name => [name, {type: 'string' as const}]));
  const args: Record<string, any> = parseArgs({options: {...options, 'json-prompt': {type: 'boolean' as const}, 'label-only': {type: 'boolean' as const}, 'no-thinking': {type: 'boolean' as const}}}).values;
  const {input, out, contender: model} = args;
  // --json-prompt: Mastra's shipped fallback for schemas too large for native structured output.
  const contender = model && (model + (args['json-prompt'] ? '#json-prompt' : '') + (args['label-only'] ? '#label-only' : '') + (args['no-thinking'] ? '#no-thinking' : ''));
  if (!input || !out || !contender || args.cap === undefined) throw Error('Missing required CLI flags');
  const cap = Number(args.cap), concurrency = Number(args.concurrency ?? 2), retries = Number(args.retries ?? 2);
  if (!Number.isFinite(cap) || cap < 0 || !Number.isInteger(concurrency) || concurrency < 1
    || !Number.isInteger(retries) || retries < 0) throw Error('Invalid cap, concurrency or retries');
  if (!model || (model !== 'jev' && !/^(openrouter|respan|decisions|cloudflare)\//.test(model))) throw Error('Unknown contender');
  const env = new URL('../.env', import.meta.url);
  if (existsSync(env)) process.loadEnvFile(env);
  const keys = [process.env.TYPESAFE_API_KEY, process.env.OPENROUTER_API_KEY, process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(Boolean) as string[];
  const json = (x: unknown) => keys.reduce((s, k) => s.split(k).join('[REDACTED]'), JSON.stringify(x));
  const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const lines = (path: string) => existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const rawDir = join(out, 'raw'), ledger = join(out, 'ledger.jsonl');
  mkdirSync(rawDir, {recursive: true});
  const calls = new Map(lines(ledger).map(e => [e.call_id, e]));
  const totals: Record<string, number> = {jev: 0, openrouter: 0, respan: 0, cloudflare: 0};
  for (const e of calls.values()) totals[e.provider] = (totals[e.provider] ?? 0) + (e.cost_usd ?? 0);
  const done = readdirSync(rawDir).filter(n => n.endsWith('.jsonl.gz'))
    .map(n => JSON.parse(gunzipSync(readFileSync(join(rawDir, n))).toString()))
    .filter(r => r.contender === contender && r.complete);
  const ids = new Set(done.map(r => r.id));
  const rows = lines(input).filter(r => !ids.has(r.id));
  // decisions/<model>: a decision model on OpenRouter's decisions API (Jev's request format), billed by OpenRouter.
  // cloudflare/<model>: Cloudflare's Clef decision models on Workers AI (Jev's request format), priced per input token.
  const provider = contender === 'jev' ? 'jev' : model.startsWith('respan/') ? 'respan' : model.startsWith('cloudflare/') ? 'cloudflare' : 'openrouter';
  const decisions = model.startsWith('decisions/') || provider === 'cloudflare';
  const price = provider === 'jev' ? 0.042 : provider === 'cloudflare' ? ({clef: 0.24, 'clef-flash': 0.09} as Record<string, number>)[model.slice(11)] : undefined;
  if (provider === 'cloudflare' && price === undefined) throw Error('Unknown Cloudflare model price');
  const call = provider === 'jev' ? jev : provider === 'cloudflare' ? cloudflare(model.slice(11)) : decisions ? openRouterDecisions(model.slice(10)) : agent(model!, Boolean(args['json-prompt']), Boolean(args['label-only']), Boolean(args['no-thinking']));
  let cursor = 0, failures = done.filter(r => r.outcome !== 'ok').length, stopped = false;
  const overCap = () => Object.values(totals).reduce((s, v) => s + v, 0) > cap;
  process.on('SIGINT', () => {stopped = true;});
  process.on('SIGTERM', () => {stopped = true;});
  await Promise.all(Array.from({length: concurrency}, async () => {
    while (!stopped && !overCap() && cursor < rows.length) {
      const row = rows[cursor++], attempts: any[] = [];
      let result;
      for (let retry = 0; ; retry++) {
        const timestamp = new Date().toISOString(), started = performance.now();
        result = await call(row);
        const cost_usd = price !== undefined ? result.usage?.input_tokens * price / 1e6 : result.usage?.cost ?? result.usage?.cost_usd;
        const cost = Number.isFinite(cost_usd) ? cost_usd : null;
        const entry = {call_id: randomUUID(), timestamp, provider, contender, id: row.id,
          http_status: result.http_status, cost_usd: cost,
          cost_basis: cost === null ? 'unknown' : price !== undefined ? 'usage_times_price' : 'provider_reported'};
        appendFileSync(ledger, json(entry) + '\n'); calls.set(entry.call_id, entry);
        totals[provider] += cost ?? 0;
        attempts.push({...result, ...entry, latency_ms: performance.now() - started, ledger: entry});
        const status = result.http_status;
        if (!(status === 429 || (status >= 500 && status <= 599)) || retry >= retries) break;
        await sleep(Math.max(1000 * 2 ** retry, result.retry_after_ms ?? 0));
      }
      const record = {...attempts.at(-1), id: row.id, contender, provider, attempts, complete: true,
        input_hash: hash(row), request_format: provider === 'jev' ? 'jev-v1' : decisions ? 'decisions-v1' : 'agent-v2',
        ...(provider !== 'jev' && !decisions ? {score_levels: scoreLevels(row.questions)} : {}),
        ...('truth' in row ? {truth: row.truth} : {}), ...('meta' in row ? {meta: row.meta} : {}),
        cost_usd: attempts.every(a => a.cost_usd !== null) ? attempts.reduce((s, a) => s + a.cost_usd, 0) : null,
        latency_ms: attempts.reduce((s, a) => s + a.latency_ms, 0)};
      writeFileSync(join(rawDir, hash([contender, row.id]) + '.jsonl.gz'), gzipSync(json(record) + '\n'));
      if (record.outcome !== 'ok') failures++;
      if (record.outcome === 'model_mismatch') {stopped = true; console.error('Decision model response model mismatch');}
      console.log(json({id: row.id, outcome: record.outcome, cost_usd: totals}));
    }
  }));
  console.log(json({summary: true, provider_totals_usd: totals, cap_usd: cap,
    unknown_cost_calls: [...calls.values()].filter(c => c.cost_usd == null).length,
    budget_stopped: overCap(), stopped, failures}));
  process.exitCode = overCap() ? 2 : failures || stopped ? 1 : 0;
}
// Exit explicitly: the Mastra agent can keep handles open after the last request. Every record is already written synchronously.
main().catch(() => {console.error('Runner failed; check inputs and saved records.'); process.exitCode = 1;}).finally(() => process.exit());
