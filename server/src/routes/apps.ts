import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

const ToolSchemaSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
})

const RegisterAppSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().min(1),
  tools: z.array(ToolSchemaSchema).min(1),
})

const UpdateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
})

// GET /api/apps — returns approved app registrations (no auth required)
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
    {
      id: 'weather',
      name: 'Weather',
      url: '/apps/weather',
      description:
        'Weather dashboard. Ask about current conditions or forecasts for any city. Weather data is fetched server-side — no API key exposed to the browser.',
      tools: [
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
    {
      id: 'spotify',
      name: 'Spotify',
      url: '/apps/spotify',
      description:
        'Spotify playlist creator. Search for tracks and create playlists using natural language. Requires Spotify OAuth.',
      tools: [
        {
          name: 'search_tracks',
          description: 'Search for music tracks on Spotify',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query, e.g. "jazz piano"' },
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
                description: 'Search queries for tracks to add',
              },
            },
            required: ['name', 'trackQueries'],
          },
        },
      ],
      status: 'approved',
      authRequired: true,
      authProvider: 'spotify',
    },
  ])
})

// POST /api/apps/register — register a new app (requires auth)
router.post('/register', requireAuth, async (req: AuthRequest, res) => {
  const parsed = RegisterAppSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid app schema' })
    return
  }

  const { name, url, description, tools } = parsed.data

  const app = await prisma.appRegistration.create({
    data: {
      name,
      url,
      description,
      toolSchemas: tools as unknown as Prisma.InputJsonValue,
      status: 'pending',
    },
    select: { id: true, status: true },
  })

  res.status(201).json(app)
})

// PATCH /api/apps/:id/status — change app status (requires auth)
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const parsed = UpdateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'status must be pending, approved, or rejected' })
    return
  }

  const { id } = req.params

  const existing = await prisma.appRegistration.findUnique({ where: { id } })
  if (!existing) {
    res.status(404).json({ error: 'App not found' })
    return
  }

  const updated = await prisma.appRegistration.update({
    where: { id },
    data: { status: parsed.data.status },
    select: { id: true, status: true },
  })

  res.json(updated)
})

export default router
