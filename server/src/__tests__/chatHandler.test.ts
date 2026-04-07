import { buildSystemPrompt, getAnthropicTools } from '../ws/chatHandler'

describe('buildSystemPrompt — multi-app switching', () => {
  it('includes only the active app state, not suspended apps', () => {
    const appContext = {
      activeApps: ['Chess'],
      states: { Chess: { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', moveCount: 1 } },
      previousApps: ['Weather'],
    }

    const prompt = buildSystemPrompt(appContext)

    expect(prompt).toContain('Active application: Chess')
    expect(prompt).toContain('Chess current state:')
    expect(prompt).toContain('"moveCount":1')
    expect(prompt).not.toContain('Weather current state')
    expect(prompt).toContain('Previously used apps')
    expect(prompt).toContain('Weather')
  })

  it('returns base prompt when no app is active', () => {
    const appContext = {
      activeApps: [] as string[],
      states: {},
      previousApps: ['Chess', 'Weather'],
    }

    const prompt = buildSystemPrompt(appContext)

    expect(prompt).not.toContain('Active application')
    expect(prompt).toContain('Previously used apps')
    expect(prompt).toContain('Chess')
    expect(prompt).toContain('Weather')
  })

  it('omits previousApps section when no suspended apps exist', () => {
    const appContext = {
      activeApps: ['Chess'],
      states: { Chess: { fen: 'start' } },
      previousApps: [] as string[],
    }

    const prompt = buildSystemPrompt(appContext)

    expect(prompt).toContain('Active application: Chess')
    expect(prompt).not.toContain('Previously used')
  })
})

describe('getAnthropicTools — multi-app switching', () => {
  it('always includes activate_app when activeApps is provided', () => {
    const tools = getAnthropicTools(['Chess'])!
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('activate_app')

    const activateApp = tools.find((t) => t.name === 'activate_app')!
    expect(activateApp.description).toContain('switch')
    expect(activateApp.description).toContain('Chess')
    expect(activateApp.description).toContain('Weather')
    expect(activateApp.description).toContain('Spotify')
  })

  it('returns activate_app + active app tools when an app is active', () => {
    const tools = getAnthropicTools(['Chess'])!
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('activate_app')
    expect(toolNames).toContain('start_game')
    expect(toolNames).toContain('make_move')
    expect(toolNames).toContain('get_board_state')
    // Should NOT include other app tools
    expect(toolNames).not.toContain('get_current_weather')
    expect(toolNames).not.toContain('search_tracks')
  })

  it('returns only activate_app when activeApps is empty', () => {
    const tools = getAnthropicTools([])!
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('activate_app')
  })

  it('returns undefined when activeApps is undefined (non-ChatBridge message)', () => {
    expect(getAnthropicTools(undefined)).toBeUndefined()
  })

  it('returns Weather tools + activate_app when Weather is active', () => {
    const tools = getAnthropicTools(['Weather'])!
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('activate_app')
    expect(toolNames).toContain('get_current_weather')
    expect(toolNames).toContain('get_forecast')
    expect(toolNames).not.toContain('start_game')
  })

  it('switches tools when active app changes (simulates activate_app flow)', () => {
    // Before: Chess is active
    const chessTools = getAnthropicTools(['Chess'])!
    const chessToolNames = chessTools.map((t) => t.name)
    expect(chessToolNames).toContain('start_game')
    expect(chessToolNames).not.toContain('get_current_weather')

    // After activate_app: Weather is now active
    const weatherTools = getAnthropicTools(['Weather'])!
    const weatherToolNames = weatherTools.map((t) => t.name)
    expect(weatherToolNames).toContain('get_current_weather')
    expect(weatherToolNames).not.toContain('start_game')
    // activate_app still available for switching again
    expect(weatherToolNames).toContain('activate_app')
  })

  it('rebuilds system prompt after activate_app', () => {
    // Simulates what streamWithToolLoop does after activate_app returns
    const beforePrompt = buildSystemPrompt({
      activeApps: ['Chess'],
      states: { Chess: { fen: 'some-fen' } },
    })
    expect(beforePrompt).toContain('Active application: Chess')

    // After activate_app('Weather') succeeds, rebuild prompt
    const afterPrompt = buildSystemPrompt({
      activeApps: ['Weather'],
      states: {},
    })
    expect(afterPrompt).toContain('Active application: Weather')
    expect(afterPrompt).not.toContain('Chess')
  })
})
