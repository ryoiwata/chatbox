import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { searchTracks, createPlaylist, addTracksToPlaylist } from '../services/spotify'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

const SearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
})

const CreatePlaylistSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trackQueries: z.array(z.string().min(1)).min(1),
})

// GET /api/internal/spotify/status
router.get('/status', async (req: AuthRequest, res) => {
  const userId = req.user!.userId

  const configured = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
  if (!configured) {
    res.json({ connected: false, configured: false })
    return
  }

  const stored = await prisma.oAuthToken.findUnique({
    where: { userId_provider: { userId, provider: 'spotify' } },
    select: { expiresAt: true },
  })

  const connected = Boolean(
    stored && (!stored.expiresAt || stored.expiresAt.getTime() > Date.now())
  )

  res.json({ connected, configured: true })
})

// POST /api/internal/spotify/search
router.post('/search', async (req: AuthRequest, res) => {
  const parsed = SearchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' })
    return
  }

  const userId = req.user!.userId
  const { query, limit } = parsed.data

  try {
    const tracks = await searchTracks(userId, query, limit)
    res.json({ tracks })
  } catch (err) {
    if (err instanceof Error && err.message === 'auth_required') {
      res.status(401).json({ error: 'auth_required', provider: 'spotify' })
      return
    }
    console.error('[Spotify] Search error', err)
    res.status(500).json({ error: 'Failed to search tracks' })
  }
})

// POST /api/internal/spotify/create-playlist
router.post('/create-playlist', async (req: AuthRequest, res) => {
  const parsed = CreatePlaylistSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' })
    return
  }

  const userId = req.user!.userId
  const { name, description, trackQueries } = parsed.data

  try {
    const playlist = await createPlaylist(userId, name, description ?? '')

    // Search each query (best match, 1 result) — failures silently skipped
    const trackResults = await Promise.all(
      trackQueries.map((q) => searchTracks(userId, q, 1).catch(() => []))
    )

    const foundTracks = trackResults.map((r) => r[0]).filter((t): t is NonNullable<typeof t> => Boolean(t))
    const trackUris = foundTracks.map((t) => t.uri)

    if (trackUris.length > 0) {
      await addTracksToPlaylist(userId, playlist.id, trackUris)
    }

    res.json({
      playlist: { id: playlist.id, url: playlist.url, name },
      tracksAdded: trackUris.length,
      tracks: foundTracks,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'auth_required') {
      res.status(401).json({ error: 'auth_required', provider: 'spotify' })
      return
    }
    console.error('[Spotify] Create playlist error', err)
    res.status(500).json({ error: 'Failed to create playlist' })
  }
})

export default router
