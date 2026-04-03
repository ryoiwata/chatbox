import 'dotenv/config'
import express from 'express'
import { createServer, type IncomingMessage } from 'http'
import path from 'path'
import { WebSocketServer, type WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { prisma } from './lib/prisma'
import { handleWebSocketConnection } from './ws/chatHandler'

// Fail fast on missing required env vars
const requiredEnvVars = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'JWT_SECRET'] as const
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`)
    process.exit(1)
  }
}

const JWT_SECRET = process.env.JWT_SECRET as string
const PORT = Number(process.env.PORT) || 3000

interface JwtPayload {
  userId: string
  iat?: number
  exp?: number
}

const app = express()

app.use(express.json())

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Static: demo apps and built frontend (populated in later milestones)
app.use('/apps', express.static(path.join(__dirname, '../../apps')))
app.use(express.static(path.join(__dirname, '../../dist')))

const server = createServer(app)

// WebSocket server in noServer mode — auth happens in upgrade handler
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws: WebSocket, _request: IncomingMessage, userId: string) => {
  console.log(`WebSocket connected: user=${userId}`)
  handleWebSocketConnection(ws, userId)
})

server.on('upgrade', (request, socket, head) => {
  socket.on('error', (err) => {
    console.error('Socket error during upgrade', err)
  })

  // Extract token from query string: ws://host/ws?token=JWT
  const url = new URL(request.url ?? '', `http://${request.headers.host}`)
  const token = url.searchParams.get('token')

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch (err) {
    console.warn('WebSocket auth failed — invalid token', err instanceof Error ? err.message : err)
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.destroy()
    return
  }

  socket.removeAllListeners('error')

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, payload.userId)
  })
})

// Verify DB connectivity and start listening
async function start(): Promise<void> {
  try {
    await prisma.$connect()
    console.log('Database connected')
  } catch (error) {
    console.error('Database connection failed', error)
    process.exit(1)
  }

  server.listen(PORT, () => {
    console.log(`ChatBridge server listening on port ${PORT}`)
    console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`)
    console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? 'set' : 'MISSING'}`)
  })
}

start()
