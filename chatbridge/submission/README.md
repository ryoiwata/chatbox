# ChatBridge — AI Cost Analysis

## Development & Testing Costs

### LLM API Costs

| Category | Details |
|---|---|
| **Provider** | Anthropic (Claude Sonnet 4.6) |
| **Model** | `claude-sonnet-4-6` |
| **Pricing** | $3.00 / 1M input tokens, $15.00 / 1M output tokens |
| **Development period** | 7 days (April 1–7, 2026) |

### Token Consumption

| Metric | Estimate |
|---|---|
| **Total API calls** | ~800–1,000 calls |
| **Input tokens consumed** | ~12M tokens |
| **Output tokens consumed** | ~3M tokens |
| **Input token cost** | ~$36.00 |
| **Output token cost** | ~$45.00 |
| **Total LLM cost (development)** | **~$81.00** |

### Breakdown by Activity

| Activity | % of Calls | Notes |
|---|---|---|
| Chat testing & debugging | 40% | Manual testing of streaming, multi-turn conversations |
| Tool call round-trips | 35% | Chess moves, weather queries, Spotify tool invocations — each tool call requires a full Claude request with system prompt + tool schemas + conversation history |
| System prompt iteration | 15% | Refining tool injection, app context formatting, plugin activation prompts |
| Error handling & edge cases | 10% | Timeout testing, circuit breaker triggers, invalid tool calls |

### Other AI-Related Costs

| Item | Cost |
|---|---|
| Railway hosting (Hobby plan) | $5.00/month |
| Railway Postgres addon | Included in usage |
| OpenWeatherMap API (free tier) | $0.00 |
| Spotify API (free tier) | $0.00 |
| **Total non-LLM costs** | **~$5.00/month** |

### Total Development Cost

| Category | Cost |
|---|---|
| LLM API (Anthropic) | ~$81.00 |
| Infrastructure (Railway, 1 month) | ~$5.00 |
| External APIs | $0.00 |
| **Total** | **~$86.00** |

---

## Production Cost Projections

### Assumptions

| Parameter | Value | Rationale |
|---|---|---|
| Sessions per user per month | 10 | Students use the platform ~2–3 times/week |
| Messages per session | 8 | Typical conversation length including app interactions |
| Tool invocations per session | 4 | Average across app types (chess has more, weather has fewer) |
| Input tokens per message | ~2,500 | System prompt (~1,200) + conversation history (~800) + tool schemas (~500) |
| Output tokens per message | ~500 | Claude's response including tool calls |
| Input tokens per tool round-trip | ~3,000 | Re-sends conversation + tool result + app context |
| Output tokens per tool round-trip | ~400 | Claude's continuation after processing tool result |
| Model | Claude Sonnet 4.6 | $3.00/M input, $15.00/M output |

### Per-Session Token Math

| Component | Input Tokens | Output Tokens |
|---|---|---|
| 8 messages × 2,500 input | 20,000 | — |
| 8 messages × 500 output | — | 4,000 |
| 4 tool round-trips × 3,000 input | 12,000 | — |
| 4 tool round-trips × 400 output | — | 1,600 |
| **Total per session** | **32,000** | **5,600** |

**Cost per session:**
- Input: 32,000 tokens × $3.00/M = $0.096
- Output: 5,600 tokens × $15.00/M = $0.084
- **Total per session: ~$0.18**

### Monthly Cost by Scale

| Scale | Sessions/Month | LLM Cost | Infrastructure (Railway) | Total Monthly Cost |
|---|---|---|---|---|
| **100 users** | 1,000 | $180 | $5 (Hobby) | **~$185/month** |
| **1,000 users** | 10,000 | $1,800 | $20 (Pro) | **~$1,820/month** |
| **10,000 users** | 100,000 | $18,000 | $50–100 (Pro) | **~$18,100/month** |
| **100,000 users** | 1,000,000 | $180,000 | $300–500 (Enterprise) | **~$180,500/month** |

### Cost Optimization Strategies

At scale, several strategies significantly reduce the LLM cost:

| Strategy | Savings | Applicable At |
|---|---|---|
| **Prompt caching** | Up to 90% on repeated system prompts | All scales — the system prompt + tool schemas are identical across requests within a session |
| **Batch API** | 50% off for non-real-time tasks | Cost analysis, session summaries, offline grading |
| **Context summarization** | 20–30% input reduction | 1,000+ users — summarize long conversation histories instead of sending full context |
| **Model tiering** | 60–80% savings on simple routing | 10,000+ users — use Haiku 4.5 ($1/$5) for app activation routing, Sonnet for complex analysis |

### Optimized Projections (with prompt caching + model tiering)

| Scale | Base Cost | With Caching (90% input savings on system prompt) | With Caching + Tiering | Effective Cost |
|---|---|---|---|---|
| **100 users** | $185 | ~$120 | ~$100 | **~$100/month** |
| **1,000 users** | $1,820 | ~$1,100 | ~$800 | **~$800/month** |
| **10,000 users** | $18,100 | ~$10,500 | ~$7,000 | **~$7,000/month** |
| **100,000 users** | $180,500 | ~$100,000 | ~$55,000 | **~$55,000/month** |

### Cost Per User Per Month

| Scale | Unoptimized | Optimized |
|---|---|---|
| 100 users | $1.85/user | $1.00/user |
| 1,000 users | $1.82/user | $0.80/user |
| 10,000 users | $1.81/user | $0.70/user |
| 100,000 users | $1.81/user | $0.55/user |

---

## Key Observations

**LLM costs dominate.** At every scale, Anthropic API spend accounts for 97%+ of total cost. Infrastructure (Railway + Postgres) is negligible by comparison. This is typical for LLM-powered applications.

**Tool calls are expensive.** Each tool invocation requires a full round-trip to Claude — the conversation history, system prompt, and tool schemas are re-sent every time. A chess game with 20 moves generates 20+ API calls for a single session. Prompt caching is critical to control this.

**The system prompt is the caching target.** The system prompt (~1,200 tokens) plus tool schemas (~500 tokens) are identical across every request in a session. With Anthropic's prompt caching, these are written once and read at 90% discount on subsequent calls — this alone can cut session costs by 30–40%.

**Model tiering is the biggest lever at scale.** Simple routing decisions ("should I activate chess or weather?") don't need Sonnet. Using Haiku 4.5 ($1/$5 per M tokens) for `activate_app` routing and reserving Sonnet for complex responses (chess analysis, quiz generation) could cut costs by 50%+ at 10K+ users.

**Infrastructure scales linearly on Railway.** Railway's usage-based pricing (Hobby at $5/month, Pro at $20/month) keeps hosting costs low. At 100K users, a dedicated instance or multiple replicas would be needed, but even then Railway Enterprise pricing is a fraction of LLM spend.