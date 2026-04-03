# ChatBridge Implementation Plan

> Generated 2026-04-02 from architecture interview. Covers every decision gap between SPEC.md and
> actual build sequence. Read SPEC.md and CODEBASE_ANALYSIS.md first; this document adds the
> _how_ and _in what order_.

---

## Key Decisions (Interview Summary)

| Topic | Decision |
|---|---|
| Build order | Thin backend scaffold → vertical slice (test-app) → chess → auth UI → weather → Spotify |
| WS↔postMessage handoff | Client drives continuation (multi-turn, not mid-stream hold) |
| Multi-tool sync | Collect all tool results, send batch to server in one message |
| iframe placement | Side panel (Artifact.tsx pattern). Compact inline card in chat history. |
| LLM pipeline split | Existing Chatbox pipeline untouched for normal sessions. Backend WS only for ChatBridge sessions. |
| Session activation trigger | `activate_app` tool injected at stream-text.ts:296. Executes client-side. Flips session to WS mode. |
| Railway topology | One service. Express serves SPA + demo apps at /apps/* + API. No CORS needed. |
| Sandbox | `allow-scripts` only. Sandboxed iframes get opaque `null` origin. `event.source` is primary validation. |
| OAuth token path | Stays server-side. Callback → parent → iframe gets `auth_ready` signal only. Backend makes Spotify calls. |
| App state → LLM | Client piggybacks `appContext` on every `user_message` WS payload. Backend stateless between calls. |
| Auth UX | Real auth + `POST /api/auth/demo` for friction-free grading. Seed script creates demo user. |
| History persistence | Messages in Postgres (platform contract). Optional `restore` signal to iframe. App state doesn't persist. |
| Demo app priority | Chess (day 3-4) → Weather (day 5) → Spotify (day 6-7). |

---

## Full Turn-by-Turn Flow (Critical Path)

```
1. User sends "let's play chess" in chat
2. Chatbox client-side pipeline runs (normal)
3. streamText at line ~296: activate_app tool is in scope
4. LLM calls activate_app({ appName: "chess" })
5. activate_app.execute():
   - Fetches chess app from chatBridgeStore registry
   - Opens WebSocket to wss://{host}/ws?token={jwt}
   - Sets chatBridgeStore.sessions[sessionId] = { active: true, apps: ['chess'] }
   - Opens ChatBridgeFrame side panel with chess iframe URL
   - Returns { status: 'activated', app: 'chess', tools: ['start_game', 'make_move', 'get_board_state'] }
6. Chatbox finishes that turn normally (LLM responds "Chess activated! Starting a game...")

--- ALL SUBSEQUENT MESSAGES GO THROUGH BACKEND WS ---

7. LLM calls start_game({ color: 'white' })
   (backend gets this from OpenAI, sends { type: 'tool_call', toolCallId, toolName, params } to client)
8. Client receives tool_call, forwards to chess iframe:
   iframeRef.current?.contentWindow?.postMessage({ type: 'tool_invoke', toolCallId, toolName: 'start_game', params }, '*')
9. Chess iframe: initializes game, renders board, sends:
   { type: 'tool_result', toolCallId, result: { fen: '...initial FEN...', message: 'Game started' } }
10. Client receives tool_result postMessage (validates event.source === iframeRef)
11. Client sends { type: 'tool_result', toolCallId, result } to backend via WS
12. Backend feeds tool result into conversation, calls OpenAI for continuation
13. LLM streams "Game started! You're playing white. Make your move." → tokens flow to client
14. User drags piece on board → chess.js validates → chess app sends state_update → chatBridgeStore updates
15. User asks "what should I do?" →
    client sends WS message: { type: 'user_message', content: '...', appContext: { states: { chess: { fen: '...' } } } }
16. Backend builds system prompt with FEN context → LLM analyzes → streams response
```

---

## Milestone 0 — Thin Backend Scaffold
**Goal:** Express + Postgres + WebSocket streaming, one hardcoded user. Nothing else.
**Time estimate:** Day 1 morning

### Files to Create
| File | Purpose |
|---|---|
| `server/package.json` | Node.js project: express, ws, openai, @prisma/client, jsonwebtoken, bcrypt, zod |
| `server/tsconfig.json` | TypeScript strict mode, target: ES2022, outDir: dist/ |
| `server/prisma/schema.prisma` | Minimal schema: User, Conversation, Message only |
| `server/src/index.ts` | Express bootstrap, attach WebSocket server, static file serving for /apps/* and dist/ |
| `server/src/ws/chatHandler.ts` | WebSocket connection handler: authenticate JWT from query string, stream OpenAI response back |
| `server/src/lib/prisma.ts` | Prisma client singleton |
| `server/.env.example` | `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, `PORT`, `CLIENT_URL` |

### Minimal Prisma Schema
```prisma
model User {
  id           String         @id @default(uuid())
  email        String         @unique
  passwordHash String         @map("password_hash")
  createdAt    DateTime       @default(now()) @map("created_at")
  conversations Conversation[]
}

model Conversation {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  title     String    @default("New conversation")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  user      User      @relation(fields: [userId], references: [id])
  messages  Message[]
}

model Message {
  id              String   @id @default(uuid())
  conversationId  String   @map("conversation_id")
  role            String
  content         String?
  toolCallId      String?  @map("tool_call_id")
  toolName        String?  @map("tool_name")
  toolParams      Json?    @map("tool_params")
  appContext      Json?    @map("app_context")
  createdAt       DateTime @default(now()) @map("created_at")
  conversation    Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}
```

### WebSocket chatHandler contract
- Authenticate: `ws://{host}/ws?token={jwt}` — verify JWT on upgrade, reject with code 4001 if invalid
- Receive: `{ type: 'user_message', conversationId, content, appContext? }`
- Send (streaming): `{ type: 'token', data: '...' }` per chunk
- Send (tool call): `{ type: 'tool_call', toolCallId, toolName, params }`
- Receive (tool result): `{ type: 'tool_result', toolCallId, result }`
- Send (done): `{ type: 'done' }`
- Send (error): `{ type: 'error', message: '...' }`

### Acceptance Criteria
- [ ] `cd server && npm run dev` starts without errors
- [ ] `wscat -c 'ws://localhost:3000/ws?token=HARDCODED_TEST_TOKEN'` connects
- [ ] Sending `{ type: 'user_message', conversationId: 'test', content: 'hello' }` streams back tokens
- [ ] `npx prisma studio` shows User, Conversation, Message tables

---

## Milestone 1 — Frontend Wiring: chatBridgeStore + activate_app
**Goal:** The Chatbox frontend gains awareness of ChatBridge. activate_app tool exists and works.
**Time estimate:** Day 1 afternoon — Day 2 morning
**Depends on:** Milestone 0 (WebSocket endpoint must exist)

### Files to Create
| File | Purpose |
|---|---|
| `src/shared/types/chatbridge.ts` | Zod schemas: ToolSchemaSchema, PluginManifestSchema, BridgeMessageSchema, ChatBridgeSessionState |
| `src/renderer/stores/chatBridgeStore.ts` | Zustand: plugin registry, session state, active apps, app state snapshots |
| `src/renderer/packages/chatbridge/controller.ts` | Plugin lifecycle: loadRegistry(), activate(), deactivate(), getActiveTools() |
| `src/renderer/packages/chatbridge/ws-client.ts` | WebSocket client: connect, send, receive, reconnect, heartbeat |

### Files to Modify
| File | Change | Line |
|---|---|---|
| `src/renderer/packages/model-calls/stream-text.ts` | Inject `activate_app` into tool set. `activate_app.execute()` calls `chatBridgeController.activate()`, opens WS, updates store. | ~296 |
| `src/renderer/stores/session/generation.ts` | Add conditional branch at top of `generate()`: if `chatBridgeStore.isActive(sessionId)`, call `chatBridgeWsClient.send()` instead of normal streamText pipeline | ~110 |

### chatBridgeStore shape
```typescript
type ChatBridgeStore = {
  // App registry (from GET /api/apps, fetched once on app load)
  registry: PluginManifest[]

  // Per-session state
  sessions: Map<string, {
    active: boolean
    apps: string[]                          // active app IDs
    appStates: Record<string, unknown>      // latest state_update per app
    failureCounts: Record<string, number>   // for circuit breaker
  }>

  // Pending tool calls (toolCallId → resolve/reject)
  pendingToolCalls: Map<string, {
    resolve: (result: unknown) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>

  // Actions
  setRegistry: (apps: PluginManifest[]) => void
  activateSession: (sessionId: string) => void
  activateApp: (sessionId: string, appId: string) => void
  deactivateApp: (sessionId: string, appId: string) => void
  updateAppState: (sessionId: string, appId: string, state: unknown) => void
  isActive: (sessionId: string) => boolean
  getAppContext: (sessionId: string) => Record<string, unknown>
  recordFailure: (sessionId: string, appId: string) => number  // returns new count
}
```

### activate_app tool (injected into stream-text.ts:296)
```typescript
const activateAppTool: Tool = {
  description: `Activate a third-party application. Available apps: ${appListSummary}`,
  parameters: z.object({
    appName: z.string().describe('Name of the app to activate (e.g., "chess", "weather", "spotify")')
  }),
  execute: async ({ appName }, { toolCallId }) => {
    const app = chatBridgeStore.getState().registry.find(a =>
      a.name.toLowerCase() === appName.toLowerCase()
    )
    if (!app) return { error: `App "${appName}" not found. Available: ${appNames.join(', ')}` }

    // Opens WebSocket, activates session, triggers iframe open via store
    await chatBridgeController.activate(currentSessionId, app)
    return {
      status: 'activated',
      app: app.name,
      tools: app.tools.map(t => t.name),
      description: app.description
    }
  }
}
```

### Acceptance Criteria
- [ ] `chatBridgeStore.getState().registry` is populated from `/api/apps` on app load
- [ ] Saying "activate test app" in chat → LLM calls `activate_app` → store updated, no errors
- [ ] `chatBridgeStore.getState().isActive(sessionId)` returns `true` after activation
- [ ] Second message after activation → `generate()` takes the WebSocket branch

---

## Milestone 2 — Test App + iframe + postMessage Protocol
**Goal:** The full postMessage protocol works end-to-end with the minimal test app. No chess yet.
**Time estimate:** Day 2
**Depends on:** Milestone 1

### Files to Create
| File | Purpose |
|---|---|
| `apps/test-app/index.html` | ~30-line HTML: sends ready, registers dummy_tool, responds to tool_invoke with canned result, sends state_update on timer, sends completion after 3 invocations |
| `src/renderer/components/ChatBridgeFrame.tsx` | Side panel iframe: renders when a session has active apps, handles postMessage in/out |
| `src/renderer/packages/chatbridge/message-handler.ts` | Validates and dispatches incoming postMessage (source check → type check → Zod parse → route to store) |

### ChatBridgeFrame responsibilities
1. Renders `<iframe sandbox="allow-scripts" src={app.url} ref={iframeRef} />`
2. `useEffect` registers `window.addEventListener('message', handleMessage)` with cleanup
3. On iframe `load`: sends `{ type: 'ready_ack' }` back (or waits for `{ type: 'ready' }` from iframe with 5s timeout)
4. Exposes `sendToolInvoke(toolCallId, toolName, params)` — called by ws-client when server sends `tool_call`
5. On `tool_result` received: resolves the pending Promise in `chatBridgeStore.pendingToolCalls`

### postMessage validation (message-handler.ts)
```typescript
function handleMessage(event: MessageEvent, iframeRef: RefObject<HTMLIFrameElement>) {
  // 1. Source validation — primary security check
  if (event.source !== iframeRef.current?.contentWindow) return

  // 2. Type exists and is known
  const knownTypes = ['ready', 'register_tools', 'tool_result', 'state_update', 'completion']
  if (!event.data?.type || !knownTypes.includes(event.data.type)) return

  // 3. Structural validation
  const parsed = BridgeMessageSchema.safeParse(event.data)
  if (!parsed.success) return

  // 4. Dispatch
  dispatch(parsed.data)
}
```

### Test app (apps/test-app/index.html)
```html
<!DOCTYPE html>
<html>
<head><title>ChatBridge Test App</title></head>
<body>
<script>
  let invocationCount = 0

  // 1. Announce ready
  window.parent.postMessage({ type: 'ready' }, '*')

  // 2. Register a dummy tool
  window.parent.postMessage({
    type: 'register_tools',
    schemas: [{
      name: 'dummy_action',
      description: 'A test tool that always succeeds',
      parameters: { type: 'object', properties: { message: { type: 'string' } } }
    }]
  }, '*')

  // 3. Listen for tool invocations
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'tool_invoke') {
      invocationCount++
      setTimeout(() => {
        window.parent.postMessage({
          type: 'tool_result',
          toolCallId: event.data.toolCallId,
          result: { success: true, invocationCount, message: `Test response #${invocationCount}` }
        }, '*')
        // Send state_update after each invocation
        window.parent.postMessage({
          type: 'state_update',
          state: { invocationCount, lastAction: event.data.toolName }
        }, '*')
        // Completion after 3 invocations
        if (invocationCount >= 3) {
          window.parent.postMessage({ type: 'completion', result: { totalInvocations: 3 } }, '*')
        }
      }, 100)
    }
  })
</script>
</body>
</html>
```

### Acceptance Criteria
- [ ] Test app iframe loads in side panel
- [ ] Console shows `[ChatBridge] App ready: test-app`
- [ ] LLM can call `dummy_action` → tool result received → LLM continues
- [ ] `chatBridgeStore.getState().sessions[sessionId].appStates` updates after each `state_update`
- [ ] After 3 invocations: `completion` signal received, system message appears in chat
- [ ] Timeout: artificially delay tool_result in test app → 10s → error result injected, LLM responds gracefully

---

## Milestone 3 — Full Vertical Slice: Backend Tool Call Loop
**Goal:** Complete end-to-end with test app through the backend.
**Time estimate:** Day 2-3
**Depends on:** Milestones 1 and 2

### Backend changes needed
**`server/src/ws/chatHandler.ts` — expand to handle tool call loop:**

```typescript
async function handleUserMessage(ws, { conversationId, content, appContext }, userId) {
  // 1. Load conversation history from Postgres
  const history = await loadHistory(conversationId)

  // 2. Build system prompt with app context
  const systemPrompt = buildSystemPrompt(appContext)

  // 3. Stream OpenAI response
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content }],
    tools: getToolSchemas(appContext?.activeApps),
    stream: true
  })

  // 4. Process stream
  let toolCalls: ToolCall[] = []
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta
    if (delta?.content) ws.send(JSON.stringify({ type: 'token', data: delta.content }))
    if (delta?.tool_calls) accumulate(toolCalls, delta.tool_calls)
  }

  // 5. If tool calls, send to client and wait for results
  if (toolCalls.length > 0) {
    const results = await Promise.all(toolCalls.map(tc => {
      ws.send(JSON.stringify({ type: 'tool_call', toolCallId: tc.id, toolName: tc.function.name, params: JSON.parse(tc.function.arguments) }))
      return waitForToolResult(ws, tc.id, 10_000)  // 10s timeout
    }))
    // Persist tool messages, recurse for continuation turn
    await persistMessages(conversationId, toolCalls, results)
    await handleUserMessage(ws, { conversationId, content: '', appContext }, userId)  // continuation
    return
  }

  ws.send(JSON.stringify({ type: 'done' }))
  await persistMessages(conversationId, [{ role: 'user', content }], [/* assistant response */])
}
```

**`waitForToolResult`**: registers a one-time listener on the WS connection for `{ type: 'tool_result', toolCallId }`, rejects after timeout.

### ws-client.ts (frontend) — handle incoming tool_call from server
```typescript
wsClient.on('tool_call', ({ toolCallId, toolName, params }) => {
  const activeFrame = chatBridgeStore.getState().getActiveFrame(sessionId)
  activeFrame.sendToolInvoke(toolCallId, toolName, params)
  // The postMessage response will resolve the pending Promise in chatBridgeStore
  // That resolution sends tool_result back to the server
})
```

### Acceptance Criteria
- [ ] "Use the dummy action" → LLM calls `dummy_action` → server sends `tool_call` to client → client forwards to test-app iframe → result returns → server sends continuation → LLM responds
- [ ] Multi-tool: LLM calls `dummy_action` twice in one turn → both results collected → continuation turn works
- [ ] Tool timeout: test app delays 11s → server receives error result → LLM responds with friendly message
- [ ] Messages persisted to Postgres (check with Prisma Studio)

---

## Milestone 4 — Chess App
**Goal:** Full chess game playable through ChatBridge. Most complex demo app.
**Time estimate:** Day 3-4
**Depends on:** Milestone 3 (full tool call loop proven)

### Files to Create
| File | Purpose |
|---|---|
| `apps/chess/package.json` | React + Vite SPA: react-chessboard, chess.js |
| `apps/chess/src/main.tsx` | Entry: render `<ChessApp />` |
| `apps/chess/src/App.tsx` | Board component, postMessage protocol, game state |
| `apps/chess/src/hooks/useChessProtocol.ts` | postMessage in/out: tool_invoke handling, state_update sending |

### Chess tools (registered in Postgres via seed, injected by backend when chess is active)
```typescript
const chessTools = [
  {
    name: 'start_game',
    description: 'Start a new chess game',
    parameters: {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['white', 'black'], description: 'Player color' }
      }
    }
  },
  {
    name: 'make_move',
    description: 'Make a chess move using algebraic notation',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source square e.g. e2' },
        to: { type: 'string', description: 'Destination square e.g. e4' },
        promotion: { type: 'string', enum: ['q','r','b','n'], description: 'Pawn promotion piece (optional)' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'get_board_state',
    description: 'Get the current board position as FEN string and game status',
    parameters: { type: 'object', properties: {} }
  }
]
```

### Chess App protocol implementation
```typescript
// On mount:
window.parent.postMessage({ type: 'ready' }, '*')
window.parent.postMessage({ type: 'register_tools', schemas: chessTools }, '*')

