"""Score saved runs and print the study's results. Python 3 standard library only.

Usage:
  python3 score/score.py RESULTS_DIR [RESULTS_DIR ...] [--requests out/requests.jsonl] [--json out/scores.json]

Each RESULTS_DIR is a runner --out folder. Every *.jsonl.gz record under it is read, matched to the request file by id,
and scored. Records for ids that are not in the request file, or for models not listed in MODELS, are ignored.

Scoring rules
- Provider failure: an HTTP error that survived the runner's retries. Left out of accuracy.
- Refusal (the provider says the model refused to answer): counts as wrong.
- Yes/no: "yes" if P(yes) >= 0.5. Confidence is max(P, 1 - P).
- Choice: any complete answer (a probability from 0 to 1 for every option, total above 0) is rescaled to sum to 1, and
  the option with the highest probability is the answer. Confidence is that option's probability.
- Anything unreadable counts as wrong.

Statistics
- A change with padding is "significant" when its 95% paired bootstrap interval excludes zero (10,000 resamples of the
  50 tasks; yes/no sets resample within the yes and no groups).
- AUROC: the chance that a random right answer got higher confidence than a random wrong one, ties counting half.
"""
import argparse, bisect, gzip, json, math, os, random

MODELS = [  # contender label written by the runner, display name
    ('jev', 'Jev'),
    ('cloudflare/clef', 'Clef'),
    ('cloudflare/clef-flash', 'Clef-flash'),
    ('decisions/openai/gpt-6-luna-decisions', 'GPT-6 Luna Decisions'),
    ('openrouter/google/gemini-3.8-flash', 'Gemini 3.8 Flash'),
    ('openrouter/openai/gpt-6-luna', 'GPT-6 Luna, thinking'),
    ('openrouter/openai/gpt-6-luna#no-thinking', 'GPT-6 Luna, no thinking'),
    ('openrouter/qwen/qwen3.8-27b#no-thinking', 'Qwen3.8-27B, no thinking'),
]
SETS = [  # set, display name, longest padding
    ('T1', 'Stacked office', '26000'), ('T2', 'Stacked banking', '26000'), ('T3', 'Ticket counting', '20000'),
    ('T4', 'Counterfactual capitals', '22000'), ('T5', 'Plain office lookup', '22000'), ('T6', 'Card-retention needle', '16000'),
    ('banking77', 'Banking77', '20000'), ('boolq', 'BoolQ', '20000'),
]
TOP = {s: top for s, _, top in SETS}
# Sets with no multi-step reasoning or counting: the "tasks models could already do" comparison.
SOLVABLE = ['T4', 'T5', 'T6', 'boolq', 'banking77']


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and 0 <= v <= 1


def score_answer(record, request):
    """Return (provider_failure, valid, correct, confidence) for one saved record."""
    refused = record['outcome'] == 'request_failure' and 'refused to answer' in (record.get('response_text') or '')
    if record['outcome'] not in ('ok', 'parse_failure') and not refused:
        return True, False, False, None
    q, truth = request['questions']['answer'], request['truth']['answer']
    parsed = record.get('parsed') or {}
    answers = parsed.get('answers', parsed) if parsed else {}
    a = answers.get('answer') if isinstance(answers, dict) else None
    if not isinstance(a, dict):
        return False, False, False, None
    if q['type'] == 'noul':
        # Generated sets also require the answer object to be the only key, as in the original analysis.
        if request['id'].startswith('test-') and set(answers) != {'answer'}:
            return False, False, False, None
        p = a.get('noul')
        if not finite(p):
            return False, False, False, None
        return False, True, (p >= .5) == truth, max(p, 1 - p)
    keys = list(q['criteria'])
    probs = a.get('probabilities')
    if not isinstance(probs, dict) or set(probs) != set(keys) or not all(finite(v) for v in probs.values()):
        return False, False, False, None
    total = sum(probs.values())
    if total <= 0:
        return False, False, False, None
    top = max(keys, key=lambda k: probs[k] / total)
    return False, True, top == truth, probs[top] / total


def load(dirs, requests):
    by_contender = {c: {} for c, _ in MODELS}
    for d in dirs:
        for root, _, files in os.walk(d):
            for f in files:
                if not f.endswith('.jsonl.gz'):
                    continue
                r = json.loads(gzip.open(os.path.join(root, f)).read())
                rid = r.get('meta', {}).get('source_id', r['id'])
                if r.get('contender') not in by_contender or rid not in requests:
                    continue
                if r.get('meta', {}).get('arm', 'stated') != 'stated' or rid in by_contender[r['contender']]:
                    continue
                req = requests[rid]
                m = req['meta']
                pf, valid, correct, conf = score_answer(r, req)
                by_contender[r['contender']][rid] = dict(
                    set=m.get('task') or m.get('dataset'), level=m.get('level') or m.get('condition'), item=m['item'],
                    truth=req['truth']['answer'], provider_failure=pf, valid=valid, correct=correct, confidence=conf,
                    cost=r.get('cost_usd'), latency_ms=r.get('latency_ms'))
    return by_contender


def accuracy(rows):
    n = len(rows) - sum(r['provider_failure'] for r in rows)
    return sum(r['correct'] for r in rows) / n if n else None


def cell(rows, s, level):
    return [r for r in rows if r['set'] == s and r['level'] == level]


