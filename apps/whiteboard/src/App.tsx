import { useEffect, useRef, useState, useCallback } from 'react'
import Canvas, { type CanvasHandle, type Stroke } from './Canvas'
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
  {
    name: 'draw_strokes',
    description:
      'Draw strokes on the canvas programmatically. Lets Claude illustrate concepts or play drawing games. Strokes are animated so the student sees them drawn.',
    parameters: {
      type: 'object',
      properties: {
        strokes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    x: { type: 'number', description: 'X coordinate (0-800)' },
                    y: { type: 'number', description: 'Y coordinate (0-600)' },
                  },
                  required: ['x', 'y'],
                },
              },
              color: {
                type: 'string',
                description: "CSS color string, e.g. '#FF0000' or 'red'",
              },
              width: {
                type: 'number',
                description: 'Stroke width in pixels, e.g. 3',
              },
            },
            required: ['points'],
          },
          description:
            'Array of strokes to draw. Each stroke is a series of connected points.',
        },
        clearFirst: {
          type: 'boolean',
          description: 'If true, clear the canvas before drawing. Default false.',
        },
      },
      required: ['strokes'],
    },
  },
  {
    name: 'draw_shape',
    description:
      'Draw a common shape on the canvas. Higher-level than draw_strokes — no need to compute raw coordinates.',
    parameters: {
      type: 'object',
      properties: {
        shape: {
          type: 'string',
          enum: ['circle', 'rectangle', 'line', 'triangle', 'star', 'arrow'],
          description: 'Shape type',
        },
        x: { type: 'number', description: 'Center X (or start X for line/arrow)' },
        y: { type: 'number', description: 'Center Y (or start Y for line/arrow)' },
        size: {
          type: 'number',
          description: 'Size in pixels (radius for circle, side length for others)',
        },
        color: { type: 'string', description: 'CSS color string' },
        width: { type: 'number', description: 'Stroke width' },
        rotation: { type: 'number', description: 'Rotation in degrees, default 0' },
      },
      required: ['shape', 'x', 'y', 'size'],
    },
  },
]

function shapeToPoints(
  shape: string,
  cx: number,
  cy: number,
  size: number,
  rotation: number
): Array<{ x: number; y: number }> {
  const rad = (rotation * Math.PI) / 180
  const rotate = (px: number, py: number) => ({
    x: cx + (px - cx) * Math.cos(rad) - (py - cy) * Math.sin(rad),
    y: cy + (px - cx) * Math.sin(rad) + (py - cy) * Math.cos(rad),
  })

  switch (shape) {
    case 'circle': {
      const pts: Array<{ x: number; y: number }> = []
      const steps = 48
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2
        pts.push(rotate(cx + Math.cos(angle) * size, cy + Math.sin(angle) * size))
      }
      return pts
    }
    case 'rectangle': {
      const half = size / 2
      return [
        rotate(cx - half, cy - half),
        rotate(cx + half, cy - half),
        rotate(cx + half, cy + half),
        rotate(cx - half, cy + half),
        rotate(cx - half, cy - half),
      ]
    }
    case 'line': {
      return [rotate(cx, cy), rotate(cx + size, cy)]
    }
    case 'triangle': {
      const h = (size * Math.sqrt(3)) / 2
      return [
        rotate(cx, cy - (2 * h) / 3),
        rotate(cx - size / 2, cy + h / 3),
        rotate(cx + size / 2, cy + h / 3),
        rotate(cx, cy - (2 * h) / 3),
      ]
    }
    case 'star': {
      const pts: Array<{ x: number; y: number }> = []
      const outerR = size
      const innerR = size * 0.4
      for (let i = 0; i <= 10; i++) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? outerR : innerR
        pts.push(rotate(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r))
      }
      return pts
    }
    case 'arrow': {
      const endX = cx + size
      const headLen = size * 0.2
      // Shaft
      const shaft = [rotate(cx, cy), rotate(endX, cy)]
      // Arrowhead
      const head1 = rotate(endX - headLen, cy - headLen * 0.6)
      const head2 = rotate(endX - headLen, cy + headLen * 0.6)
      return [...shaft, head1, rotate(endX, cy), head2]
    }
    default:
      return [{ x: cx, y: cy }]
  }
}

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

        case 'draw_strokes': {
          if (!c) {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { error: 'Canvas not ready' } },
              '*'
            )
            return
          }
          const rawStrokes = params.strokes as Array<{
            points: Array<{ x: number; y: number }>
            color?: string
            width?: number
          }>
          if (!Array.isArray(rawStrokes)) {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { error: 'strokes must be an array' } },
              '*'
            )
            return
          }
          const strokesToDraw: Stroke[] = rawStrokes.map((s) => ({
            points: s.points,
            color: s.color || '#000000',
            width: s.width || 3,
          }))
          const clearFirst = Boolean(params.clearFirst)
          c.drawStrokesAnimated(strokesToDraw, clearFirst).then((res) => {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { status: 'drawn', ...res } },
              '*'
            )
            sendStateUpdate()
          })
          break
        }

        case 'draw_shape': {
          if (!c) {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { error: 'Canvas not ready' } },
              '*'
            )
            return
          }
          const shapeName = params.shape as string
          const sx = params.x as number
          const sy = params.y as number
          const sSize = params.size as number
          const sColor = (params.color as string) || '#000000'
          const sWidth = (params.width as number) || 3
          const sRotation = (params.rotation as number) || 0

          if (!shapeName || sx == null || sy == null || !sSize) {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { error: 'shape, x, y, and size are required' } },
              '*'
            )
            return
          }

          const shapePoints = shapeToPoints(shapeName, sx, sy, sSize, sRotation)
          const shapeStroke: Stroke = { points: shapePoints, color: sColor, width: sWidth }
          c.drawStrokesAnimated([shapeStroke], false).then(() => {
            window.parent.postMessage(
              { type: 'tool_result', toolCallId, result: { status: 'drawn', shape: shapeName } },
              '*'
            )
            sendStateUpdate()
          })
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
