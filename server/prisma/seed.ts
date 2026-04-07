import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  // --- Demo user ---
  const email = 'demo@chatbridge.app'
  const password = 'demo123'

  const existingUser = await prisma.user.findUnique({ where: { email } })

  let userId: string

  if (existingUser) {
    console.log(`Demo user already exists: ${email}`)
    userId = existingUser.id
  } else {
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash },
    })
    userId = user.id
    console.log(`Created demo user: ${email} (id: ${userId})`)
  }

  // --- App registrations ---
  const testApp = await prisma.appRegistration.upsert({
    where: { id: 'test-app' },
    update: { status: 'approved' },
    create: {
      id: 'test-app',
      name: 'Test App',
      url: '/apps/test-app',
      description: 'Protocol compliance test fixture',
      toolSchemas: [
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
    },
  })
  console.log(`App registration: ${testApp.name} (${testApp.status})`)

  const chessApp = await prisma.appRegistration.upsert({
    where: { id: 'chess' },
    update: { status: 'approved' },
    create: {
      id: 'chess',
      name: 'Chess',
      url: '/apps/chess',
      description:
        'Interactive chess game with AI analysis. Play chess against yourself or get move suggestions from Claude.',
      toolSchemas: [
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
    },
  })
  console.log(`App registration: ${chessApp.name} (${chessApp.status})`)

  const weatherApp = await prisma.appRegistration.upsert({
    where: { id: 'weather' },
    update: { status: 'approved' },
    create: {
      id: 'weather',
      name: 'Weather',
      url: '/apps/weather',
      description:
        'Weather dashboard. Ask about current conditions or forecasts for any city.',
      toolSchemas: [
        {
          name: 'get_current_weather',
          description: 'Get the current weather conditions for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name, e.g. "Tokyo"' },
            },
            required: ['location'],
          },
        },
        {
          name: 'get_forecast',
          description: 'Get a multi-day weather forecast for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string', description: 'City name' },
              days: { type: 'number', description: 'Number of forecast days (default 4)' },
            },
            required: ['location'],
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${weatherApp.name} (${weatherApp.status})`)

  const spotifyApp = await prisma.appRegistration.upsert({
    where: { id: 'spotify' },
    update: { status: 'approved', authRequired: true, authProvider: 'spotify' },
    create: {
      id: 'spotify',
      name: 'Spotify',
      authRequired: true,
      authProvider: 'spotify',
      url: '/apps/spotify',
      description: 'Spotify playlist creator. Search for tracks and create playlists using natural language.',
      toolSchemas: [
        {
          name: 'search_tracks',
          description: 'Search for music tracks on Spotify',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', description: 'Max results (default 5)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'create_playlist',
          description: 'Create a Spotify playlist and add tracks to it',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Playlist name' },
              description: { type: 'string', description: 'Optional description' },
              trackQueries: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of search queries, one per track (e.g. ["Take Five Dave Brubeck", "Fly Me To The Moon Frank Sinatra"]). Must be an array, not a comma-separated string.',
              },
            },
            required: ['name', 'trackQueries'],
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${spotifyApp.name} (${spotifyApp.status})`)

  const flashcardsApp = await prisma.appRegistration.upsert({
    where: { id: 'flashcards' },
    update: { status: 'approved' },
    create: {
      id: 'flashcards',
      name: 'Flashcards',
      url: '/apps/flashcards',
      description:
        'Interactive flashcard quiz. Claude creates decks on any topic, quizzes the student, and tracks their score.',
      toolSchemas: [
        {
          name: 'create_deck',
          description: 'Creates a new flashcard deck with a topic and array of cards',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'The topic of the flashcard deck' },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    front: { type: 'string', description: 'The question or prompt' },
                    back: { type: 'string', description: 'The answer' },
                  },
                  required: ['front', 'back'],
                },
                description: 'Array of flashcard objects with front and back text',
              },
            },
            required: ['topic', 'cards'],
          },
        },
        {
          name: 'show_card',
          description: 'Shows a specific card to the student by index',
          parameters: {
            type: 'object',
            properties: {
              cardIndex: { type: 'number', description: 'Zero-based index of the card to show' },
              side: { type: 'string', enum: ['front', 'both'], description: 'Show front only or both sides' },
            },
            required: ['cardIndex', 'side'],
          },
        },
        {
          name: 'check_answer',
          description: "Checks the student's answer against the card back with fuzzy matching",
          parameters: {
            type: 'object',
            properties: {
              cardIndex: { type: 'number', description: 'Zero-based index of the card' },
              studentAnswer: { type: 'string', description: "The student's answer" },
            },
            required: ['cardIndex', 'studentAnswer'],
          },
        },
        {
          name: 'get_score',
          description: 'Returns the current quiz score and per-card results',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'reset_deck',
          description: 'Clears the current deck and score',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${flashcardsApp.name} (${flashcardsApp.status})`)

  const whiteboardApp = await prisma.appRegistration.upsert({
    where: { id: 'whiteboard' },
    update: { status: 'approved' },
    create: {
      id: 'whiteboard',
      name: 'Whiteboard',
      url: '/apps/whiteboard',
      description:
        'Drawing canvas for students. Claude can set drawing prompts, capture drawings as images, and analyze stroke data.',
      toolSchemas: [
        {
          name: 'clear_canvas',
          description: 'Clears the drawing canvas',
          parameters: {
            type: 'object',
            properties: {
              backgroundColor: { type: 'string', description: 'Background color (defaults to white)' },
            },
          },
        },
        {
          name: 'get_drawing',
          description: 'Captures the current canvas as a base64 PNG data URL',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_strokes',
          description: 'Returns the raw stroke data (coordinate arrays)',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'set_prompt',
          description: 'Displays a drawing prompt/instruction to the student above the canvas',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'The drawing prompt to display' },
              timeLimit: { type: 'number', description: 'Optional countdown in seconds' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'undo_stroke',
          description: 'Removes the last stroke from the canvas',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'set_tool',
          description: 'Changes the drawing tool settings (color, width, or tool type)',
          parameters: {
            type: 'object',
            properties: {
              color: { type: 'string', description: 'Stroke color (CSS color)' },
              width: { type: 'number', description: 'Stroke width in pixels' },
              tool: { type: 'string', enum: ['pen', 'eraser'], description: 'Drawing tool type' },
            },
          },
        },
      ],
      status: 'approved',
    },
  })
  console.log(`App registration: ${whiteboardApp.name} (${whiteboardApp.status})`)

  // --- Print dev JWT ---
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    console.error('JWT_SECRET not set — cannot generate test token')
    process.exit(1)
  }

  const token = jwt.sign({ userId }, jwtSecret, { expiresIn: '24h' })

  console.log('\n--- TEST JWT (valid 24h) ---')
  console.log(token)
  console.log('\nTest with wscat:')
  console.log(`  wscat -c 'ws://localhost:3000/ws?token=${token}'`)
  console.log('\nThen send:')
  console.log('  {"type":"user_message","conversationId":"test-123","content":"Hello, who are you?"}')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
