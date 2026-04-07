import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'

export interface Stroke {
  points: Array<{ x: number; y: number }>
  color: string
  width: number
}

export interface CanvasHandle {
  getDataUrl: () => string
  getStrokes: () => Stroke[]
  getStrokeCount: () => number
  isEmpty: () => boolean
  clearCanvas: (backgroundColor: string) => void
  undoStroke: () => number
  getSize: () => { width: number; height: number }
  drawStrokesAnimated: (strokes: Stroke[], clearFirst: boolean) => Promise<{ strokesAdded: number; totalStrokes: number }>
}

interface CanvasProps {
  color: string
  brushWidth: number
  tool: 'pen' | 'eraser'
  onStrokeEnd: () => void
}

const Canvas = forwardRef<CanvasHandle, CanvasProps>(
  ({ color, brushWidth, tool, onStrokeEnd }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const strokesRef = useRef<Stroke[]>([])
    const currentStrokeRef = useRef<Stroke | null>(null)
    const isDrawingRef = useRef(false)
    const bgColorRef = useRef('#ffffff')

    const redraw = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = bgColorRef.current
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      for (const stroke of strokesRef.current) {
        drawStroke(ctx, stroke)
      }
    }, [])

    function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
      if (stroke.points.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (stroke.color === 'eraser') {
        ctx.strokeStyle = bgColorRef.current
      }

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.stroke()
    }

    function getCanvasPoint(
      canvas: HTMLCanvasElement,
      clientX: number,
      clientY: number
    ): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      }
    }

    const startDrawing = useCallback(
      (clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas) return
        isDrawingRef.current = true
        const point = getCanvasPoint(canvas, clientX, clientY)
        const strokeColor = tool === 'eraser' ? 'eraser' : color
        currentStrokeRef.current = {
          points: [point],
          color: strokeColor,
          width: tool === 'eraser' ? brushWidth * 3 : brushWidth,
        }
      },
      [color, brushWidth, tool]
    )

    const continueDrawing = useCallback((clientX: number, clientY: number) => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const point = getCanvasPoint(canvas, clientX, clientY)
      const stroke = currentStrokeRef.current
      const prevPoint = stroke.points[stroke.points.length - 1]
      stroke.points.push(point)

      ctx.beginPath()
      ctx.strokeStyle =
        stroke.color === 'eraser' ? bgColorRef.current : stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.moveTo(prevPoint.x, prevPoint.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }, [])

    const endDrawing = useCallback(() => {
      if (!isDrawingRef.current || !currentStrokeRef.current) return
      isDrawingRef.current = false
      if (currentStrokeRef.current.points.length >= 2) {
        strokesRef.current = [...strokesRef.current, currentStrokeRef.current]
        onStrokeEnd()
      }
      currentStrokeRef.current = null
    }, [onStrokeEnd])

    // Mouse events
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const handleMouseDown = (e: MouseEvent) => {
        e.preventDefault()
        startDrawing(e.clientX, e.clientY)
      }
      const handleMouseMove = (e: MouseEvent) => {
        continueDrawing(e.clientX, e.clientY)
      }
      const handleMouseUp = () => endDrawing()

      // Touch events
      const handleTouchStart = (e: TouchEvent) => {
        e.preventDefault()
        const touch = e.touches[0]
        startDrawing(touch.clientX, touch.clientY)
      }
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        const touch = e.touches[0]
        continueDrawing(touch.clientX, touch.clientY)
      }
      const handleTouchEnd = (e: TouchEvent) => {
        e.preventDefault()
        endDrawing()
      }

      canvas.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
      canvas.addEventListener('touchend', handleTouchEnd, { passive: false })

      return () => {
        canvas.removeEventListener('mousedown', handleMouseDown)
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        canvas.removeEventListener('touchstart', handleTouchStart)
        canvas.removeEventListener('touchmove', handleTouchMove)
        canvas.removeEventListener('touchend', handleTouchEnd)
      }
    }, [startDrawing, continueDrawing, endDrawing])

    // Resize canvas to fill container
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      const resize = () => {
        const parent = canvas.parentElement
        if (!parent) return
        const { width, height } = parent.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.scale(dpr, dpr)
        // Reset internal coordinate system for getCanvasPoint
        canvas.width = width
        canvas.height = height
        redraw()
      }

      resize()
      window.addEventListener('resize', resize)
      return () => window.removeEventListener('resize', resize)
    }, [redraw])

    useImperativeHandle(ref, () => ({
      getDataUrl: () => {
        const canvas = canvasRef.current
        if (!canvas) return ''
        return canvas.toDataURL('image/png')
      },
      getStrokes: () =>
        strokesRef.current.map((s) => ({
          points: [...s.points],
          color: s.color === 'eraser' ? bgColorRef.current : s.color,
          width: s.width,
        })),
      getStrokeCount: () => strokesRef.current.length,
      isEmpty: () => strokesRef.current.length === 0,
      clearCanvas: (backgroundColor: string) => {
        bgColorRef.current = backgroundColor || '#ffffff'
        strokesRef.current = []
        redraw()
      },
      undoStroke: () => {
        strokesRef.current = strokesRef.current.slice(0, -1)
        redraw()
        return strokesRef.current.length
      },
      getSize: () => {
        const canvas = canvasRef.current
        if (!canvas) return { width: 0, height: 0 }
        return { width: canvas.width, height: canvas.height }
      },
      drawStrokesAnimated: async (strokes: Stroke[], clearFirst: boolean) => {
        const canvas = canvasRef.current
        if (!canvas) return { strokesAdded: 0, totalStrokes: strokesRef.current.length }
        const ctx = canvas.getContext('2d')
        if (!ctx) return { strokesAdded: 0, totalStrokes: strokesRef.current.length }

        if (clearFirst) {
          bgColorRef.current = '#ffffff'
          strokesRef.current = []
          ctx.fillStyle = bgColorRef.current
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }

        let added = 0
        for (const stroke of strokes) {
          if (stroke.points.length < 2) continue

          // Animate: draw point-by-point with delays
          const animStroke: Stroke = { points: [stroke.points[0]], color: stroke.color, width: stroke.width }
          for (let i = 1; i < stroke.points.length; i++) {
            animStroke.points.push(stroke.points[i])
            const prev = stroke.points[i - 1]
            const cur = stroke.points[i]
            ctx.beginPath()
            ctx.strokeStyle = stroke.color === 'eraser' ? bgColorRef.current : stroke.color
            ctx.lineWidth = stroke.width
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.moveTo(prev.x, prev.y)
            ctx.lineTo(cur.x, cur.y)
            ctx.stroke()

            // Small delay between segments for animation effect
            if (i % 3 === 0) {
              await new Promise((r) => setTimeout(r, 16))
            }
          }

          // Add to stroke history for undo support
          strokesRef.current = [...strokesRef.current, stroke]
          added++

          // Delay between strokes
          if (strokes.length > 1) {
            await new Promise((r) => setTimeout(r, 80))
          }
        }

        return { strokesAdded: added, totalStrokes: strokesRef.current.length }
      },
    }))

    return (
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: tool === 'eraser' ? 'cell' : 'crosshair',
          touchAction: 'none',
        }}
      />
    )
  }
)

Canvas.displayName = 'Canvas'
export default Canvas
