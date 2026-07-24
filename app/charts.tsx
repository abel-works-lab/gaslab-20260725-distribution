'use client'

// 画面表示用の軽量SVGチャート（棒・レーダー）。依存ライブラリ無し。

const NAVY = '#388052'
const SKY = '#8AC8A1'
const GRAY = '#5d6f8c'

function nf(x: number) {
  return Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}

// 横棒グラフ（降順表示・選択行をハイライト）
export function BarH({
  rows,
  unit = '',
  highlight,
}: {
  rows: { name: string; value: number }[]
  unit?: string
  highlight?: string | null
}) {
  if (!rows.length) return <div style={{ fontSize: 12, color: GRAY }}>データなし</div>
  const sorted = [...rows].sort((a, b) => b.value - a.value)
  const max = Math.max(...sorted.map((d) => d.value), 0)
  const min = Math.min(...sorted.map((d) => d.value), 0)
  const base = min < 0 ? min : 0
  const span = max - base || 1
  const rowH = 20
  const labelW = 92
  const W = 420
  const barArea = W - labelW - 54
  const H = sorted.length * rowH + 6
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {sorted.map((d, i) => {
        const y = i * rowH + 3
        const w = (Math.abs(d.value - base) / span) * barArea
        const isHi = highlight && d.name === highlight
        return (
          <g key={d.name}>
            <text x={labelW - 4} y={y + rowH / 2 + 3} fontSize={11} textAnchor="end" fill={isHi ? NAVY : '#1b2740'} fontWeight={isHi ? 700 : 400}>
              {d.name.length > 7 ? d.name.slice(0, 7) : d.name}
            </text>
            <rect x={labelW} y={y + 2} width={Math.max(w, 1)} height={rowH - 7} rx={2} fill={isHi ? NAVY : SKY} opacity={isHi ? 1 : 0.85} />
            <text x={labelW + w + 4} y={y + rowH / 2 + 3} fontSize={10.5} fill={GRAY}>{nf(d.value)}{unit}</text>
          </g>
        )
      })}
    </svg>
  )
}

// レーダーチャート（全国平均=1.0 を基準円に、対象県の比率を多角形で描く）
export function Radar({ axes, baseLabel = '全国平均(=1.0)', selfLabel = '当県' }: { axes: { label: string; ratio: number }[]; baseLabel?: string; selfLabel?: string }) {
  const n = axes.length
  if (n < 3) return <div style={{ fontSize: 12, color: GRAY }}>レーダーは3指標以上で表示</div>
  const W = 380, H = 320, cx = W / 2, cy = H / 2 + 6, R = 110
  const maxR = Math.max(1.2, ...axes.map((a) => a.ratio)) // 1.0(全国)を必ず内側に含める
  const ang = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const pt = (i: number, r: number) => [cx + Math.cos(ang(i)) * (r / maxR) * R, cy + Math.sin(ang(i)) * (r / maxR) * R]
  const poly = axes.map((a, i) => pt(i, a.ratio).map((v) => v.toFixed(1)).join(',')).join(' ')
  const base = axes.map((_, i) => pt(i, 1).map((v) => v.toFixed(1)).join(',')).join(' ') // 全国=1の基準多角形
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* グリッド */}
      {[0.5, 1, 1.5].filter((g) => g <= maxR).map((g) => (
        <polygon key={g} points={axes.map((_, i) => pt(i, g).map((v) => v.toFixed(1)).join(',')).join(' ')} fill="none" stroke="#e1e9f3" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, maxR)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e1e9f3" strokeWidth={1} />
      })}
      {/* 全国=1.0 基準 */}
      <polygon points={base} fill="none" stroke={GRAY} strokeWidth={1.5} strokeDasharray="4,3" />
      {/* 対象県 */}
      <polygon points={poly} fill={SKY} fillOpacity={0.28} stroke={NAVY} strokeWidth={2} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, maxR)
        const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end'
        return (
          <text key={a.label} x={x + (x > cx ? 4 : x < cx ? -4 : 0)} y={y + (y > cy ? 11 : -3)} fontSize={10} textAnchor={anchor} fill="#1b2740">
            {a.label.length > 9 ? a.label.slice(0, 9) : a.label}
          </text>
        )
      })}
      <text x={cx} y={H - 4} fontSize={10} textAnchor="middle" fill={GRAY}>破線={baseLabel} / 塗り={selfLabel}</text>
    </svg>
  )
}
