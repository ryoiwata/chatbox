import { describe, it, expect, beforeEach } from 'vitest'
import { chatBridgeStore } from '../../../stores/chatBridgeStore'
import type { PluginManifest } from '../../../../shared/types/chatbridge'

/**
 * Scenario 3: Tool injection only includes active app's tools plus activate_app.
 *
 * This test verifies the filtering logic that stream-text.ts uses:
 * it reads chatBridgeStore.getState().registry for the full app list and
 * chatBridgeStore.getState().getActiveApp(sessionId) to filter which tools
 * to inject. We test that logic here without importing stream-text.ts
 * (which has heavy model/mcp dependencies).
 */

const SID = 'test-session'

const CHESS_APP: PluginManifest = {
  id: 'chess',
  name: 'Chess',
  url: '/apps/chess',
  description: 'Interactive chess game',
  tools: [
    { name: 'start_game', description: 'Start a new chess game', parameters: { type: 'object', properties: {} } },
    { name: 'make_move', description: 'Make a chess move', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
    { name: 'get_board_state', description: 'Get board position', parameters: { type: 'object', properties: {} } },
  ],
  status: 'approved',
  authRequired: false,
}

const WEATHER_APP: PluginManifest = {
  id: 'weather',
  name: 'Weather',
  url: '/apps/weather',
  description: 'Weather dashboard',
  tools: [
    { name: 'get_current_weather', description: 'Get weather', parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] } },
  ],
  status: 'approved',
  authRequired: false,
}

function resetStore() {
  chatBridgeStore.setState({
    registry: [CHESS_APP, WEATHER_APP],
    sessions: {},
    wsClient: null,
    pendingToolCalls: {},
    toolInvokers: {},
  })
}

/** Mirrors the filtering logic from stream-text.ts ~line 350 */
function getInjectedToolNames(sessionId: string): string[] {
  const registry = chatBridgeStore.getState().registry
  if (registry.length === 0) return []

  // activate_app is always injected
  const toolNames = ['activate_app']

  const activeAppName = chatBridgeStore.getState().getActiveApp(sessionId)
  const activeApps = activeAppName ? registry.filter((a) => a.name === activeAppName) : []

  for (const app of activeApps) {
    for (const appTool of app.tools) {
      toolNames.push(appTool.name)
    }
  }

  return toolNames
}

beforeEach(() => {
  resetStore()
})

describe('tool injection — multi-app switching', () => {
  it('injects only activate_app when no app is active', () => {
    chatBridgeStore.getState().activateSession(SID)
    // No app activated — just session

    const tools = getInjectedToolNames(SID)
    expect(tools).toEqual(['activate_app'])
  })

  it('injects Chess tools + activate_app when Chess is active', () => {
    chatBridgeStore.getState().activateSession(SID)
    chatBridgeStore.getState().activateApp(SID, 'Chess')

    const tools = getInjectedToolNames(SID)
    expect(tools).toContain('activate_app')
    expect(tools).toContain('start_game')
    expect(tools).toContain('make_move')
    expect(tools).toContain('get_board_state')
    expect(tools).not.toContain('get_current_weather')
  })

  it('switches injected tools when active app changes', () => {
    chatBridgeStore.getState().activateSession(SID)
    chatBridgeStore.getState().activateApp(SID, 'Chess')

    let tools = getInjectedToolNames(SID)
    expect(tools).toContain('start_game')
    expect(tools).not.toContain('get_current_weather')

    // Switch to Weather
    chatBridgeStore.getState().activateApp(SID, 'Weather')

    tools = getInjectedToolNames(SID)
    expect(tools).toContain('get_current_weather')
    expect(tools).not.toContain('start_game')
    expect(tools).not.toContain('make_move')
    expect(tools).toContain('activate_app')
  })

  it('returns only activate_app after active app is suspended', () => {
    chatBridgeStore.getState().activateSession(SID)
    chatBridgeStore.getState().activateApp(SID, 'Chess')
    chatBridgeStore.getState().suspendApp(SID, 'Chess')

    const tools = getInjectedToolNames(SID)
    expect(tools).toEqual(['activate_app'])
  })
})