// Handle tool_invoke:
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'tool_invoke') return
  const { toolCallId, toolName, params } = event.data

  if (toolName === 'start_game') {
    const game = new Chess()
    setGame(game)
    setPlayerColor(params.color ?? 'white')
    sendToolResult(toolCallId, { fen: game.fen(), message: `Game started. You're playing ${params.color ?? 'white'}.` })
  }

  if (toolName === 'make_move') {
    const result = game.move({ from: params.from, to: params.to, promotion: params.promotion })
    if (!result) {
      sendToolResult(toolCallId, { error: `Illegal move: ${params.from} to ${params.to}` })
    } else {
      sendStateUpdate()
      sendToolResult(toolCallId, { fen: game.fen(), move: result.san, check: game.inCheck() })
      if (game.isGameOver()) sendCompletion()
    }
  }

  if (toolName === 'get_board_state') {
    sendToolResult(toolCallId, { fen: game.fen(), turn: game.turn(), moveCount: game.history().length })
  }
})

// Direct piece drag (user move — NOT through LLM):
function onPieceDrop(from, to) {
  const result = game.move({ from, to })
  if (!result) return false  // react-chessboard rejects illegal move
  sendStateUpdate()
  if (game.isGameOver()) sendCompletion()
  return true
}
```

### Backend: inject chess tools when chess is active
When `appContext.activeApps` includes `'chess'`, the backend fetches chess tool schemas from Postgres (`AppRegistration.toolSchemas`) and adds them to the OpenAI function list alongside `activate_app`.

### Seed data
`server/prisma/seed.ts` creates:
- Demo user: `demo@chatbridge.app` / `demo123`
- Chess app registration with `status: 'approved'`
- Test app registration with `status: 'approved'`

### Acceptance Criteria
- [ ] "Let's play chess" → `activate_app` → chess iframe opens → LLM calls `start_game` → board renders
- [ ] User drags a piece → board updates → `state_update` sent → `chatBridgeStore` updated
- [ ] "What should I do here?" → current FEN in system prompt → LLM analyzes position
- [ ] LLM calls `make_move` with a suggestion → board executes it
- [ ] `make_move` with illegal move → error result → LLM responds "that move isn't valid"
- [ ] Checkmate → `completion` signal → system message in chat

---

## Milestone 5 — Real Auth
**Goal:** JWT auth endpoints, middleware, rate limiting, seed script, demo endpoint.
**Time estimate:** Day 4
**Depends on:** Milestone 0 (Prisma + Express)

### Files to Create/Expand
| File | Purpose |
|---|---|
| `server/src/routes/auth.ts` | POST /api/auth/register, /login, /refresh, /demo |
| `server/src/routes/apps.ts` | GET /api/apps, POST /api/apps/register, PATCH /api/apps/:id/status |
| `server/src/routes/conversations.ts` | GET/POST/DELETE /api/conversations, GET /api/conversations/:id |
| `server/src/middleware/auth.ts` | JWT verification, attaches `req.user` |
| `server/src/middleware/rateLimit.ts` | express-rate-limit configs for auth (10/min) and API (60/min) |
| `server/prisma/schema.prisma` | Add AppRegistration, OAuthToken, ToolInvocation models |
| `server/prisma/seed.ts` | Creates demo user + demo app registrations |

### POST /api/auth/demo
```typescript
router.post('/demo', asyncHandler(async (req, res) => {
  const demoUser = await prisma.user.findUnique({ where: { email: 'demo@chatbridge.app' } })
  if (!demoUser) return res.status(503).json({ error: 'Demo not configured' })
  const token = jwt.sign({ userId: demoUser.id }, process.env.JWT_SECRET!, { expiresIn: '24h' })
  res.json({ token, user: { id: demoUser.id, email: demoUser.email } })
}))
```

### Full AppRegistration schema
```prisma
model AppRegistration {
  id           String   @id @default(uuid())
  name         String
  url          String
  description  String
  toolSchemas  Json     @map("tool_schemas")
  status       String   @default("pending")
  timeout      Int      @default(10000) // ms
  createdAt    DateTime @default(now()) @map("created_at")
  toolInvocations ToolInvocation[]
}
```

### Acceptance Criteria
- [ ] `POST /api/auth/register` → 201 with JWT
- [ ] `POST /api/auth/login` → 200 with JWT / 401 for wrong password
- [ ] `POST /api/auth/demo` → JWT for demo user
- [ ] Protected routes return 401 without JWT
- [ ] Rate limit: 11th login attempt in 60s → 429
- [ ] `npm run seed` creates demo user and 3 approved app registrations
- [ ] `GET /api/apps` returns only approved apps with tool schemas

---

## Milestone 6 — Auth UI in Chatbox
**Goal:** Login page, register page, "Try Demo" button. JWT persisted across page refreshes.
**Time estimate:** Day 5
**Depends on:** Milestone 5

### Files to Create
| File | Purpose |
|---|---|
| `src/renderer/routes/auth/login.tsx` | Login form + "Try Demo" button |
| `src/renderer/routes/auth/register.tsx` | Register form |
| `src/renderer/stores/authStore.ts` | Zustand: jwt, user, login(), logout(), loginDemo() |

### Auth flow
1. On app load: `authStore` checks `localStorage.getItem('chatbridge_jwt')` and validates via `/api/auth/refresh`
2. If no valid token: redirect to `/auth/login`
3. "Try Demo" → `POST /api/auth/demo` → store JWT → redirect to `/chat`
4. JWT attached to every `fetch('/api/...')` and WebSocket connection: `ws://.../ws?token=${jwt}`

