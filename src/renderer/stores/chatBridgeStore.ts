import { create } from 'zustand'
import type { PluginManifest } from '../../shared/types/chatbridge'
import type { ChatBridgeWsClient } from '../packages/chatbridge/ws-client'

type SessionState = {
  active: boolean
  apps: string[] // active app names
  appStates: Record<string, unknown> // latest state_update per app name
  failureCounts: Record<string, number> // circuit breaker counts per app name
}

// Placeholder frame interface — replaced in M2 when ChatBridgeFrame.tsx exists
type FrameHandle = {
  invokeToolAndWait: (toolCallId: string, toolName: string, params: unknown) => Promise<unknown>
}

type ChatBridgeState = {
  registry: PluginManifest[]
  sessions: Record<string, SessionState>
  wsClient: ChatBridgeWsClient | null

  setRegistry: (apps: PluginManifest[]) => void
  activateSession: (sessionId: string) => void
  activateApp: (sessionId: string, appName: string) => void
  deactivateApp: (sessionId: string, appName: string) => void
  updateAppState: (sessionId: string, appName: string, state: unknown) => void
  isActive: (sessionId: string) => boolean
  getAppContext: (sessionId: string) => Record<string, unknown>
  getWsClient: () => ChatBridgeWsClient | null
  setWsClient: (client: ChatBridgeWsClient) => void
  recordFailure: (sessionId: string, appName: string) => number
  getActiveFrame: (sessionId: string) => FrameHandle
}

const makeEmptySession = (): SessionState => ({
  active: false,
  apps: [],
  appStates: {},
  failureCounts: {},
})

export const chatBridgeStore = create<ChatBridgeState>()((set, get) => ({
  registry: [],
  sessions: {},
  wsClient: null,

  setRegistry: (apps) => set({ registry: apps }),

  activateSession: (sessionId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? makeEmptySession()),
          active: true,
        },
      },
    }))
  },

  activateApp: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId] ?? makeEmptySession()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            active: true,
            apps: existing.apps.includes(appName) ? existing.apps : [...existing.apps, appName],
          },
        },
      }
    })
  },

  deactivateApp: (sessionId, appName) => {
    set((state) => {
      const existing = state.sessions[sessionId]
      if (!existing) return state
      const apps = existing.apps.filter((a) => a !== appName)
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            apps,
            active: apps.length > 0,
          },
        },
      }
    })
  },

  updateAppState: (sessionId, appName, appState) => {
    set((state) => {
      const existing = state.sessions[sessionId] ?? makeEmptySession()
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            appStates: { ...existing.appStates, [appName]: appState },
          },
        },
      }
    })
  },

  isActive: (sessionId) => {
    return get().sessions[sessionId]?.active === true
  },

  getAppContext: (sessionId) => {
    const session = get().sessions[sessionId]
    if (!session) return {}
    return {
      activeApps: session.apps,
      appStates: session.appStates,
    }
  },

  getWsClient: () => get().wsClient,

  setWsClient: (client) => set({ wsClient: client }),

  recordFailure: (sessionId, appName) => {
    const existing = get().sessions[sessionId] ?? makeEmptySession()
    const newCount = (existing.failureCounts[appName] ?? 0) + 1
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? makeEmptySession()),
          failureCounts: {
            ...(state.sessions[sessionId]?.failureCounts ?? {}),
            [appName]: newCount,
          },
        },
      },
    }))
    return newCount
  },

  getActiveFrame: (_sessionId) => {
    // M2 placeholder — ChatBridgeFrame.tsx will register itself here
    return {
      invokeToolAndWait: async (toolCallId, toolName, _params) => {
        console.warn('[ChatBridge] Tool call received but no iframe frame handler yet — M2 needed', {
          toolCallId,
          toolName,
        })
        return { error: 'iframe not ready' }
      },
    }
  },
}))
