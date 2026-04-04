import request from 'supertest'
import { app } from '../index'

describe('GET /api/apps', () => {
  it('returns an array of approved apps', async () => {
    const res = await request(app).get('/api/apps')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('includes chess, weather, and spotify apps', async () => {
    const res = await request(app).get('/api/apps')
    const names: string[] = res.body.map((a: { name: string }) => a.name.toLowerCase())

    expect(names).toContain('chess')
    expect(names).toContain('weather')
    expect(names).toContain('spotify')
  })

  it('each app has name, url, description, and tools array', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<Record<string, unknown>>) {
      expect(typeof app.name).toBe('string')
      expect(typeof app.url).toBe('string')
      expect(typeof app.description).toBe('string')
      expect(Array.isArray(app.tools)).toBe(true)
    }
  })

  it('each tool has name, description, and parameters', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<{ tools: Array<Record<string, unknown>> }>) {
      for (const tool of app.tools) {
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(typeof tool.parameters).toBe('object')
      }
    }
  })

  it('all returned apps have status approved', async () => {
    const res = await request(app).get('/api/apps')

    for (const app of res.body as Array<{ status: string }>) {
      expect(app.status).toBe('approved')
    }
  })
})
