import type { PluginManifest } from '../../../shared/types/chatbridge'
import { chatBridgeStore } from '../../stores/chatBridgeStore'
import { API_BASE, useAuthStore } from '../../stores/authStore'
import { ChatBridgeWsClient } from './ws-client'

const HARDCODED_FALLBACK_APPS: PluginManifest[] = [
  {
    id: 'test-app',
    name: 'Test App',
    url: '/apps/test-app',
    description: 'Protocol compliance test fixture',
    tools: [
      {
        name: 'dummy_action',
        description: 'A test tool that always succeeds',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Optional message' },
          },
        },
      },
    ],
    status: 'approved',
    authRequired: false,
  },
  {
    id: 'chess',
    name: 'Chess',
    url: '/apps/chess',
    description:
      'Interactive chess game with AI analysis. Play chess against yourself or get move suggestions from Claude.',
    tools: [
      {
        name: 'start_game',
        description: 'Start a new chess game',
        parameters: {
          type: 'object',
          properties: {
            color: { type: 'string', enum: ['white', 'black'] },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make a chess move',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'get_board_state',
        description: 'Get the current board position and game status',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ],
    status: 'approved',
    authRequired: false,
  },
]

export const chatBridgeController = {
  async loadRegistry(): Promise<void> {
    try {
      const token = useAuthStore.getState().token
      const res = await fetch(`${API_BASE}/api/apps`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.status === 401) {
        useAuthStore.getState().logout()
        throw new Error('/api/apps returned 401')
      }
      if (!res.ok) throw new Error(`/api/apps returned ${res.status}`)
      const data = (await res.json()) as unknown
      // Server returns { apps: [...] } or a raw array
      const apps: PluginManifest[] = Array.isArray(data)
        ? (data as PluginManifest[])
        : ((data as { apps?: PluginManifest[] }).apps ?? [])
      chatBridgeStore.getState().setRegistry(apps.length > 0 ? apps : HARDCODED_FALLBACK_APPS)
      console.log(`[ChatBridge] registry loaded: ${apps.length} app(s)`)
    } catch (err) {
      console.warn('[ChatBridge] /api/apps unavailable, using fallback registry', err)
      chatBridgeStore.getState().setRegistry(HARDCODED_FALLBACK_APPS)
    }
  },

  async activate(sessionId: string, app: PluginManifest): Promise<void> {
    const store = chatBridgeStore.getState()
    store.activateSession(sessionId)
    store.activateApp(sessionId, app.name)

    let wsClient = store.getWsClient()
    if (!wsClient) {
      const token = useAuthStore.getState().token ?? ''

      wsClient = new ChatBridgeWsClient(token)
      store.setWsClient(wsClient)
    }

    try {
      await wsClient.connect()
      console.log(`[ChatBridge] activated app "${app.name}" for session ${sessionId}`)
    } catch (err) {
      console.error('[ChatBridge] WS connect failed during activate — chat will still work but WS routing is unavailable', err)
    }
  },

  deactivate(sessionId: string, appName: string): void {
    chatBridgeStore.getState().deactivateApp(sessionId, appName)
    const session = chatBridgeStore.getState().sessions[sessionId]
    if (!session?.apps.length) {
      chatBridgeStore.getState().getWsClient()?.disconnect()
    }
  },
}
