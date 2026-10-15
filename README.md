# Decision models get context rot too: reproduction code

Code to reproduce the study comparing decision models (Jev, Clef, Clef-flash, GPT-6 Luna Decisions) with reasoning and non-reasoning LLMs on 400 tasks padded with up to 26k tokens of extra text.

It has four steps: generate the tasks, run each model, score the saved answers, and print the tables. Task generation is deterministic. Running it reproduces the exact request file every model saw in the study, byte for byte.

## Requirements

- Node.js 24 or later and pnpm 10
- Python 3.10 or later (standard library only)
- API keys for the models you want to run (see `.env.example`)

```bash
pnpm install
```

## 1. Generate the tasks

```bash
pnpm run generate
```

This takes about four minutes and makes no model calls. It runs four scripts in order:

| Script | What it does |
| --- | --- |
| `generate/stacked-cores.mjs` | Builds the fact chains for stacked office and stacked banking |
| `generate/tasks.mjs` | Writes the six generated task sets at every padding length to `out/tasks/` |
| `generate/real-data.mjs` | Downloads BoolQ and Banking77 into `data/downloads/`, picks 50 items from each, and pads them |
| `generate/build-requests.mjs` | Joins everything into `out/requests.jsonl`: 1,100 requests |

The last step prints the file's SHA-256 and checks it against the study's request file:

```text
{"requests":1100,"sha256":"602ace6756d5701d40bb7f68128f238afcf82e09abbd5186fcadbf7604feddeb","matches_published_study":true}
```

## 2. Run the models

Copy `.env.example` to `.env` and fill in the keys you need. Then run each model into its own results folder. The spend cap is in US dollars and is shared by everything in one `--out` folder.

```bash
R="node lib/runner.mts --input out/requests.jsonl --concurrency 6"

# Decision models
$R --contender jev                                    --out results/jev            --cap 5
$R --contender cloudflare/clef                        --out results/clef           --cap 10
$R --contender cloudflare/clef-flash                  --out results/clef-flash     --cap 5
$R --contender decisions/openai/gpt-6-luna-decisions  --out results/luna-decisions --cap 5

# Reasoning LLMs
$R --contender openrouter/google/gemini-3.8-flash     --out results/gemini         --cap 30
$R --contender openrouter/openai/gpt-6-luna           --out results/luna-thinking  --cap 5

# Non-reasoning LLMs
$R --contender openrouter/openai/gpt-6-luna --no-thinking   --out results/luna-no-thinking --cap 5
$R --contender openrouter/qwen/qwen3.8-27b --no-thinking    --out results/qwen-27b         --cap 10
```

What the study's full runs cost, for reference:

| Model | Cost, 1,100 runs |
| --- | --- |
| Jev | $0.65 |
| GPT-6 Luna Decisions | $1.21 |
| Clef-flash | $1.42 |
| GPT-6 Luna, thinking | $1.62 |
| GPT-6 Luna, no thinking | $1.64 |
| Qwen3.8-27B, no thinking | $3.18 |
| Clef | $3.79 |
| Gemini 3.8 Flash | $21.38 |

How the runner works:

- **Decision models** get each task as it is, through their providers' APIs. Jev uses the TypeSafe API, Clef and Clef-flash use Cloudflare Workers AI, and GPT-6 Luna Decisions uses OpenRouter's decisions endpoint. All four get the same request body.
- **LLMs** run through a basic Mastra agent with one fixed instruction and a strict JSON schema for the answer. There are no tools and no memory. `--no-thinking` turns thinking off with OpenRouter's `reasoning: {effort: "none"}`.
- **It's resumable.** It skips tasks already saved in the `--out` folder, so you can stop and restart it.
- **It only retries rate limits and server errors,** at most twice. It never retries a wrong or malformed answer.
- **It saves everything for each task:** request, full response, parsed answer, token usage, cost and latency. Records go to `raw/` as gzip files, with one line per API attempt in `ledger.jsonl`. API keys are redacted from everything it writes.

Hosted models change over time, so a new run may not match the study's answers exactly.

## 3. Score

```bash
python3 score/score.py results/* --json out/scores.json
```

This prints accuracy for every task set with no padding and at full padding, and the overall table: accuracy, significant drops, AUROC, cost and time. It also prints the change on the five sets with no multi-step reasoning or counting. Run on the study's saved answers, it reproduces every number in the article.

The scoring rules are at the top of `score/score.py`. In short:

- **Yes/no answers** are "yes" when P(yes) is 0.5 or more.
- **Choice answers** are rescaled to sum to 1, and the top option wins.
- **Refusals and unreadable answers** count as wrong.
- **Provider errors** are left out of the accuracy count.

## The tasks

| Set | Tasks | What the model has to do | Padding |
| --- | --- | --- | --- |
| Stacked office | 50, yes/no | Follow a chain of records, some cancelled, to find where a project lead works | Banking77 customer messages, as closed cases |
| Stacked banking | 50, choice of 77 | The same kind of chain in a support-ticket export, ending in one of 77 intents. Only two intents are ever correct | Banking77 customer messages |
| Ticket counting | 50, yes/no | Count matching rows in a 900-row table: 301 match for yes, 299 for no | Template log lines |
| Counterfactual capitals | 50, yes/no | Answer from a passage that states a wrong capital, not from memory | Notes built from five fixed sentences |
| Plain office lookup | 50, yes/no | Two short directories, employee to office and office to city | Notes built from five fixed sentences |
| Card-retention needle | 50, yes/no | Find the one open support case and tell a kept card from a near miss | Closed Banking77 cases |
| Banking77 | 50, choice of 77 | Name the intent of a real customer message | Other Banking77 messages |
| BoolQ | 50, yes/no | Answer a yes/no question about a Wikipedia passage | Other BoolQ passages |

Each task runs with no padding and at one to three padded lengths. Token counts use `cl100k_base` (js-tiktoken 1.0.21). The longest lengths are the longest inputs Jev accepted:

- 26k for the stacked sets;
- 22k for capitals and the lookup;
- 20k for counting, BoolQ and Banking77;
- 16k for the needle.

## Data

`data/` holds the frozen inputs the generators read. They were built once from public sources and are shipped as is, because the step that built them also checked them against design-time tasks that aren't part of this repo.

| File | Contents | Source |
| --- | --- | --- |
| `banking-padding.json`, `padding.json` | Banking77 customer messages used as padding | [Banking77](https://github.com/PolyAI-LDN/task-specific-datasets), PolyAI, CC BY 4.0 |
| `banking77-criteria.json` | The 77 Banking77 intents | Banking77, as above |
| `capitals.json` | Country and capital names, with the wrong capital each passage states | [mledoze/countries](https://github.com/mledoze/countries), ODbL 1.0 |
| `card-suffixes.json` | Four-digit card endings used in stacked banking | Generated |

`generate/real-data.mjs` also downloads [BoolQ](https://huggingface.co/datasets/google/boolq) (Google, CC BY-SA 3.0) and the Banking77 test set at run time.

Seeds: generated tasks 93017, BoolQ and Banking77 selection 2026093006, bootstrap intervals 93018.

## Layout

```text
data/       frozen inputs for the generators
generate/   task generation (steps 1 to 4)
lib/        the runner, the decision-model clients and the LLM agent
score/      scoring and tables
out/        generated tasks and request file (created by step 1)
results/    saved model answers (created by step 2)
```

## License

The code is licensed under the [Apache License 2.0](LICENSE). The data in `data/` and the datasets downloaded at run time keep their own licenses, listed above.
