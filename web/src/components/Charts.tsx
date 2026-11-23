import { useId, useMemo } from 'react'
import { motion } from 'framer-motion'

function buildPath(values: number[], w: number, h: number, pad = 4) {
  if (values.length < 2) return { line: '', area: '', min: 0, max: 0, pts: [] as [number, number][] }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, pad + (1 - (v - min) / span) * (h - pad * 2)] as [number, number])
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  return { line, area, min, max, pts }
}

export function Sparkline({ values, up, width = 120, height = 40 }: { values: number[]; up: boolean; width?: number; height?: number }) {
  const id = useId()
  const { line, area } = useMemo(() => buildPath(values, width, height), [values, width, height])
  const color = up ? 'var(--up)' : 'var(--down)'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={up ? '#FFFFFF' : '#7D7D7D'} stopOpacity="0.25" />
          <stop offset="1" stopColor={up ? '#FFFFFF' : '#7D7D7D'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Responsive area chart with animated draw-in. */
export function AreaChart({
  values,
  height = 220,
  animate = true,
  showGrid = true,
  markers,
}: {
  values: number[]
  height?: number
  animate?: boolean
  showGrid?: boolean
  markers?: { value: number; label: string; color: string }[]
}) {
  const id = useId()
  const W = 600
  const { line, area, min, max, pts } = useMemo(() => {
    const all = markers?.length ? [...values, ...markers.map((m) => m.value)] : values
    const r = buildPath(values, W, height, 14)
    if (!markers?.length) return r
    // rescale including markers
    const mn = Math.min(...all)
    const mx = Math.max(...all)
    const span = mx - mn || 1
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, 14 + (1 - (v - mn) / span) * (height - 28)] as [number, number])
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    return { line, area: `${line} L${W},${height} L0,${height} Z`, min: mn, max: mx, pts }
  }, [values, height, markers])
  const last = pts[pts.length - 1]
  const yOf = (v: number) => 14 + (1 - (v - min) / (max - min || 1)) * (height - 28)

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }} aria-label="Attention index chart">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {showGrid &&
        [0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        ))}
      {markers?.map((m) => (
        <g key={m.label}>
          <line x1="0" x2={W} y1={yOf(m.value)} y2={yOf(m.value)} stroke={m.color} strokeDasharray="5 5" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.8" />
        </g>
      ))}
      <motion.path
        d={area}
        fill={`url(#${id})`}
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.6 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      />
      {last && (
        <motion.circle
          cx={last[0]}
          cy={last[1]}
          r="4"
          fill="#FFFFFF"
          initial={animate ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ delay: 1.5 }}
        />
      )}
    </svg>
  )
}