### Acceptance Criteria
- [ ] Fresh browser → redirected to login page
- [ ] "Try Demo" click → lands in chat, no form required
- [ ] Page refresh → still logged in (JWT revalidated)
- [ ] Logout → redirected to login

---

## Milestone 7 — Weather App
**Goal:** Second demo app proving multi-app routing and stateless tool pattern.
**Time estimate:** Day 5
**Depends on:** Milestone 4 (chess proves the platform, weather reuses the pattern)

### Files to Create
| File | Purpose |
|---|---|
| `apps/weather/src/App.tsx` | Weather widget: shows current conditions and 5-day forecast |
| `server/src/services/weather.ts` | Fetches from weather API using server-side `WEATHER_API_KEY` |
| `server/src/routes/weather.ts` | Internal route used by tool execution, NOT exposed as REST |

### Weather tools
```typescript
const weatherTools = [
  { name: 'get_current_weather', description: 'Get current weather for a location', parameters: { ... } },
  { name: 'get_forecast', description: 'Get 5-day forecast', parameters: { ... } }
]
```

Weather tool execution happens entirely on the backend (API key never leaves server). The `tool_result` returned to the iframe is just display data.

### Seed update
Add weather app registration with `status: 'approved'` to `server/prisma/seed.ts`.

### Acceptance Criteria
- [ ] "What's the weather in Tokyo?" → `activate_app({ appName: 'weather' })` → iframe opens → `get_current_weather` called → weather widget renders
- [ ] Chess and weather both active: "switch to weather" → weather tools in scope, chess still loaded
- [ ] LLM routes correctly when both apps are active (scenario 6)

