import WebSocket from 'ws'
import { z } from 'zod'
import { anthropic } from '../lib/anthropic'
import { prisma } from '../lib/prisma'

const UserMessageSchema = z.object({
  type: z.literal('user_message'),
  conversationId: z.string(),
  content: z.string(),
  appContext: z.unknown().optional(),
})

type IncomingMessage = z.infer<typeof UserMessageSchema>

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

async function loadHistory(conversationId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  })

  return messages
    .filter((m) => m.content !== null && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }))
}

async function ensureConversation(conversationId: string, userId: string): Promise<void> {
  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  })

  if (!existing) {
    await prisma.conversation.create({
      data: { id: conversationId, userId },
    })
  }
}

async function persistMessages(
  conversationId: string,
  userContent: string,
  assistantContent: string
): Promise<void> {
  await prisma.message.createMany({
    data: [
      { conversationId, role: 'user', content: userContent },
      { conversationId, role: 'assistant', content: assistantContent },
    ],
  })
}

async function handleUserMessage(ws: WebSocket, msg: IncomingMessage, userId: string): Promise<void> {
  const { conversationId, content } = msg

  await ensureConversation(conversationId, userId)

  const history = await loadHistory(conversationId)

  const systemPrompt = 'You are a helpful AI assistant on ChatBridge, an educational platform.'

  let fullResponseText = ''

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [...history, { role: 'user', content }],
    })

    stream.on('text', (text) => {
      fullResponseText += text
      send(ws, { type: 'token', data: text })
    })

    await stream.finalMessage()

    send(ws, { type: 'done' })

    await persistMessages(conversationId, content, fullResponseText)
  } catch (error) {
    console.error('Generation failed', { conversationId, userId, error })
    send(ws, { type: 'error', message: 'Generation failed. Please try again.' })
  }
}

export function handleWebSocketConnection(ws: WebSocket, userId: string): void {
  ws.on('error', (error) => {
    console.error('WebSocket error', { userId, error })
  })

  ws.on('message', (rawData) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawData.toString())
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    const result = UserMessageSchema.safeParse(parsed)
    if (!result.success) {
      send(ws, { type: 'error', message: 'Unknown message type' })
      return
    }

    // Fire-and-forget — errors handled inside handleUserMessage
    handleUserMessage(ws, result.data, userId).catch((error) => {
      console.error('Unhandled error in handleUserMessage', { userId, error })
      send(ws, { type: 'error', message: 'Generation failed. Please try again.' })
    })
  })

  ws.on('close', () => {
    console.log(`WebSocket closed for user ${userId}`)
  })
}
