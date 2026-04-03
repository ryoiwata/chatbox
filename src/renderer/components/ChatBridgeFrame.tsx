import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { createMessageHandler } from '../packages/chatbridge/message-handler'
import { chatBridgeStore } from '../stores/chatBridgeStore'

const READY_TIMEOUT_MS = 5_000
const TOOL_TIMEOUT_MS = 10_000

/** Resolve a possibly-relative app URL to an absolute one.
 *  In dev the Express server runs on port 3000 while Vite/Electron runs elsewhere.
 *  VITE_CHATBRIDGE_SERVER_URL can be set to override (e.g. http://localhost:3000).
 *  In production everything is served from the same origin, so relative URLs work. */
function resolveAppUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  const base =
    (import.meta.env as Record<string, string>).VITE_CHATBRIDGE_SERVER_URL || 'http://localhost:3000'
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

type Props = {
  sessionId: string
}

type FrameStatus = 'loading' | 'ready' | 'error'

export function ChatBridgeFrame({ sessionId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [status, setStatus] = useState<FrameStatus>('loading')
  const [retryKey, setRetryKey] = useState(0)

  // Subscribe to the first active app name and its URL from the registry
  const activeApps = useStore(chatBridgeStore, (s) => s.sessions[sessionId]?.apps ?? [])
  const registry = useStore(chatBridgeStore, (s) => s.registry)

  const activeAppName = activeApps[0] ?? null
  const activeApp = registry.find((a) => a.name === activeAppName) ?? null
  const appUrl = activeApp ? resolveAppUrl(activeApp.url) : null

  // invokeToolAndWait: posts tool_invoke to iframe, returns a promise that resolves on tool_result
  const invokeToolAndWait = useCallback(
    (toolCallId: string, toolName: string, params: unknown): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chatBridgeStore.getState().removePendingToolCall(toolCallId)
          reject(new Error(`Tool call timed out: ${toolName} (${toolCallId})`))
        }, TOOL_TIMEOUT_MS)

        chatBridgeStore.getState().addPendingToolCall(toolCallId, { resolve, reject, timeout })

        iframeRef.current?.contentWindow?.postMessage(
          { type: 'tool_invoke', toolCallId, toolName, params },
          '*' // sandboxed iframe has opaque null origin — must use '*' to reach it
        )
      })
    },
    []
  )

  // Register invokeToolAndWait with the store so generation.ts can call it
  useEffect(() => {
    chatBridgeStore.getState().setToolInvoker(sessionId, invokeToolAndWait)
    return () => {
      chatBridgeStore.getState().setToolInvoker(sessionId, null)
    }
  }, [sessionId, invokeToolAndWait])

  // Set up postMessage listener and ready timeout
  useEffect(() => {
    if (!activeAppName) return

    setStatus('loading')

    let readyResolved = false
    const onReady = () => {
      readyResolved = true
      clearTimeout(readyTimer)
      setStatus('ready')
    }

    const handler = createMessageHandler(iframeRef, sessionId, activeAppName, onReady)
    window.addEventListener('message', handler)

    const readyTimer = setTimeout(() => {
      if (!readyResolved) {
        console.warn(`[ChatBridge] ${activeAppName} did not send ready within ${READY_TIMEOUT_MS}ms`)
        setStatus('error')
      }
    }, READY_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(readyTimer)
    }
  }, [sessionId, activeAppName, retryKey])

  if (!activeAppName || !appUrl) return null

  return (
    <div className="flex flex-col w-[420px] min-w-[320px] border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200">
        <span>{activeAppName}</span>
        {status === 'loading' && (
          <span className="text-xs text-gray-400 animate-pulse">Loading…</span>
        )}
        {status === 'error' && (
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs text-blue-500 hover:underline"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
            <button
              type="button"
              className="text-xs text-gray-400 hover:underline"
              onClick={() => chatBridgeStore.getState().deactivateApp(sessionId, activeAppName)}
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 relative">
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 p-4">
            <span>⚠ App failed to load</span>
            <button
              type="button"
              className="px-3 py-1 rounded bg-blue-500 text-white text-xs hover:bg-blue-600"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <iframe
          key={`${appUrl}-${retryKey}`}
          ref={iframeRef}
          src={appUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          title={activeAppName}
          className="w-full h-full border-none"
          style={{ opacity: status === 'loading' ? 0.4 : 1, transition: 'opacity 0.2s' }}
        />
      </div>
    </div>
  )
}