---

## Milestone 8 — Spotify + OAuth
**Goal:** Third demo app proving OAuth2 popup flow.
**Time estimate:** Day 6-7
**Depends on:** Milestone 5 (OAuthToken table in Postgres)

### Files to Create
| File | Purpose |
|---|---|
| `apps/spotify/src/App.tsx` | Playlist UI: shows search results and created playlists |
| `server/src/routes/oauth.ts` | GET /api/oauth/spotify/authorize, GET /api/oauth/spotify/callback |
| `server/src/services/spotify.ts` | Spotify API calls using stored tokens (search, create playlist, add tracks) |

### OAuth flow (exact sequence)
1. User asks "Create me a jazz playlist" → `activate_app({ appName: 'spotify' })`
2. Spotify iframe opens, shows "Connect Spotify" button
3. User clicks → parent `window.open('/api/oauth/spotify/authorize')`
4. Backend redirects to `accounts.spotify.com/authorize?client_id=...&state=CSRF`
5. User approves → Spotify redirects to `/api/oauth/spotify/callback?code=...&state=...`
6. Backend: validates state, exchanges code for tokens, stores in `oauth_tokens` table
7. Callback page: `window.opener.postMessage({ type: 'oauth_complete', provider: 'spotify' }, CLIENT_URL); window.close()`
8. Parent receives `oauth_complete` → `chatBridgeStore.markAuthenticated('spotify')` → sends `{ type: 'auth_ready', provider: 'spotify' }` to iframe
9. Iframe hides the "Connect Spotify" button
10. LLM calls `create_playlist({ name: 'Jazz Vibes', genres: ['jazz'] })` → backend makes Spotify API call → returns playlist URL

