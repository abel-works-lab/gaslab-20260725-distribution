'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import AiPanel from './AiPanel'
import { BarH } from './charts'
import 'leaflet/dist/leaflet.css'

type Pref = { name: string; metrics: Record<string, number>; costByYear: Record<string, number> }

const METRICS: { k: string; label: string; unit: string; year?: boolean }[] = [
  { k: 'per_capita_cost', label: '一人当たり医療費(国民医療費・R3-R5)', unit: '千円', year: true },
  { k: 'mc_kokuho', label: '国保 一人当たり医療費(R5)', unit: '円' },
  { k: 'mc_kouki', label: '後期 一人当たり医療費(R5)', unit: '円' },
  // mc_koukiKenshinの実体は特定健診受診率(全保険者)。フィールド名はseed互換のため維持
  { k: 'mc_koukiKenshin', label: '特定健診 受診率(全保険者・R5)', unit: '%' },
  { k: 'mc_tokuteiHoken', label: '特定保健指導 実施率(全保険者・R5)', unit: '%' },
  { k: 'aging_rate', label: '高齢化率(R6)', unit: '%' },
  { k: 'beds_per_100k', label: '病床数(人口10万対・R5)', unit: '床' },
  { k: 'doctors_per_100k', label: '医師数(人口10万対・R5)', unit: '人' },
  { k: 'admit_rate', label: '入院受療率(10万対・R5)', unit: '' },
  { k: 'outpatient_rate', label: '外来受療率(10万対・R5)', unit: '' },
  { k: 'checkup_rate', label: '特定健診 実施率(国保・R5)', unit: '%' },
  { k: 'guidance_rate', label: '特定保健指導 実施率(国保・R5)', unit: '%' },
  { k: 'dis_diabetes', label: '糖尿病 外来(R5)', unit: '(10万対)' },
  { k: 'dis_htn', label: '高血圧 外来(R5)', unit: '(10万対)' },
  { k: 'dis_ihd', label: '虚血性心疾患 外来(R5)', unit: '(10万対)' },
  { k: 'dis_stroke', label: '脳血管疾患 外来(R5)', unit: '(10万対)' },
  { k: 'dis_cancer', label: 'がん 外来(R5)', unit: '(10万対)' },
  { k: 'dis_mental', label: '精神疾患 外来(R5)', unit: '(10万対)' },
  { k: 'dis_renal', label: '腎不全 外来(R5)', unit: '(10万対)' },
  { k: 'dis_msk', label: '筋骨格 外来(R5)', unit: '(10万対)' },
  { k: 'dis_diabetes_in', label: '糖尿病 入院(R5)', unit: '(10万対)' },
  { k: 'dis_htn_in', label: '高血圧 入院(R5)', unit: '(10万対)' },
  { k: 'dis_ihd_in', label: '虚血性心疾患 入院(R5)', unit: '(10万対)' },
  { k: 'dis_stroke_in', label: '脳血管疾患 入院(R5)', unit: '(10万対)' },
  { k: 'dis_cancer_in', label: 'がん 入院(R5)', unit: '(10万対)' },
  { k: 'dis_mental_in', label: '精神疾患 入院(R5)', unit: '(10万対)' },
  { k: 'dis_renal_in', label: '腎不全 入院(R5)', unit: '(10万対)' },
  { k: 'dis_msk_in', label: '筋骨格 入院(R5)', unit: '(10万対)' },
  { k: 'smoke_rate', label: '喫煙者割合(R4)', unit: '%' },
  { k: 'complaint_rate', label: '有訴者率(R4)', unit: '人口千対' },
  { k: 'visit_rate', label: '通院者率(R4)', unit: '人口千対' },
  { k: 'death_rate', label: '死亡率・全死因(R6)', unit: '人口千対' },
  { k: 'npo_per10k', label: 'NPO法人認証数(人口万対・R5末)', unit: '法人' },
]

// AiPanelのレーダー/スライド用カタログ（mc_系はAiPanelからアクセス不可なので除外）
const AI_METRICS = METRICS.filter((m) => !m.k.startsWith('mc_')).map((m) => ({ k: m.k, label: m.label }))

