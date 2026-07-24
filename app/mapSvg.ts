// geojsonからコロプレス地図をSVGで自前描画し、PNG(dataURL)に変換する。
// タイルを使わない＝CORS汚染が起きずcanvas.toDataURLが確実に通る。背景(海)は描かない。

type GJ = any

// 黄→橙→赤のカラーランプ（MapViewのrampと同系）
export function ramp(t: number): string {
  t = Math.max(0, Math.min(1, t))
  const s = [[255, 255, 204], [253, 141, 60], [189, 0, 38]]
  const g = t * 2
  const i = Math.floor(g)
  const f = g - i
  const a = s[i]
  const b = s[Math.min(i + 1, 2)]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}

// ポリゴン/マルチポリゴンから「リング配列」を取り出す（外周・穴をまとめて扱う）
function rings(geom: GJ): number[][][] {
  if (!geom) return []
  if (geom.type === 'Polygon') return geom.coordinates
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat()
  return []
}

type FeatStyle = { fill: string; stroke: string; strokeWidth: number }

// geojson(FeatureCollection)を等緯度経度＋経度cos補正でSVGパスに落とす
export function buildChoropleth(
  geo: GJ,
  nameKey: string,
  styleOf: (name: string) => FeatStyle,
  W = 640,
  H = 560,
  pad = 12,
  padBottom = pad, // 下部に凡例バンドを確保する場合に大きくする
  clip?: [number, number, number, number], // [minLng,minLat,maxLng,maxLat] この範囲でbbox算出（遠隔離島を除き本土を拡大）
  inset?: { clip: [number, number, number, number]; box: [number, number, number, number]; label?: string }, // 別枠表示（例:沖縄を右下に）
): string {
  const feats: GJ[] = geo?.features ?? []
  // bbox（clip指定時はその範囲内の座標のみで算出＝南鳥島等を無視して本土を大きく）
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  const inClip = (lng: number, lat: number) => !clip || (lng >= clip[0] && lng <= clip[2] && lat >= clip[1] && lat <= clip[3])
  for (const ft of feats) {
    for (const ring of rings(ft.geometry)) {
      for (const [lng, lat] of ring) {
        if (!inClip(lng, lat)) continue
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  if (!Number.isFinite(minLng)) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`
  const midLat = (minLat + maxLat) / 2
  const kx = Math.cos((midLat * Math.PI) / 180) // 経度方向の縮み補正
  const spanX = (maxLng - minLng) * kx
  const spanY = maxLat - minLat
  const scale = Math.min((W - 2 * pad) / spanX, (H - pad - padBottom) / spanY)
  const drawW = spanX * scale
  const drawH = spanY * scale
  const offX = (W - drawW) / 2
  const offY = pad + ((H - pad - padBottom) - drawH) / 2 // 下部バンドを除いた領域に地図を収める
  const px = (lng: number) => offX + (lng - minLng) * kx * scale
  const py = (lat: number) => offY + (maxLat - lat) * scale // 緯度は上が大きいので反転

  const paths: string[] = []
  for (const ft of feats) {
    const name = ft.properties?.[nameKey]
    const st = styleOf(name)
    const d = rings(ft.geometry)
      .map((ring) => 'M' + ring.map(([lng, lat]) => `${px(lng).toFixed(1)},${py(lat).toFixed(1)}`).join('L') + 'Z')
      .join(' ')
    if (!d) continue
    paths.push(`<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.strokeWidth}" stroke-linejoin="round"/>`)
  }
  // 別枠（インセット：沖縄等を右下の小窓に）
  if (inset) {
    const [a0, a1, a2, a3] = inset.clip
    const [bx, by, bw, bh] = inset.box
    const inC = (lng: number, lat: number) => lng >= a0 && lng <= a2 && lat >= a1 && lat <= a3
    let inx = Infinity, ixx = -Infinity, iny = Infinity, ixy = -Infinity
    for (const ft of feats) for (const ring of rings(ft.geometry)) for (const [lng, lat] of ring) {
      if (!inC(lng, lat)) continue
      if (lng < inx) inx = lng; if (lng > ixx) ixx = lng; if (lat < iny) iny = lat; if (lat > ixy) ixy = lat
    }
    if (Number.isFinite(inx)) {
      const ipad = 6
      const ikx = Math.cos(((iny + ixy) / 2 * Math.PI) / 180)
      const ispanX = (ixx - inx) * ikx, ispanY = ixy - iny
      const isc = Math.min((bw - 2 * ipad) / ispanX, (bh - 2 * ipad) / ispanY)
      const iox = bx + (bw - ispanX * isc) / 2, ioy = by + (bh - ispanY * isc) / 2
      const ipx = (lng: number) => iox + (lng - inx) * ikx * isc
      const ipy = (lat: number) => ioy + (ixy - lat) * isc
      const ip: string[] = [`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#c5d0e0" stroke-width="1" rx="3"/>`]
      for (const ft of feats) {
        const name = ft.properties?.[nameKey]
        const st = styleOf(name)
        for (const ring of rings(ft.geometry)) {
          if (!ring.length || !inC(ring[0][0], ring[0][1])) continue
          const d = 'M' + ring.map(([lng, lat]) => `${ipx(lng).toFixed(1)},${ipy(lat).toFixed(1)}`).join('L') + 'Z'
          ip.push(`<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="0.4" stroke-linejoin="round"/>`)
        }
      }
      if (inset.label) ip.push(`<text x="${bx + 4}" y="${by + 14}" font-size="12" fill="#555">${inset.label.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</text>`)
      paths.push(ip.join(''))
    }
  }
  // 背景(海)は描かない＝透明SVG。styleで画面表示時はレスポンシブ、PNG化時は属性幅を使う
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto">${paths.join('')}</svg>`
}

// 散布図SVG（点＋回帰直線）。クロス分析（医療費×要因）をスライド画像化するため。背景なし
export function scatterSvg(pts: { x: number; y: number; name?: string }[], xLabel: string, yLabel: string, W = 660, H = 540, highlight?: string): string {
  const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const nf = (x: number) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 1 })
  if (pts.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"></svg>`
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const LX = 64, RX = 18, TY = 18, BY = 52
  const sx = (x: number) => LX + (xmax > xmin ? (x - xmin) / (xmax - xmin) : 0.5) * (W - LX - RX)
  const sy = (y: number) => H - BY - (ymax > ymin ? (y - ymin) / (ymax - ymin) : 0.5) * (H - TY - BY)
  const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0
  pts.forEach((p) => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my) })
  const slope = sxx ? sxy / sxx : 0, icpt = my - slope * mx
  const axes = `<line x1="${LX}" y1="${H - BY}" x2="${W - RX}" y2="${H - BY}" stroke="#999" stroke-width="1.2"/><line x1="${LX}" y1="${TY}" x2="${LX}" y2="${H - BY}" stroke="#999" stroke-width="1.2"/>`
  const line = `<line x1="${sx(xmin).toFixed(1)}" y1="${sy(slope * xmin + icpt).toFixed(1)}" x2="${sx(xmax).toFixed(1)}" y2="${sy(slope * xmax + icpt).toFixed(1)}" stroke="#388052" stroke-width="2.6" stroke-dasharray="7,4"/>`
  // 対象県以外は水色の点。対象県は濃赤で大きく描き、件名＋値ラベルを添える
  const isHi = (p: { name?: string }) => !!highlight && p.name === highlight
  const dots = pts.filter((p) => !isHi(p)).map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="5.5" fill="#8AC8A1" fill-opacity="0.72"/>`).join('')
  const hp = pts.find(isHi)
  let hiDot = ''
  if (hp) {
    const cx = sx(hp.x), cy = sy(hp.y)
    const right = cx < W * 0.62 // 点が左寄りならラベルを右に、右寄りなら左に出して枠外回避
    const tx = right ? cx + 12 : cx - 12
    const anchor = right ? 'start' : 'end'
    hiDot = `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8.5" fill="#C0143C" stroke="#ffffff" stroke-width="2"/>`
      + `<text x="${tx.toFixed(1)}" y="${(cy - 9).toFixed(1)}" font-size="17" font-weight="bold" text-anchor="${anchor}" fill="#C0143C">${esc(hp.name ?? '')}</text>`
      + `<text x="${tx.toFixed(1)}" y="${(cy + 8).toFixed(1)}" font-size="14" text-anchor="${anchor}" fill="#C0143C">${nf(hp.y)}</text>`
  }
  const labels = `<text x="${(LX + W - RX) / 2}" y="${H - 14}" font-size="17" text-anchor="middle" fill="#444">${esc(xLabel)}</text>` +
    `<text x="20" y="${(TY + H - BY) / 2}" font-size="17" text-anchor="middle" fill="#444" transform="rotate(-90 20 ${(TY + H - BY) / 2})">${esc(yLabel)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto">${axes}${line}${dots}${hiDot}${labels}</svg>`
}