### OAuthToken schema
```prisma
model OAuthToken {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  provider     String
  accessToken  String    @map("access_token")
  refreshToken String?   @map("refresh_token")
  expiresAt    DateTime? @map("expires_at")
  user         User      @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
}
```

### Acceptance Criteria
- [ ] OAuth popup opens, user can complete Spotify auth
- [ ] Token stored in Postgres, not sent to browser
- [ ] `create_playlist` tool called → playlist created on Spotify → URL returned
- [ ] Token auto-refreshed before each tool invocation

---

## Milestone 9 — Error Handling + Circuit Breaker
**Goal:** All failure modes handled gracefully. Chat never breaks.
**Time estimate:** Day 7
**Depends on:** All app milestones

### Error states

| Failure | Behavior | Where handled |
|---|---|---|
| Tool timeout (10s) | Error result injected: `{ error: 'timeout', message: 'App did not respond' }`. LLM responds: "The app didn't respond. Try again?" | `chatBridgeStore.pendingToolCalls` timeout handler |
| Iframe load failure (5s) | Panel shows: "[App name] failed to load" + Retry/Close buttons | `ChatBridgeFrame.tsx` onLoad timeout |
| Tool execution error | Error result injected normally. LLM handles conversationally. | Normal tool_result path |
| Circuit breaker: 3 consecutive failures | Panel closes. System message: "Chess is having issues and has been deactivated." Tools removed from active set. | `chatBridgeStore.recordFailure()` |
| WebSocket disconnect | Reconnect with exponential backoff (1s, 2s, 4s, max 30s). Show reconnecting indicator. | `ws-client.ts` |
| Backend error | `{ type: 'error', message: 'Generation failed. Please try again.' }` → shown as system message | `chatHandler.ts` catch block |

