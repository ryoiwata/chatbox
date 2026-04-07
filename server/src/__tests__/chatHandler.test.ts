import { buildSystemPrompt, getAnthropicTools } from '../ws/chatHandler'
import { prisma } from '../lib/prisma'

jest.mock('../lib/prisma', () => ({
  prisma: {
    appRegistration: {
      findMany: jest.fn(),
    },
  },
}))

const mockFindMany = prisma.appRegistration.findMany as jest.Mock

const MOCK_APPS = [
  {
    name: 'Test App',
    toolSchemas: [
      { name: 'dummy_action', description: 'A test tool', parameters: { type: 'object', properties: { message: { type: 'string' } } } },
    ],
  },
  {
    name: 'Chess',
    toolSchemas: [
      { name: 'start_game', description: 'Start a new chess game', parameters: { type: 'object', properties: { color: { type: 'string', enum: ['white', 'black'] } } } },
      { name: 'make_move', description: 'Make a chess move', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
      { name: 'get_board_state', description: 'Get the current board position', parameters: { type: 'object', properties: {} } },
    ],
  },
  {
    name: 'Weather',
    toolSchemas: [
      { name: 'get_current_weather', description: 'Get current weather', parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] } },
      { name: 'get_forecast', description: 'Get forecast', parameters: { type: 'object', properties: { location: { type: 'string' }, days: { type: 'number' } }, required: ['location'] } },
    ],
  },
  {
    name: 'Spotify',
    toolSchemas: [
      { name: 'search_tracks', description: 'Search tracks', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'create_playlist', description: 'Create playlist', parameters: { type: 'object', properties: { name: { type: 'string' }, trackQueries: { type: 'array', items: { type: 'string' } } }, required: ['name', 'trackQueries'] } },
    ],
  },
  {
    name: 'Flashcards',
    toolSchemas: [
      { name: 'create_deck', description: 'Creates a flashcard deck', parameters: { type: 'object', properties: { topic: { type: 'string' }, cards: { type: 'array' } }, required: ['topic', 'cards'] } },
      { name: 'show_card', description: 'Shows a card', parameters: { type: 'object', properties: { cardIndex: { type: 'number' }, side: { type: 'string' } }, required: ['cardIndex', 'side'] } },
    ],
  },
]

beforeEach(() => {
  mockFindMany.mockResolvedValue(MOCK_APPS)
})

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
  it('always includes activate_app when activeApps is provided', async () => {
    const tools = (await getAnthropicTools(['Chess']))!
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('activate_app')

    const activateApp = tools.find((t) => t.name === 'activate_app')!
    expect(activateApp.description).toContain('switch')
    expect(activateApp.description).toContain('Chess')
    expect(activateApp.description).toContain('Weather')
    expect(activateApp.description).toContain('Spotify')
  })

  it('returns activate_app + ALL approved app tools regardless of active app', async () => {
    const tools = (await getAnthropicTools(['Chess']))!
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('activate_app')
    // Chess tools present
    expect(toolNames).toContain('start_game')
    expect(toolNames).toContain('make_move')
    expect(toolNames).toContain('get_board_state')
    // All other app tools also present so the LLM can call activate_app + app tool in same turn
    expect(toolNames).toContain('get_current_weather')
    expect(toolNames).toContain('search_tracks')
    expect(toolNames).toContain('create_deck')
  })

  it('returns activate_app + all app tools when activeApps is empty', async () => {
    const tools = (await getAnthropicTools([]))!
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('activate_app')
    // All app tools still present so the LLM can activate and use in same turn
    expect(toolNames).toContain('start_game')
    expect(toolNames).toContain('create_deck')
    expect(toolNames).toContain('get_current_weather')
  })

  it('returns undefined when activeApps is undefined (non-ChatBridge message)', async () => {
    expect(await getAnthropicTools(undefined)).toBeUndefined()
  })

  it('returns all tools including Weather when Weather is active', async () => {
    const tools = (await getAnthropicTools(['Weather']))!
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('activate_app')
    expect(toolNames).toContain('get_current_weather')
    expect(toolNames).toContain('get_forecast')
    // All app tools present
    expect(toolNames).toContain('start_game')
  })

  it('returns all tools including Flashcards when Flashcards is active', async () => {
    const tools = (await getAnthropicTools(['Flashcards']))!
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('activate_app')
    expect(toolNames).toContain('create_deck')
    expect(toolNames).toContain('show_card')
    // All app tools present
    expect(toolNames).toContain('start_game')
  })

  it('always returns all tools regardless of which app is active', async () => {
    // Both calls return the same full tool set
    const chessTools = (await getAnthropicTools(['Chess']))!
    const chessToolNames = chessTools.map((t) => t.name)
    expect(chessToolNames).toContain('start_game')
    expect(chessToolNames).toContain('get_current_weather')

    const weatherTools = (await getAnthropicTools(['Weather']))!
    const weatherToolNames = weatherTools.map((t) => t.name)
    expect(weatherToolNames).toContain('get_current_weather')
    expect(weatherToolNames).toContain('start_game')
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
