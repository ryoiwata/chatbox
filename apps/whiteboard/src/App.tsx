import { useEffect, useRef, useState, useCallback } from 'react'
import Canvas, { type CanvasHandle } from './Canvas'
import Toolbar from './Toolbar'
import './App.css'

const TOOL_SCHEMAS = [
  {
    name: 'clear_canvas',
    description: 'Clears the drawing canvas',
    parameters: {
      type: 'object',
      properties: {
        backgroundColor: {
          type: 'string',
          description: 'Background color (defaults to white)',
        },
      },
    },
  },
  {
    name: 'get_drawing',
    description:
      'Captures the current canvas as a base64 PNG data URL. Claude receives the image data and can describe/analyze what is drawn.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_strokes',
    description:
      'Returns the raw stroke data (coordinate arrays). Lighter weight than get_drawing, useful for analyzing shapes mathematically.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_prompt',
    description:
      'Displays a drawing prompt/instruction to the student above the canvas, optionally with a countdown timer',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The drawing prompt to display' },
        timeLimit: {
          type: 'number',
          description: 'Optional countdown in seconds',
        },
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
        tool: {
          type: 'string',
          enum: ['pen', 'eraser'],
          description: 'Drawing tool type',
        },
      },
    },
  },
]

export default function App() {
  const canvasRef = useRef<CanvasHandle>(null)
  const [color, setColor] = useState('#000000')
  const [brushWidth, setBrushWidth] = useState(5)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [prompt, setPrompt] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerExpiredRef = useRef(false)

  const sendStateUpdate = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const size = c.getSize()
    window.parent.postMessage(
      {
        type: 'state_update',
        state: {
          strokeCount: c.getStrokeCount(),
          isEmpty: c.isEmpty(),
          canvasWidth: size.width,
          canvasHeight: size.height,
          hasPrompt: prompt !== null,
          currentPrompt: prompt,
        },
      },
      '*'
    )
  }, [prompt])

  // Send ready + register tools on mount
  useEffect(() => {
    window.parent.postMessage({ type: 'ready' }, '*')
    window.parent.postMessage({ type: 'register_tools', schemas: TOOL_SCHEMAS }, '*')
  }, [])

  // Timer countdown
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null
        const next = prev - 1
        if (next <= 0) {
          if (timerRef.current) clearInterval(timerRef.current)
          timerRef.current = null
          // Fire timer expired
          if (!timerExpiredRef.current) {
            timerExpiredRef.current = true
            window.parent.postMessage(
              {
                type: 'state_update',
                state: { timerExpired: true },
              },
              '*'
            )
            const c = canvasRef.current
            window.parent.postMessage(
              {
                type: 'completion',
                result: {
                  reason: 'timer_expired',
                  strokeCount: c?.getStrokeCount() ?? 0,
                  isEmpty: c?.isEmpty() ?? true,
                  prompt,
                },
              },
              '*'
            )
          }
          return 0
        }
        return next
      })
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [timeLeft, prompt])

  // Message handler
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data.type !== 'string') return
      if (event.data.type !== 'tool_invoke') return

      const { toolCallId, toolName, params } = event.data as {
        toolCallId: string
        toolName: string
        params: Record<string, unknown>
      }

      const c = canvasRef.current

      switch (toolName) {
        case 'clear_canvas': {
          const bg = (params.backgroundColor as string) || '#ffffff'
          c?.clearCanvas(bg)
          window.parent.postMessage(
            { type: 'tool_result', toolCallId, result: { status: 'cleared' } },
            '*'
          )
          sendStateUpdate()
          break
        }

        case 'get_drawing': {
          if (!c) {
            window.parent.postMessage(
              {
                type: 'tool_result',
                toolCallId,
                result: { error: 'Canvas not ready' },
              },
              '*'
            )
            return
          }
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: {
                imageDataUrl: c.getDataUrl(),
                strokeCount: c.getStrokeCount(),
                isEmpty: c.isEmpty(),
              },
            },
            '*'
          )
          break
        }

        case 'get_strokes': {
          if (!c) {
            window.parent.postMessage(
              {
                type: 'tool_result',
                toolCallId,
                result: { error: 'Canvas not ready' },
              },
              '*'
            )
            return
          }
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: {
                strokes: c.getStrokes(),
                strokeCount: c.getStrokeCount(),
              },
            },
            '*'
          )
          break
        }

        case 'set_prompt': {
          const promptText = params.prompt as string
          if (!promptText) {
            window.parent.postMessage(
              {
                type: 'tool_result',
                toolCallId,
                result: { error: 'prompt is required' },
              },
              '*'
            )
            return
          }
          const tl = params.timeLimit as number | undefined
          setPrompt(promptText)
          timerExpiredRef.current = false
          if (tl && tl > 0) {
            setTimeLeft(tl)
          } else {
            setTimeLeft(null)
          }
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: { status: 'prompt_displayed', prompt: promptText },
            },
            '*'
          )
          break
        }

        case 'undo_stroke': {
          const remaining = c?.undoStroke() ?? 0
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: { strokesRemaining: remaining },
            },
            '*'
          )
          sendStateUpdate()
          break
        }

        case 'set_tool': {
          const newColor = params.color as string | undefined
          const newWidth = params.width as number | undefined
          const newTool = params.tool as 'pen' | 'eraser' | undefined

          if (newColor) setColor(newColor)
          if (newWidth && newWidth > 0) setBrushWidth(newWidth)
          if (newTool) setTool(newTool)

          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: {
                color: newColor ?? color,
                width: newWidth ?? brushWidth,
                tool: newTool ?? tool,
              },
            },
            '*'
          )
          break
        }

        default:
          window.parent.postMessage(
            {
              type: 'tool_result',
              toolCallId,
              result: { error: `Unknown tool: ${toolName}` },
            },
            '*'
          )
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [color, brushWidth, tool, prompt, sendStateUpdate])

  const handleStrokeEnd = useCallback(() => {
    sendStateUpdate()
  }, [sendStateUpdate])

  const handleUndo = useCallback(() => {
    canvasRef.current?.undoStroke()
    sendStateUpdate()
  }, [sendStateUpdate])

  const handleClear = useCallback(() => {
    canvasRef.current?.clearCanvas('#ffffff')
    sendStateUpdate()
  }, [sendStateUpdate])

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="whiteboard-container">
      {prompt && (
        <div className="prompt-bar">
          <div className="prompt-text">{prompt}</div>
          {timeLeft !== null && timeLeft > 0 && (
            <div className={`timer-badge ${timeLeft <= 10 ? 'warning' : ''}`}>
              {formatTime(timeLeft)}
            </div>
          )}
          {timeLeft === 0 && (
            <div className="timer-badge">Time!</div>
          )}
        </div>
      )}

      <Toolbar
        color={color}
        brushWidth={brushWidth}
        tool={tool}
        onColorChange={setColor}
        onBrushWidthChange={setBrushWidth}
        onToolChange={setTool}
        onUndo={handleUndo}
        onClear={handleClear}
      />

      <div className="canvas-area">
        {canvasRef.current?.isEmpty() !== false && !prompt && (
          <div className="idle-overlay">
            <div className="title">Drawing Canvas</div>
            <div className="subtitle">
              Start drawing, or ask Claude for a drawing prompt!
            </div>
          </div>
        )}
        <Canvas
          ref={canvasRef}
          color={color}
          brushWidth={brushWidth}
          tool={tool}
          onStrokeEnd={handleStrokeEnd}
        />
      </div>
    </div>
  )
}