### Circuit breaker implementation
```typescript
// In chatBridgeStore:
recordFailure(sessionId, appId) {
  const count = sessions[sessionId].failureCounts[appId] = (failureCounts[appId] ?? 0) + 1
  if (count >= 3) {
    this.deactivateApp(sessionId, appId)
    // Trigger system message via callback
  }
  return count
}
```

### Acceptance Criteria
- [ ] Test app with 11s delay → timeout error → LLM responds gracefully → chat continues
- [ ] Chess iframe src set to invalid URL → 5s → error card in panel → retry button works
- [ ] 3 consecutive tool failures → panel closes → system message → subsequent messages don't invoke chess tools
- [ ] WebSocket disconnects → reconnects automatically → no message loss

---

## Milestone 10 — Tests
**Goal:** Required test coverage for grading. Run in parallel with app development.
**Time estimate:** Day 5-7 (parallel)

### Backend tests
```
server/src/__tests__/
  auth.test.ts           — register, login, refresh, demo, rate limiting
  apps.test.ts           — register app, list approved, status update
  conversations.test.ts  — CRUD, message persistence
  ws.test.ts             — connection auth, user_message flow, tool call loop
  middleware.test.ts     — JWT verification, attach req.user
```

### Frontend tests
```
src/renderer/packages/chatbridge/__tests__/
  tool-bridge.test.ts    — ToolSchemaSchema → AI SDK ToolSet conversion
  message-handler.test.ts — postMessage validation (source, type, Zod)
  controller.test.ts     — activate/deactivate lifecycle, timeout, circuit breaker
```

