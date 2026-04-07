interface ToolbarProps {
  color: string
  brushWidth: number
  tool: 'pen' | 'eraser'
  onColorChange: (color: string) => void
  onBrushWidthChange: (width: number) => void
  onToolChange: (tool: 'pen' | 'eraser') => void
  onUndo: () => void
  onClear: () => void
}

const PRESET_COLORS = [
  '#000000', // black
  '#e74c3c', // red
  '#3498db', // blue
  '#27ae60', // green
  '#f1c40f', // yellow
  '#e67e22', // orange
  '#9b59b6', // purple
  '#8B4513', // brown
]

const BRUSH_SIZES: Array<{ label: string; value: number }> = [
  { label: 'S', value: 2 },
  { label: 'M', value: 5 },
  { label: 'L', value: 10 },
]

export default function Toolbar({
  color,
  brushWidth,
  tool,
  onColorChange,
  onBrushWidthChange,
  onToolChange,
  onUndo,
  onClear,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={`color-btn ${color === c && tool === 'pen' ? 'active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => {
              onColorChange(c)
              onToolChange('pen')
            }}
            title={c}
          />
        ))}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        {BRUSH_SIZES.map((s) => (
          <button
            key={s.value}
            className={`size-btn ${brushWidth === s.value ? 'active' : ''}`}
            onClick={() => onBrushWidthChange(s.value)}
          >
            <span
              className="size-dot"
              style={{
                width: s.value * 2 + 4,
                height: s.value * 2 + 4,
              }}
            />
            {s.label}
          </button>
        ))}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-section">
        <button
          className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
          onClick={() => onToolChange(tool === 'eraser' ? 'pen' : 'eraser')}
          title="Eraser"
        >
          Eraser
        </button>
        <button className="tool-btn" onClick={onUndo} title="Undo">
          Undo
        </button>
        <button className="tool-btn danger" onClick={onClear} title="Clear">
          Clear
        </button>
      </div>
    </div>
  )
}