// 凡例だけの独立SVG（地図に重ねる用）。色スケール＋低/高の値＋指標名。白半透明背景
export function legendSvg(label: string, unit: string, min: number, max: number, W = 244, H = 66): string {
  const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
  const nf = (x: number) => Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 1 })
  const lx = 12, lw = W - 24
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto">`
    + `<defs><linearGradient id="lgo" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(255,255,204)"/><stop offset="0.5" stop-color="rgb(253,141,60)"/><stop offset="1" stop-color="rgb(189,0,38)"/></linearGradient></defs>`
    + `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#ffffff" fill-opacity="0.9" stroke="#d6e0ee" stroke-width="0.8" rx="5"/>`
    + `<text x="${lx}" y="18" font-size="13" fill="#333">${esc(label)}</text>`
    + `<rect x="${lx}" y="26" width="${lw}" height="13" fill="url(#lgo)" stroke="#999" stroke-width="0.8"/>`
    + `<text x="${lx}" y="57" font-size="12" fill="#555">低 ${nf(min)}${esc(unit)}</text>`
    + `<text x="${lx + lw}" y="57" font-size="12" fill="#555" text-anchor="end">高 ${nf(max)}${esc(unit)}</text>`
    + `</svg>`
}

// SVG文字列をPNG(dataURL)に変換（外部リソース無し＝canvasは汚染されない）
export async function svgToPng(svg: string, W: number, H: number, scale = 2): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.width = W
    img.height = H
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg image load failed'))
      img.src = url
    })
    const cv = document.createElement('canvas')
    cv.width = W * scale
    cv.height = H * scale
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, W, H)
    return cv.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