### Key test: postMessage validation
```typescript
it('ignores messages from unknown source', () => {
  const handler = createMessageHandler(iframeRef)
  const fakeFrame = document.createElement('iframe')
  handler({ source: fakeFrame.contentWindow, data: { type: 'tool_result', toolCallId: 'x', result: {} } })
  expect(store.pendingToolCalls.get('x')).toBeUndefined()  // not resolved
})
```

### Acceptance Criteria
- [ ] `cd server && npm test` → all tests pass
- [ ] Auth endpoint tests cover: happy path, duplicate email, wrong password, expired token, rate limit
- [ ] WebSocket test covers: auth rejection, tool call loop, timeout
- [ ] postMessage validation: accepts valid source, rejects unknown source, rejects unknown type

---

## Milestone 11 — Deployment on Railway
**Goal:** Single Railway service serving everything. Demo works at production URL.
**Time estimate:** Day 7

### Build script (`package.json` root scripts)
```json
{
  "build:all": "pnpm build:web && npm run build --prefix apps/chess && npm run build --prefix apps/weather && npm run build --prefix apps/spotify && npm run build --prefix server",
  "start": "cd server && npm start"
}
```

### Express static serving (server/src/index.ts)
```typescript
// API routes first
app.use('/api', apiRoutes)

// Demo apps as static files (same origin, sandboxed by iframe sandbox attribute)
app.use('/apps/chess', express.static(path.join(__dirname, '../../apps/chess/dist')))
app.use('/apps/weather', express.static(path.join(__dirname, '../../apps/weather/dist')))
app.use('/apps/spotify', express.static(path.join(__dirname, '../../apps/spotify/dist')))
app.use('/apps/test-app', express.static(path.join(__dirname, '../../apps/test-app')))

// Vite SPA — must be last, catch-all for client-side routing
app.use(express.static(path.join(__dirname, '../../dist')))
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../../dist/index.html')))
```

### Railway environment variables
```
DATABASE_URL=postgresql://...  (Railway Postgres addon — auto-set)
OPENAI_API_KEY=sk-...
JWT_SECRET=<random 32+ char string>
WEATHER_API_KEY=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
PORT=3000  (Railway sets this automatically)
```

### App URLs in seed data
Since all apps are same-origin, registered URLs are relative paths:
```typescript
// server/prisma/seed.ts
const chessApp = await prisma.appRegistration.upsert({
  where: { id: 'chess-demo' },
  create: {
    id: 'chess-demo',
    name: 'Chess',
    url: '/apps/chess',   // relative — resolves to same origin in production
    description: 'Interactive chess game with AI analysis',
    toolSchemas: chessTools,
    status: 'approved'
  }
})
```