def paired_change(rows, s, seed=93018, n_boot=10000):
    a = {r['item']: r for r in cell(rows, s, 'compact') if not r['provider_failure']}
    b = {r['item']: r for r in cell(rows, s, TOP[s]) if not r['provider_failure']}
    items = sorted(set(a) & set(b))
    d = [int(b[i]['correct']) - int(a[i]['correct']) for i in items]
    if not d:
        return None
    strata = {}
    for i, x in zip(items, d):
        strata.setdefault(str(a[i]['truth']) if isinstance(a[i]['truth'], bool) else 'all', []).append(x)
    rng, n, groups = random.Random(seed), len(d), list(strata.values())
    boots = sorted(sum(g[rng.randrange(len(g))] for g in groups for _ in g) / n for _ in range(n_boot))
    return sum(d) / n, boots[int(.025 * n_boot)], boots[int(.975 * n_boot) - 1]


def pooled_change(rows, sets, seed=1, n_boot=4000):
    """Accuracy with no padding and at full padding over several sets, and the paired change with a 95% interval."""
    d, before, after = [], 0, 0
    for s in sets:
        a = {r['item']: r for r in cell(rows, s, 'compact') if not r['provider_failure']}
        b = {r['item']: r for r in cell(rows, s, TOP[s]) if not r['provider_failure']}
        for i in a:
            if i in b:
                d.append(int(b[i]['correct']) - int(a[i]['correct'])); before += a[i]['correct']; after += b[i]['correct']
    if not d:
        return None
    rng = random.Random(seed)
    boots = sorted(sum(d[rng.randrange(len(d))] for _ in d) / len(d) for _ in range(n_boot))
    return before / len(d), after / len(d), sum(d) / len(d), boots[int(.025 * n_boot)], boots[int(.975 * n_boot) - 1]


def auroc(rows):
    pairs = [(r['confidence'], r['correct']) for r in rows if r['valid'] and r['confidence'] is not None]
    pos = [c for c, ok in pairs if ok]
    neg = sorted(c for c, ok in pairs if not ok)
    if not pos or not neg:
        return None
    s = sum(bisect.bisect_left(neg, p) + .5 * (bisect.bisect_right(neg, p) - bisect.bisect_left(neg, p)) for p in pos)
    return s / (len(pos) * len(neg))


def pooled(rows, top):
    picked = [r for s, _, t in SETS for r in cell(rows, s, t if top else 'compact')]
    return accuracy(picked)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--requests', default='out/requests.jsonl')
    ap.add_argument('--json', default=None, help='also write the numbers to this file')
    args = ap.parse_args()
    requests = {json.loads(l)['id']: json.loads(l) for l in open(args.requests)}
    data = load(args.dirs, requests)
    pct = lambda v: '   -' if v is None else f'{100 * v:3.0f}%'
    out = {}

    print('Accuracy by set, no padding -> full padding (* = significant change)\n')
    print(f'{"Model":28}' + ''.join(f'{name[:14]:>17}' for _, name, _ in SETS))
    for c, label in MODELS:
        rows = list(data[c].values())
        if not rows:
            continue
        line, out[label] = f'{label:28}', {'sets': {}}
        for s, _, _ in SETS:
            ch = paired_change(rows, s)
            sig = ch is not None and (ch[1] > 0 or ch[2] < 0)
            a, b = accuracy(cell(rows, s, 'compact')), accuracy(cell(rows, s, TOP[s]))
            line += f'{pct(a)} -> {pct(b)}{"*" if sig else " "}'.rjust(17)
            out[label]['sets'][s] = dict(no_padding=a, full_padding=b, change=ch and ch[0], ci=ch and ch[1:], significant=sig)
        print(line)

    print('\nOverall\n')
    print(f'{"Model":28}{"accuracy, none -> full":>24}{"significant drops":>19}{"AUROC":>8}{">= 0.99 sure":>14}{"cost":>9}{"median time":>13}')
    for c, label in MODELS:
        rows = list(data[c].values())
        if not rows:
            continue
        drops = sum(1 for s, _, _ in SETS if (ch := paired_change(rows, s)) and ch[2] < 0)
        valid = [r for r in rows if r['valid'] and r['confidence'] is not None]
        sure = sum(r['confidence'] >= .99 for r in valid) / len(valid) if valid else None
        cost = sum(r['cost'] or 0 for r in rows)
        lats = sorted(r['latency_ms'] for r in rows if r['latency_ms'] is not None)
        lat = lats[len(lats) // 2] / 1000 if lats else float('nan')  # upper median, as in the published tables
        au = auroc(rows)
        au_txt = '-' if au is None else f'{au:.2f}'
        print(f'{label:28}{pct(pooled(rows, False)) + " -> " + pct(pooled(rows, True)):>24}{drops:>19}{au_txt:>8}{pct(sure):>14}{"$" + format(cost, ".2f"):>9}{lat:>12.2f}s')
        out[label].update(accuracy_no_padding=pooled(rows, False), accuracy_full_padding=pooled(rows, True),
                          significant_drops=drops, auroc=au, share_at_99=sure, cost_usd=cost, median_latency_s=lat, runs=len(rows))

    print('\nChange on the five sets with no multi-step reasoning or counting (' + ', '.join(SOLVABLE) + ')\n')
    for c, label in MODELS:
        rows = list(data[c].values())
        if not rows:
            continue
        res = pooled_change(rows, SOLVABLE)
        if res is None:
            print(f'{label:28}no tasks with both lengths yet')
            continue
        a, b, ch, lo, hi = res
        print(f'{label:28}{pct(a)} -> {pct(b)}   {100 * ch:+5.1f} points  [{100 * lo:+.1f}, {100 * hi:+.1f}]')
        out[label]['five_sets'] = dict(no_padding=a, full_padding=b, change=ch, ci=[lo, hi])

    if args.json:
        with open(args.json, 'w') as f:
            json.dump(out, f, indent=2)


if __name__ == '__main__':
    main()
