// Step 4: join the generated sets and the real-text sets into the single request file every model ran on.
// Order: T1 to T6, each at its lengths in order, items 0 to 49, then BoolQ and Banking77 as written by step 3.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const OUT = new URL('../out/', import.meta.url);
const levels = {T1: ['compact', '4000', '16000', '26000'], T2: ['compact', '26000'], T3: ['compact', '20000'],
  T4: ['compact', '4000', '16000', '22000'], T5: ['compact', '22000'], T6: ['compact', '16000']};
// SHA-256 of the request file used in the published study.
const EXPECTED = '602ace6756d5701d40bb7f68128f238afcf82e09abbd5186fcadbf7604feddeb';
// The published file stored the generated sets with non-ASCII characters escaped (\uXXXX), as Python's json.dumps does,
// and the real-text sets as raw UTF-8. Matching that keeps the file byte-identical; the parsed content is the same either way.
const ascii = line => line.replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const lines = [];
for (const [task, ls] of Object.entries(levels))
  for (const level of ls) lines.push(...readFileSync(new URL(`tasks/${task}-${level}.jsonl`, OUT), 'utf8').trim().split('\n').map(ascii));
lines.push(...readFileSync(new URL('real.jsonl', OUT), 'utf8').trim().split('\n'));
const text = lines.join('\n') + '\n';
writeFileSync(new URL('requests.jsonl', OUT), text);
const sha = createHash('sha256').update(text).digest('hex');
console.log(JSON.stringify({requests: lines.length, sha256: sha, matches_published_study: sha === EXPECTED}));
if (sha !== EXPECTED) process.exitCode = 1;