For local dev, urls remain `/apps/chess` (served by Express on localhost:3000).

### Acceptance Criteria
- [ ] `railway up` deploys without errors
- [ ] `https://{service}.railway.app` loads the Chatbox UI
- [ ] "Try Demo" → works → chess game playable
- [ ] WebSocket connects: `wss://{service}.railway.app/ws`
- [ ] Prisma migrations run on deploy: add to Railway start command `npx prisma migrate deploy && node dist/index.js`

---

## File Manifest (New Files)

### Backend (`server/`)
```
server/
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
└── src/
    ├── index.ts                    # Express bootstrap, static serving, WS server
    ├── lib/
    │   └── prisma.ts               # Prisma client singleton
    ├── middleware/
    │   ├── auth.ts                 # JWT verification middleware
    │   └── rateLimit.ts            # express-rate-limit configs
    ├── routes/
    │   ├── auth.ts                 # register, login, refresh, demo
    │   ├── apps.ts                 # app registry CRUD
    │   ├── conversations.ts        # conversation CRUD
    │   └── oauth.ts                # Spotify OAuth flow
    ├── services/
    │   ├── spotify.ts              # Spotify API calls (server-side)
    │   └── weather.ts              # Weather API calls (server-side)
    ├── ws/
    │   └── chatHandler.ts          # WebSocket handler: stream, tool call loop
    └── __tests__/
        ├── auth.test.ts
        ├── apps.test.ts
        ├── conversations.test.ts
        ├── ws.test.ts
        └── middleware.test.ts
```

### Frontend additions (`src/`)
```
src/
├── shared/types/
│   └── chatbridge.ts               # Zod schemas: PluginManifest, BridgeMessage, etc.
└── renderer/
    ├── stores/
    │   ├── chatBridgeStore.ts       # Plugin registry, session state, pending tool calls
    │   └── authStore.ts            # JWT, user, login/logout
    ├── components/
    │   └── ChatBridgeFrame.tsx      # Side panel iframe + postMessage wiring
    ├── packages/
    │   └── chatbridge/
    │       ├── controller.ts        # Plugin lifecycle: activate, deactivate
    │       ├── ws-client.ts         # WebSocket client with reconnect
    │       ├── message-handler.ts   # Validate + dispatch incoming postMessage
    │       └── __tests__/
    │           ├── tool-bridge.test.ts
    │           ├── message-handler.test.ts
    │           └── controller.test.ts
    └── routes/
        └── auth/
            ├── login.tsx
            └── register.tsx
```

### Demo Apps
```
apps/
├── test-app/
│   └── index.html                  # 30-line protocol compliance fixture
├── chess/
│   ├── package.json                # React + Vite, react-chessboard, chess.js
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                 # Board + postMessage protocol
│       └── hooks/
│           └── useChessProtocol.ts
├── weather/
│   ├── package.json                # React + Vite
│   └── src/
│       ├── main.tsx
│       └── App.tsx                 # Weather widget + postMessage protocol
└── spotify/
    ├── package.json                # React + Vite
    └── src/
        ├── main.tsx
        └── App.tsx                 # Playlist UI + OAuth connect button
```

### Modified Files (Chatbox core)
```
src/renderer/packages/model-calls/stream-text.ts   # Inject activate_app tool at line ~296
src/renderer/stores/session/generation.ts           # Conditional branch at line ~110
```

---

## Dependencies Between Milestones

```
M0 (backend scaffold)
  └─> M1 (frontend wiring + activate_app)
        └─> M2 (test-app + iframe + postMessage)
              └─> M3 (backend tool call loop)
                    └─> M4 (chess app)          ─> M7 (weather) ─> M9 (error handling)
                    └─> M5 (real auth)
                          └─> M6 (auth UI)
                          └─> M8 (spotify OAuth)
                    └─> M10 (tests, parallel)
                    └─> M11 (deployment, last)
```

M9 (error handling) and M10 (tests) can be developed in parallel with M7/M8 once M4 is complete.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| react-chessboard sandbox compatibility | Low | allow-scripts supports React; test early in M4 |
| Spotify OAuth popup blocked | Medium | Test on deployed URL (not localhost); popups blocked on localhost sometimes |
| OpenAI tool_call accumulation across streaming chunks | Medium | Use existing AI SDK accumulation utilities or test with a simple accumulator early in M3 |
| Railway Postgres migration on deploy | Low | `prisma migrate deploy` in start command; test before final deadline |
| Multiple active apps causing tool name collisions | Low | Backend namespaces tools as `{appId}_{toolName}` in OpenAI function list |
| Chess iframe renders but can't access react-chessboard | Low | react-chessboard is pure JS, no DOM access to parent needed; test with simple div first |
