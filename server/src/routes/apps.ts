import { Router } from 'express'

const router = Router()

// GET /api/apps — returns approved app registrations
// M0-M4: hardcoded until AppRegistration table is seeded (M5+)
router.get('/', (_req, res) => {
  res.json([
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
    },
  ])
})

export default router
