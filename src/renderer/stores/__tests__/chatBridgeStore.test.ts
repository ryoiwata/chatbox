import { describe, it, expect, beforeEach } from 'vitest'
import { chatBridgeStore } from '../chatBridgeStore'

const SID = 'test-session-1'

function resetStore() {
  chatBridgeStore.setState({
    registry: [],
    sessions: {},
    wsClient: null,
    pendingToolCalls: {},
    toolInvokers: {},
  })
}

beforeEach(() => {
  resetStore()
})

describe('chatBridgeStore — multi-app switching', () => {
  // Scenario 1: Activate chess, then activate weather
  describe('activate chess then weather', () => {
    it('suspends chess and activates weather', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')

      // Chess should be active
      expect(chatBridgeStore.getState().sessions[SID].activeApp).toBe('Chess')
      expect(chatBridgeStore.getState().sessions[SID].apps['Chess'].status).toBe('active')

      // Update chess state to verify preservation
      store.updateAppState(SID, 'Chess', { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', moveCount: 1 })

      // Now activate weather
      chatBridgeStore.getState().activateApp(SID, 'Weather')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.activeApp).toBe('Weather')
      expect(session.apps['Weather'].status).toBe('active')
      expect(session.apps['Chess'].status).toBe('suspended')
      // Chess context preserved
      expect(session.apps['Chess'].context).toEqual({
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
        moveCount: 1,
      })
    })

    it('getAppContext returns only the active app state', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      store.updateAppState(SID, 'Chess', { fen: 'initial' })
      chatBridgeStore.getState().activateApp(SID, 'Weather')
      chatBridgeStore.getState().updateAppState(SID, 'Weather', { temp: 72 })

      const ctx = chatBridgeStore.getState().getAppContext(SID)
      expect(ctx.activeApps).toEqual(['Weather'])
      expect(ctx.states).toEqual({ Weather: { temp: 72 } })
      expect(ctx.previousApps).toEqual(['Chess'])
    })
  })

  // Scenario 2: Activate chess → weather → chess (round-trip restore)
  describe('activate chess → weather → back to chess', () => {
    it('restores chess to active with original context intact', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      store.updateAppState(SID, 'Chess', { fen: 'some-fen', moveCount: 5 })

      // Switch to weather
      chatBridgeStore.getState().activateApp(SID, 'Weather')
      chatBridgeStore.getState().updateAppState(SID, 'Weather', { temp: 65 })

      // Switch back to chess
      chatBridgeStore.getState().activateApp(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.activeApp).toBe('Chess')
      expect(session.apps['Chess'].status).toBe('active')
      expect(session.apps['Chess'].context).toEqual({ fen: 'some-fen', moveCount: 5 })
      expect(session.apps['Weather'].status).toBe('suspended')
      expect(session.apps['Weather'].context).toEqual({ temp: 65 })
    })

    it('activating the already-active app is a no-op', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')

      const before = chatBridgeStore.getState().sessions[SID]
      chatBridgeStore.getState().activateApp(SID, 'Chess')
      const after = chatBridgeStore.getState().sessions[SID]

      // Reference equality — the setter returned the same state
      expect(after).toBe(before)
    })
  })

  // Scenario 5: Circuit breaker on one app doesn't disable others
  describe('circuit breaker isolation', () => {
    it('deactivates only the failed app after 3 failures', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      chatBridgeStore.getState().activateApp(SID, 'Weather')
      // Weather is now active, Chess is suspended

      // Trigger 3 failures on Chess
      chatBridgeStore.getState().recordFailure(SID, 'Chess')
      chatBridgeStore.getState().recordFailure(SID, 'Chess')
      chatBridgeStore.getState().recordFailure(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      // Chess should be removed from the apps map
      expect(session.apps['Chess']).toBeUndefined()
      // Weather should be unaffected
      expect(session.apps['Weather']).toBeDefined()
      expect(session.apps['Weather'].status).toBe('active')
      expect(session.activeApp).toBe('Weather')
      // Failure counts for Weather should be 0
      expect(session.failureCounts['Weather'] ?? 0).toBe(0)
    })

    it('clears activeApp when the active app hits circuit breaker', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')

      chatBridgeStore.getState().recordFailure(SID, 'Chess')
      chatBridgeStore.getState().recordFailure(SID, 'Chess')
      chatBridgeStore.getState().recordFailure(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.apps['Chess']).toBeUndefined()
      expect(session.activeApp).toBeNull()
      // Session becomes inactive when no apps remain
      expect(session.active).toBe(false)
    })
  })

  // Additional: suspendApp
  describe('suspendApp', () => {
    it('suspends the active app and clears activeApp', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      store.updateAppState(SID, 'Chess', { fen: 'abc' })

      chatBridgeStore.getState().suspendApp(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.activeApp).toBeNull()
      expect(session.apps['Chess'].status).toBe('suspended')
      expect(session.apps['Chess'].context).toEqual({ fen: 'abc' })
    })
  })

  // Additional: getAppContext with no active app
  describe('getAppContext with no active app', () => {
    it('returns previousApps when all apps are suspended', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      chatBridgeStore.getState().suspendApp(SID, 'Chess')

      const ctx = chatBridgeStore.getState().getAppContext(SID)
      expect(ctx.activeApps).toEqual([])
      expect(ctx.previousApps).toEqual(['Chess'])
    })
  })

  // Additional: deactivateApp
  describe('deactivateApp', () => {
    it('removes the app entirely from the session', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')
      chatBridgeStore.getState().activateApp(SID, 'Weather')

      chatBridgeStore.getState().deactivateApp(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.apps['Chess']).toBeUndefined()
      expect(session.apps['Weather']).toBeDefined()
      expect(session.active).toBe(true)
    })

    it('sets active to false when the last app is deactivated', () => {
      const store = chatBridgeStore.getState()
      store.activateSession(SID)
      store.activateApp(SID, 'Chess')

      chatBridgeStore.getState().deactivateApp(SID, 'Chess')

      const session = chatBridgeStore.getState().sessions[SID]
      expect(session.active).toBe(false)
      expect(session.activeApp).toBeNull()
    })
  })
})