// 県内市町村比較が可能な県（regionFactorsデータ＋市区町村geojsonが揃っている県）
const MUNI_PREFS: Record<string, string> = {
  山口県: 'yamaguchi_cities',
  島根県: 'shimane_cities',
  奈良県: 'nara_cities',
}

function ramp(t: number) {
  t = Math.max(0, Math.min(1, t))
  const s = [[255, 255, 204], [253, 141, 60], [189, 0, 38]]
  const g = t * 2
  const i = Math.floor(g)
  const f = g - i
  const a = s[i]
  const b = s[Math.min(i + 1, 2)]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}
function fmt(x: number | null | undefined) {
  return x == null ? '-' : Number(x).toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}
// tooltipはHTML解釈されるため地名等の動的値はエスケープ
function esc(s: string) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
}

const selStyle: React.CSSProperties = { padding: '7px 9px', background: '#fff', color: '#1b2740', border: '1px solid #d6e0ee', borderRadius: 7, fontSize: 13 }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #d6e0ee', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>{title}</h2>
      {children}
    </div>
  )
}

function RankTable({ title, rows }: { title: string; rows: { name: string; value: number }[] }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color: '#5d6f8c', marginBottom: 4 }}>{title}</div>
      <table style={tableStyle}>
        <tbody>
          {rows.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td style={{ textAlign: 'right' }}>{d.value.toLocaleString('ja-JP')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Scatter({ data, label }: { data: { pts: { p: string; x: number; y: number; res?: number }[]; slope: number; icpt: number }; label: string }) {
  const { pts, slope, icpt } = data
  const xs = pts.map((d) => d.x)
  const ys = pts.map((d) => d.y)
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys)
  const W = 420, H = 240, LX = 46, RX = 8, TY = 10, BY = 26
  // 全点同値（max===min）のときは0除算でNaNになるため中央に配置
  const sx = (x: number) => xmax === xmin ? (LX + W - RX) / 2 : LX + ((x - xmin) / (xmax - xmin)) * (W - LX - RX)
  const sy = (y: number) => ymax === ymin ? (TY + H - BY) / 2 : H - BY - ((y - ymin) / (ymax - ymin)) * (H - TY - BY)
  return (
    <svg width="100%" height={240} viewBox={`0 0 ${W} ${H}`}>
      <line x1={LX} y1={H - BY} x2={W - RX} y2={H - BY} stroke="#c5d0e0" />
      <line x1={LX} y1={TY} x2={LX} y2={H - BY} stroke="#c5d0e0" />
      <line x1={sx(xmin)} y1={sy(slope * xmin + icpt)} x2={sx(xmax)} y2={sy(slope * xmax + icpt)} stroke="#e8a020" strokeWidth={2} strokeDasharray="5,4" />
      {pts.map((d) => (
        <circle key={d.p} cx={sx(d.x)} cy={sy(d.y)} r={4} fill={(d.res ?? 0) > 0 ? '#d63b2f' : '#1f9d57'} opacity={0.8}>
          <title>{`${d.p} / ${label}:${d.x} / 医療費:${d.y}千円`}</title>
        </circle>
      ))}
      <text x={(LX + W) / 2} y={H - 6} fill="#5d6f8c" fontSize={11} textAnchor="middle">{label}</text>
    </svg>
  )
}

type RegionRow = { pref: string; city: string; metrics: { item: string; label: string; value: number; year?: string | null }[] }
type MuniStat = { pref: string; city: string; kokuho: number; kouki: number; kenshin: number | null; hoken: number | null; year: string }
type NatKey = 'kokuho' | 'kouki' | 'kenshin' | 'hoken'
type MedPref = { name: string; kokuho: number; kouki: number; koukiKenshin?: number; tokuteiHoken?: number; year: string }

// 全国市町村ランキングの選択指標（muniStats R5）
const NAT_MUNI: { k: NatKey; label: string; unit: string }[] = [
  { k: 'kokuho', label: '国保 一人当たり医療費', unit: '円' },
  { k: 'kouki', label: '後期 一人当たり医療費', unit: '円' },
  { k: 'kenshin', label: '特定健診 実施率(国保)', unit: '%' },
  { k: 'hoken', label: '特定保健指導 実施率(国保)', unit: '%' },
]

// 地図の色閾値を動的に示す凡例（指標を変えるとmin/maxが更新される）
function Legend({ label, min, max, unit }: { label: string; min: number; max: number; unit?: string }) {
  const mid = (min + max) / 2
  return (
    <div style={{ position: 'absolute', left: 10, bottom: 14, zIndex: 500, background: 'rgba(255,255,255,0.95)', border: '1px solid #d6e0ee', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: '#1b2740', width: 220, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>凡例：{label}</div>
      <div style={{ height: 12, borderRadius: 3, background: 'linear-gradient(to right, rgb(255,255,204), rgb(253,141,60), rgb(189,0,38))' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, color: '#5d6f8c' }}>
        <span>{fmt(min)}{unit}</span><span>{fmt(mid)}</span><span>{fmt(max)}{unit}</span>
      </div>
      <div style={{ fontSize: 10, color: '#8a98ad', marginTop: 2 }}>薄い=低い / 濃い=高い（指標で閾値が変化）</div>
    </div>
  )
}

export default function MapView() {
  const prefectures = useQuery(api.facts.listPrefectures) as Pref[] | undefined
  const muniAll = useQuery(api.medicalCost.muniAll) as MuniStat[] | undefined
  const medList = useQuery(api.medicalCost.list) as MedPref[] | undefined

  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const muniLayerRef = useRef<any>(null)
  const maskLayerRef = useRef<any>(null)
  const fitPrefRef = useRef<string | null>(null) // 直近でズーム合わせした県（同一県では再fitしない）
  const geoRef = useRef<any>(null)
  const muniGeoRef = useRef<any>(null)
  const LRef = useRef<any>(null)

  const [metric, setMetric] = useState('per_capita_cost')
  const [yearIdx, setYearIdx] = useState(0) // 年次ロード後に最新年へ初期化（下のeffect）
  const [driver, setDriver] = useState('aging_rate')
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<'pref' | 'muni'>('pref')
  const [muniMetric, setMuniMetric] = useState('高齢化率(%)')
  const [natMuni, setNatMuni] = useState<NatKey>('kokuho')
  const [geoReady, setGeoReady] = useState(false)
  const [geoError, setGeoError] = useState(false) // 全国geojsonの取得失敗
  const [geoRetry, setGeoRetry] = useState(0) // 再試行トリガー
  const [muniGeoTick, setMuniGeoTick] = useState(0) // 市区町村geojsonの読み込み完了を描画effectに伝える

  // 県内市町村比較の対象県（選択県がMUNI_PREFSにある時のみ）。regionはこの県で引く
  const muniPref = selected && MUNI_PREFS[selected] ? selected : null
  const region = useQuery(
    api.seedRegion.listByPref,
    muniPref ? { pref: muniPref } : 'skip',
  ) as RegionRow[] | undefined

  // 全国市町村ランキング（選択指標・null除外・降順）
  const natRows = useMemo(() => {
    if (!muniAll) return [] as { name: string; value: number }[]
    return muniAll
      .map((m) => ({ name: `${m.pref}${m.city}`, value: m[natMuni] }))
      .filter((d): d is { name: string; value: number } => typeof d.value === 'number')
      .sort((a, b) => b.value - a.value)
  }, [muniAll, natMuni])

  // AiPanel用：R5県別医療費。毎レンダーで新配列を作るとAiPanel側のuseMemoが効かなくなるためmemo化
  const medCostForAi = useMemo(
    () => (medList ?? []).map((d) => ({ name: d.name, kokuho: d.kokuho, kouki: d.kouki })),
    [medList],
  )

  // AiPanel用：市町村×国保医療費(R5)ランキング（{name,value}互換）
  const muniForAi = useMemo(() => {
    if (!muniAll) return [] as { name: string; value: number }[]
    return muniAll
      .map((m) => ({ name: `${m.pref}${m.city}`, value: m.kokuho }))
      .sort((a, b) => b.value - a.value)
  }, [muniAll])

  const prefList = useMemo(
    () => (prefectures ? prefectures.map((p) => p.name) : []),
    [prefectures],
  )

  const muniMetricOptions = useMemo(
    () => (region && region.length ? region[0].metrics.map((m) => m.label) : []),
    [region],
  )
  // 指標ラベル→実年度（社会人口統計体系等は指標ごとに年次が異なる）
  const muniYear = useMemo(() => {
    const o: Record<string, string> = {}
    region?.[0]?.metrics.forEach((m) => { o[m.label] = m.year ?? '年度不明' })
    return o
  }, [region])
  // 市町→選択指標の値
  const muniVals = useMemo(() => {
    const o: Record<string, number> = {}
    region?.forEach((r) => {
      const mm = r.metrics.find((x) => x.label === muniMetric)
      if (mm && Number.isFinite(mm.value)) o[r.city] = mm.value
    })
    return o
  }, [region, muniMetric])

  const years = useMemo(() => {
    if (!prefectures || !prefectures.length) return [] as string[]
    return Object.keys(prefectures[0].costByYear).sort()
  }, [prefectures])

  const factsByName = useMemo(() => {
    const m: Record<string, Pref> = {}
    prefectures?.forEach((p) => (m[p.name] = p))
    return m
  }, [prefectures])

  // medicalCost(R5県)を県名で引く
  const medByPref = useMemo(() => {
    const m: Record<string, MedPref> = {}
    medList?.forEach((d) => (m[d.name] = d))
    return m
  }, [medList])
  const MC_FIELD: Record<string, keyof MedPref> = {
    mc_kokuho: 'kokuho', mc_kouki: 'kouki', mc_koukiKenshin: 'koukiKenshin', mc_tokuteiHoken: 'tokuteiHoken',
  }

  const mObj = (k: string) => METRICS.find((m) => m.k === k)!

  function getVal(pref: string, k: string, year: string): number | null | undefined {
    if (k.startsWith('mc_')) {
      const v = medByPref[pref]?.[MC_FIELD[k]]
      return typeof v === 'number' ? v : null
    }
    const p = factsByName[pref]
    if (!p) return null
    if (k === 'per_capita_cost') return p.costByYear[year]
    return p.metrics[k]
  }
  function valuesOf(k: string, year: string) {
    const o: Record<string, number> = {}
    prefectures?.forEach((p) => {
      const v = getVal(p.name, k, year)
      if (typeof v === 'number') o[p.name] = v
    })
    return o
  }

  useEffect(() => {
    let canceled = false
    async function init() {
      if (!mapEl.current) return
      if (!mapRef.current) {
        const L = (await import('leaflet')).default
        if (canceled) return
        LRef.current = L
        const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView([37.8, 137.5], 5)
        L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
        mapRef.current = map
        setTimeout(() => map.invalidateSize(), 300)
      }
      if (geoRef.current) return // 取得済みなら再fetchしない
      try {
        const res = await fetch('/japan_prefectures.geojson')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const geo = await res.json()
        if (canceled) return
        geoRef.current = geo
        setGeoError(false)
        setGeoReady(true) // 描画は再描画effectに一本化（市区町村geojsonはmuniPref連動で別途取得）
      } catch {
        if (!canceled) setGeoError(true) // 失敗時はエラー表示＋再試行ボタン（地図が塗られない状態を放置しない）
      }
    }
    init()
    return () => { canceled = true }
    // mapEl は3クエリ完了後に初めてDOMに載るため、全クエリを依存に含めて初期化漏れを防ぐ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefectures, muniAll, medList, geoRetry])

  // unmount時にLeaflet mapを破棄する専用effect（空deps＝依存変化では走らない。StrictMode二重実行はinit側のcanceledで回避済み）
  useEffect(() => {
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [])

  // 選択県の市区町村geojsonを読み込む（muniPref連動）。県名を付帯し、旧県geoでの誤描画を防ぐ
  useEffect(() => {
    let canceled = false
    // 対象県が外れたらfitズーム記録もリセット（同じ県を再選択したとき再fitBoundsさせる）
    if (!muniPref) { muniGeoRef.current = null; fitPrefRef.current = null; setMuniGeoTick((t) => t + 1); return () => { canceled = true } }
    fetch(`/${MUNI_PREFS[muniPref]}.geojson`)
      .then((r) => r.json())
      .then((g) => { if (!canceled) { muniGeoRef.current = { pref: muniPref, geo: g }; setMuniGeoTick((t) => t + 1) } })
      .catch(() => { /* geojsonが無くてもバー・表は動く */ })
    return () => { canceled = true }
  }, [muniPref])

  // 市町村比較できない県を選んだらタブを県プロファイルに戻す
  useEffect(() => {
    if (tab === 'muni' && !muniPref) setTab('pref')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  // 初回ロード時は最新年を選択。以後は範囲外にならないようクランプのみ（cost_by_year=2021-23の3年）
  const yearInitRef = useRef(false)
  useEffect(() => {
    if (!years.length) return
    if (!yearInitRef.current) { yearInitRef.current = true; setYearIdx(years.length - 1) }
    else if (yearIdx > years.length - 1) setYearIdx(years.length - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years])

  // レイヤー生成（selectedは含めない＝選択でレイヤーを作り直さない）
  useEffect(() => {
    if (!geoReady) return
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, yearIdx, prefectures, tab, muniMetric, region, geoReady, muniGeoTick, muniPref])

  // 選択ハイライトのみ更新（レイヤーは作り直さずsetStyle）＝クリックハンドラが保持され何度でも切替可
  useEffect(() => {
    if (!geoReady || tab !== 'pref' || !layerRef.current) return
    const year = years[yearIdx] ?? years[years.length - 1]
    const vals = valuesOf(metric, year)
    const arr = Object.values(vals)
    if (!arr.length) return
    const mn = Math.min(...arr)
    const mx = Math.max(...arr)
    layerRef.current.setStyle((f: any) => {
      const v = vals[f.properties.nam_ja]
      const t = mx > mn ? (v - mn) / (mx - mn) : 0.5
      const isSel = f.properties.nam_ja === selected
      return {
        fillColor: v == null ? '#aab4c4' : ramp(t),
        weight: isSel ? 3 : 1,
        color: isSel ? '#15233f' : '#ffffff',
        fillOpacity: selected && !isSel ? 0.45 : 0.78,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  function draw() {
    // 反対タブのレイヤーは常に先に掃除（early returnで残らないよう一元化）
    if (tab === 'muni') {
      if (layerRef.current) { layerRef.current.remove(); layerRef.current = null }
      addMask()   // 山口以外を白で隠す（マスクは市町レイヤーの下）
      drawMuni()
    } else {
      if (muniLayerRef.current) { muniLayerRef.current.remove(); muniLayerRef.current = null }
      if (maskLayerRef.current) { maskLayerRef.current.remove(); maskLayerRef.current = null }
      drawPref()
    }
  }

  // 選択県以外を白マスクで覆い、地図上で対象県のみを見せる（穴=対象県境）
  function addMask() {
    const L = LRef.current
    const map = mapRef.current
    const geo = geoRef.current
    // 古いmaskは無条件で先に掃除（県切替・未選択化の瞬間に残らないように）
    if (maskLayerRef.current) { maskLayerRef.current.remove(); maskLayerRef.current = null }
    if (!L || !map || !geo || !muniPref) return
    const target = geo.features.find((f: any) => f.properties?.nam_ja === muniPref)
    if (!target) return
    const polygons = target.geometry.type === 'MultiPolygon' ? target.geometry.coordinates : [target.geometry.coordinates]
    const holes = polygons.map((poly: number[][][]) => poly[0].map(([lng, lat]) => [lat, lng]))
    const outer = [[-85, -200], [-85, 200], [85, 200], [85, -200]]
    maskLayerRef.current = L.polygon([outer, ...holes], {
      stroke: false, fillColor: '#ffffff', fillOpacity: 0.92, interactive: false,
    }).addTo(map)
  }

  // 選択県の市町村コロプレス。geo・region・muniPrefが同一県のときだけ描く（旧県データでの誤描画防止）
  function drawMuni() {
    const L = LRef.current
    const map = mapRef.current
    const gw = muniGeoRef.current
    // geoの県・regionの県・現在のmuniPrefが揃わない過渡フレームは、市町レイヤーを消すだけで描かない
    if (!L || !map || !gw || gw.pref !== muniPref || !region || !region.length || region[0]?.pref !== muniPref) {
      if (muniLayerRef.current) { muniLayerRef.current.remove(); muniLayerRef.current = null }
      return
    }
    const geo = gw.geo
    const arr = Object.values(muniVals)
    if (!arr.length) return
    const mn = Math.min(...arr)
    const mx = Math.max(...arr)
    if (muniLayerRef.current) { muniLayerRef.current.remove(); muniLayerRef.current = null }
    muniLayerRef.current = L.geoJSON(geo, {
      style: (f: any) => {
        const v = muniVals[f.properties.city]
        const t = mx > mn ? (v - mn) / (mx - mn) : 0.5
        return { fillColor: v == null ? '#aab4c4' : ramp(t), weight: 1, color: '#ffffff', fillOpacity: 0.78 }
      },
      onEachFeature: (f: any, ly: any) => {
        const c = f.properties.city
        const v = muniVals[c]
        ly.bindTooltip(`<b>${esc(c)}</b><br>${esc(muniMetric)}: ${fmt(v)}`, { sticky: true })
      },
    }).addTo(map)
    // 県が変わった時だけズームを合わせる（同一県で指標変更時のズームリセットを防ぐ）
    if (fitPrefRef.current !== muniPref) {
      try { map.fitBounds(muniLayerRef.current.getBounds(), { padding: [20, 20] }); fitPrefRef.current = muniPref } catch { /* noop */ }
    }
  }

  function drawPref() {
    const L = LRef.current
    const map = mapRef.current
    const geo = geoRef.current
    if (!L || !map || !geo || !prefectures) return
    const m = mObj(metric)
    const year = years[yearIdx] ?? years[years.length - 1]
    const vals = valuesOf(metric, year)
    const arr = Object.values(vals)
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null }
    if (!arr.length) return // 全件欠損の指標ではNaN色を避けて描画しない
    const mn = Math.min(...arr)
    const mx = Math.max(...arr)
    // 全県を表示＆クリック可。選択県は太枠＋濃色でハイライト（他県も引き続き選択できる）
    layerRef.current = L.geoJSON(geo, {
      style: (f: any) => {
        const v = vals[f.properties.nam_ja]
        const t = mx > mn ? (v - mn) / (mx - mn) : 0.5
        const isSel = f.properties.nam_ja === selected
        return {
          fillColor: v == null ? '#aab4c4' : ramp(t),
          weight: isSel ? 3 : 1,
          color: isSel ? '#15233f' : '#ffffff',
          fillOpacity: selected && !isSel ? 0.45 : 0.78,
        }
      },
      onEachFeature: (f: any, ly: any) => {
        const name = f.properties.nam_ja
        const v = vals[name]
        ly.bindTooltip(`<b>${esc(name)}</b><br>${esc(m.label)}: ${fmt(v)} ${m.unit}`, { sticky: true })
        ly.on('click', () => setSelected(name))
      },
    }).addTo(map)
  }

  const scatter = useMemo(() => {
    if (!prefectures) return null
    const pts: { p: string; x: number; y: number; res?: number }[] = []
    prefectures.forEach((p) => {
      const x = p.metrics[driver]
      const y = p.costByYear['2023']
      if (typeof x === 'number' && typeof y === 'number') pts.push({ p: p.name, x, y })
    })
    if (!pts.length) return null
    const mx = pts.reduce((s, d) => s + d.x, 0) / pts.length
    const my = pts.reduce((s, d) => s + d.y, 0) / pts.length
    let sxx = 0, sxy = 0, syy = 0
    pts.forEach((d) => { sxx += (d.x - mx) ** 2; sxy += (d.x - mx) * (d.y - my); syy += (d.y - my) ** 2 })
    // 全点同値（sxx=0やsyy=0）ではNaNを避けてslope=0・r=0にフォールバック
    const slope = sxx ? sxy / sxx : 0
    const icpt = my - slope * mx
    const denom = Math.sqrt(sxx * syy)
    const r = denom ? sxy / denom : 0
    pts.forEach((d) => (d.res = d.y - (slope * d.x + icpt)))
    return { pts, slope, icpt, r }
  }, [prefectures, driver])

  if (!prefectures || !muniAll || !medList) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>データ読み込み中…（Convex）</div>
  }

  const year = years[yearIdx] ?? years[years.length - 1]
  const m = mObj(metric)
  const sel = selected ? factsByName[selected] : null

  // 凡例（現在表示中の指標のmin/max）
  const legendVals = tab === 'muni' ? Object.values(muniVals) : Object.values(valuesOf(metric, year))
  const legendData = legendVals.length
    ? { label: tab === 'muni' ? muniMetric : m.label, min: Math.min(...legendVals), max: Math.max(...legendVals), unit: tab === 'muni' ? '' : m.unit }
    : null

  return (
    <div style={{ fontFamily: 'sans-serif', color: '#1b2740', background: '#eaf1f8' }}>
      <header style={{ padding: '12px 20px', borderBottom: '1px solid #d6e0ee', background: '#fff' }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>都道府県 医療費・要因分析マップ</h1>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#5d6f8c' }}>出典: e-Stat（国民医療費・人口推計・医療施設・医師数・患者調査・特定健診・国保）/ 国土数値情報（市区町村界）</p>
      </header>
      <div style={{ display: 'flex', height: 'calc(100vh - 58px)' }}>
        <div style={{ width: '55%', height: '100%', position: 'relative' }}>
          <div ref={mapEl} style={{ width: '100%', height: '100%', background: '#9fbccd' }} />
          {geoError && (
            <div style={{ position: 'absolute', top: 10, left: 10, right: 10, zIndex: 600, background: 'rgba(255,255,255,0.95)', border: '1px solid #d63b2f', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#b02a20' }}>
              都道府県境界データの読み込みに失敗しました（地図の色分けを表示できません）。
              <button onClick={() => setGeoRetry((t) => t + 1)} style={{ marginLeft: 10, padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid #d63b2f', borderRadius: 6, background: '#fff', color: '#b02a20' }}>再試行</button>
            </div>
          )}
          {legendData && <Legend {...legendData} />}
        </div>
        <div style={{ width: '45%', padding: 16, overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: 12, color: '#5d6f8c' }}>都道府県を選択（地図クリックでも可）</label><br />
              <select
                value={selected ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  setSelected(v)
                  const map = mapRef.current
                  if (!v && map) map.setView([37.8, 137.5], 5)
                }}
                style={{ ...selStyle, minWidth: 180 }}
              >
                <option value="">全国（県を選択）</option>
                {prefList.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#5d6f8c' }}>地図の指標</label><br />
              <select value={metric} onChange={(e) => setMetric(e.target.value)} style={{ ...selStyle, maxWidth: 260 }}>
                {METRICS.map((mm) => (<option key={mm.k} value={mm.k}>{mm.label}</option>))}
              </select>
            </div>
          </div>
          {m.year && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#5d6f8c' }}>地図の年度: {year}</label><br />
              <input type="range" min={0} max={years.length - 1} value={yearIdx} onChange={(e) => setYearIdx(+e.target.value)} style={{ width: 220 }} />
            </div>
          )}

          <AiPanel
            prefectures={prefectures}
            municipalities={muniForAi}
            selected={selected}
            metricCatalog={AI_METRICS}
            muniGeoUrl={muniPref ? `/${MUNI_PREFS[muniPref]}.geojson` : null}
            medCost={medCostForAi}
          />

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, borderBottom: '2px solid #d6e0ee' }}>
            <button
              onClick={() => { setTab('pref'); const map = mapRef.current; if (map && !selected) map.setView([37.8, 137.5], 5) }}
              style={tabStyle(tab === 'pref')}
            >県プロファイル</button>
            <button
              onClick={() => { if (muniPref) setTab('muni') }}
              disabled={!muniPref}
              title={!muniPref ? '山口・島根・奈良いずれかを選択で有効' : ''}
              style={tabStyle(tab === 'muni', !muniPref)}
            >県内 市町村比較{!muniPref ? '（山口/島根/奈良）' : `（${selected}）`}</button>
          </div>

          {tab === 'muni' && (
            <>
              <Card title={`${selected} 市町村比較（地図は${selected}にズーム）`}>
                <label style={{ fontSize: 12, color: '#5d6f8c' }}>比較する指標</label><br />
                <select value={muniMetric} onChange={(e) => setMuniMetric(e.target.value)} style={selStyle}>
                  {muniMetricOptions.map((l) => (<option key={l} value={l}>{l}（{muniYear[l]}）</option>))}
                </select>
                <p style={{ fontSize: 11.5, color: '#5d6f8c', margin: '8px 0 0' }}>
                  地図の色＝各市町の「{muniMetric}」（<b>{muniYear[muniMetric]}</b>のデータ）。濃いほど高い。
                  出典: 国土数値情報（市区町村界）/ 社会人口統計体系・国保実態調査ほか（指標ごとに年次が異なる）
                </p>
              </Card>
              <Card title={`市町村比較グラフ（${muniMetric}・${muniYear[muniMetric]}）`}>
                <BarH rows={Object.entries(muniVals).map(([name, value]) => ({ name, value }))} />
              </Card>
              <Card title={`市町村ランキング（${muniMetric}・${muniYear[muniMetric]}・高い順）`}>
                <table style={tableStyle}><tbody>
                  {Object.entries(muniVals).sort((a, b) => b[1] - a[1]).map(([city, v], i) => (
                    <tr key={city}>
                      <td style={{ color: '#5d6f8c', width: 24 }}>{i + 1}</td>
                      <td>{city}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(v)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </Card>
            </>
          )}

          {tab === 'pref' && (
          <>
          <Card title={`都道府県比較グラフ（${m.label}${m.year ? `・${year}` : ''}）`}>
            <BarH
              rows={Object.entries(valuesOf(metric, year)).map(([name, value]) => ({ name, value }))}
              unit={m.unit}
              highlight={selected}
            />
          </Card>

          <Card title={sel ? `${selected} のプロファイル` : '県をクリックで詳細'}>
            {sel && (
              <table style={tableStyle}><tbody>
                {METRICS.map((mm) => (
                  <tr key={mm.k}>
                    <td>{mm.label}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(getVal(selected!, mm.k, year))} {mm.unit}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>

          <Card title="要因散布図（Y=一人当たり医療費 R5/2023 × X=要因）">
            <select value={driver} onChange={(e) => setDriver(e.target.value)} style={selStyle}>
              {METRICS.filter((mm) => mm.k !== 'per_capita_cost' && !mm.k.startsWith('mc_')).map((mm) => (<option key={mm.k} value={mm.k}>{mm.label}</option>))}
            </select>
            <p style={{ fontSize: 11, color: '#8a98ad', margin: '4px 0 0' }}>
              ※ Y軸=R5(2023)。X軸の年度は指標ラベル参照。<b>年度が異なる組合せ</b>（例: 高齢化率R6）は解釈に注意ニャ。
            </p>
            {scatter && (
              <>
                <p style={{ fontSize: 12, color: '#5d6f8c' }}>相関 r = <b>{scatter.r.toFixed(2)}</b>（R² {Math.round(scatter.r ** 2 * 100)}%）。赤=超過 / 緑=割安</p>
                <Scatter data={scatter} label={mObj(driver).label} />
              </>
            )}
          </Card>

          <Card title="全国市町村ランキング（R5・テーマ選択可）">
            <select value={natMuni} onChange={(e) => setNatMuni(e.target.value as NatKey)} style={selStyle}>
              {NAT_MUNI.map((n) => (<option key={n.k} value={n.k}>{n.label}</option>))}
            </select>
            <p style={{ fontSize: 11, color: '#5d6f8c', margin: '6px 0 4px' }}>
              {NAT_MUNI.find((n) => n.k === natMuni)?.unit} ・ 全{natRows.length}市町村中（健診/保健指導は結合できた市町村のみ）
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <RankTable title="高い順 TOP10" rows={natRows.slice(0, 10)} />
              <RankTable title="低い順 TOP10" rows={natRows.slice(-10).reverse()} />
            </div>
          </Card>
          </>
          )}
        </div>
      </div>
    </div>
  )
}

function tabStyle(active: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', borderBottom: active ? '3px solid #2f6fb0' : '3px solid transparent',
    background: 'transparent', color: disabled ? '#aab4c4' : active ? '#2f6fb0' : '#5d6f8c',
  }
}
