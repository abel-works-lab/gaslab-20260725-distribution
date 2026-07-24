'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { DEFAULT_PROMPTS, PROMPT_LABELS } from './prompts'
import { buildChoropleth, ramp, svgToPng, scatterSvg, legendSvg } from './mapSvg'
import { BarH, Radar } from './charts'

type Pref = { name: string; metrics: Record<string, number>; costByYear: Record<string, number> }
type Muni = { name: string; value: number }
type MetricDef = { k: string; label: string }

const MODES = ['insight', 'report', 'slides'] as const
const LS_KEY = 'estat_prompts_v2'

// .md ダウンロード
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// クリップボードにコピー
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const DRIVERS: { k: string; label: string }[] = [
  { k: 'aging_rate', label: '高齢化率' },
  { k: 'beds_per_100k', label: '病床数(10万対)' },
  { k: 'doctors_per_100k', label: '医師数(10万対)' },
  { k: 'admit_rate', label: '入院受療率' },
  { k: 'outpatient_rate', label: '外来受療率' },
  { k: 'checkup_rate', label: '特定健診実施率' },
  { k: 'dis_diabetes', label: '糖尿病外来' },
  { k: 'dis_htn', label: '高血圧外来' },
]

// IQR法の5段階判定（分析フレーム フェーズ3準拠）
function iqr(vals: number[]) {
  if (!vals.length) return { q1: 0, med: 0, q3: 0, iqr: 0 }
  const s = [...vals].sort((a, b) => a - b)
  const q = (p: number) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
  const q1 = q(0.25), med = q(0.5), q3 = q(0.75)
  return { q1, med, q3, iqr: q3 - q1 }
}
function judge(v: number, d: { q1: number; q3: number; iqr: number }): string {
  if (v > d.q3 + 1.5 * d.iqr) return '特に高い'
  if (v > d.q3) return '高い'
  if (v < d.q1 - 1.5 * d.iqr) return '特に低い'
  if (v < d.q1) return '低い'
  return '平均的'
}
function nfmt(x: number, d = 1) { return Number(x).toLocaleString('ja-JP', { maximumFractionDigits: d }) }
function pctDiff(v: number, base: number) { if (!base || !Number.isFinite(base)) return '—'; const p = (v / base - 1) * 100; return `${p >= 0 ? '+' : ''}${p.toFixed(0)}%` }

// e-Statの「全国」実数（47県平均でなく真の全国値）。decoded CSVの全国行/全国集計から抽出（R5基準）。
// ここに無い指標のみ natAvgMap 側で47県単純平均にフォールバックし、その場合は表記を「47県平均比」に切り替える（natLblOf）。
const NATIONAL: Record<string, number> = {
  per_capita_cost: 386.7, // 一人当たり国民医療費(千円,2023年度)
  aging_rate: 29.3, // 高齢化率(%,R6/2024)。人口推計_R6_都道府県別年齢別.csv 全国行（65歳以上計36,241,441人／総数123,801,750人）
  beds_per_100k: 1196.4, // 病床数(人口10万対,R5)
  admit_rate: 945, // 入院受療率(10万対,R5)。患者調査_R5_受療率_都道府県×傷病.csv 全国×入院（総数）×傷病総数
  outpatient_rate: 5850, // 外来受療率(10万対,R5)。同上 全国×外来（総数）×傷病総数
  checkup_rate: 38.2, // 特定健診実施率(%,R5・Σ受診/Σ対象)
  guidance_rate: 29.2, // 特定保健指導実施率(%,R5・Σ実施/Σ対象)
  doctors_per_100k: 209.4, // 病院常勤換算医師数(10万対,R5)。医師数_R5_病院常勤換算_都道府県別.csv 「全　国」×人口１０万対常勤換算医師数×令和5年
  smoke_rate: 16.1, // 喫煙者割合(%,R4)。国民生活基礎調査_R4_喫煙者割合_都道府県別.csv 全国×総数×総数（(毎日+時々)/総数×100・build_facts_01.pyと同じ算式）
  complaint_rate: 276.5, // 有訴者率(人口千対,R4)。国民生活基礎調査_R4_有訴者率_都道府県別.csv 全国×総数×総数
  visit_rate: 417.3, // 通院者率(人口千対,R4)。国民生活基礎調査_R4_通院者率_都道府県別.csv 全国×総数×総数
  death_rate: 13.0, // 死亡率・全死因(人口千対,R6/2024)。人口動態統計_R6_死因別死亡_都道府県.csv 全国×総数×2024年 男女計1,605,378人 ÷ 人口推計全国123,801,750人 ×1000
  npo_per10k: 4.03, // NPO認証数(人口万対,R5年度末)。内閣府ninsho_history.csv 全国×認証数(2024/3/31)49,942 ÷ 人口推計全国 ×10000
  // 疾患別 外来受療率(10万対,R5)。患者調査_R5_受療率_都道府県×傷病.csv 全国×外来（総数）×各傷病分類
  dis_cancer: 208, dis_diabetes: 165, dis_mental: 197, dis_htn: 488,
  dis_ihd: 42, dis_stroke: 60, dis_msk: 647, dis_renal: 112,
  // 疾患別 入院受療率(10万対,R5)。同上 全国×入院（総数）×各傷病分類
  dis_cancer_in: 96, dis_diabetes_in: 10, dis_mental_in: 171, dis_htn_in: 3,
  dis_ihd_in: 8, dis_stroke_in: 88, dis_msk_in: 59, dis_renal_in: 26,
}
// 全国比較の基準ラベル：真の全国値がある指標は「全国比」、無い指標は47県平均で代替のため「47県平均比」と明示する
const natLblOf = (k: string) => (typeof NATIONAL[k] === 'number' ? '全国比' : '47県平均比')
// 国保 一人当たり医療費の真の全国値（円,R5/2023）。医療費の地域差分析(iryohi_r05_kiso.xlsx)の全国計から抽出。
// ※後期高齢者の全国値は生データに無いため、後期は47都道府県平均を「全国(参考)」として用いる。
const KOKUHO_NAT = 408304

// 全国(都道府県)指標の年度（令和表記で統一）
const NYEAR: Record<string, string> = {
  per_capita_cost: '令和5年度', aging_rate: '令和6年', admit_rate: '令和5年', outpatient_rate: '令和5年',
  beds_per_100k: '令和5年', doctors_per_100k: '令和5年', checkup_rate: '令和5年度', guidance_rate: '令和5年度',
  smoke_rate: '令和4年', death_rate: '令和6年', npo_per10k: '令和5年度末',
  dis_renal_in: '令和5年', dis_diabetes_in: '令和5年', dis_stroke_in: '令和5年', dis_mental_in: '令和5年',
  dis_cancer_in: '令和5年', dis_msk_in: '令和5年', dis_htn_in: '令和5年', dis_ihd_in: '令和5年',
}

// 西暦(またはYYYY-YYYY)を令和/平成表記に変換（県内指標の年度表示用）
function wareki(y?: string | null): string {
  if (!y || y === '年度不明') return '年度不明'
  const toR = (yr: number) => yr >= 2019 ? `令和${yr - 2018}年` : yr >= 1989 ? `平成${yr - 1988}年` : `${yr}年`
  const m = String(y).match(/^(\d{4})(?:-(\d{4}))?$/)
  if (!m) return String(y)
  return m[2] ? `${toR(+m[1])}〜${toR(+m[2])}` : toR(+m[1])
}

// 参考資料セクション（市町村ごとの複合考察と提案）は目次・中扉・Markdownプレビューのどこでも
// 本編の番号カウントに含めず【参考】固定表示にする。出典・データソースも同様に【出典】固定
const REFERENCE_SECTION_TITLE = '市町村ごとの複合考察と提案'

// 中扉の英語キャプション（テンプレ準拠・セクション名で引く）
const SECTION_EN: Record<string, string> = {
  '全国の中での位置づけ': 'NATIONAL POSITION',
  'クロス分析（医療費と要因の相関）': 'CROSS ANALYSIS',
  '疾病構造と医療資源': 'DISEASE & RESOURCES',
  '予防と社会・生活要因': 'PREVENTION & FACTORS',
  '県内市町村の比較': 'MUNICIPALITIES',
  '市町村ごとの複合考察と提案': 'MUNICIPAL INSIGHTS',
  'まとめ／総括と提案': 'SUMMARY & ACTIONS',
  '出典・データソース': 'SOURCES & DATA',
}

// 各スライドの出典（資料名＋URL・ハイパーリンク用）。一次ソースのみ
const SRC: Record<string, { label: string; url: string }> = {
  kokumin: { label: '国民医療費（e-Stat）', url: 'https://www.e-stat.go.jp/stat-search/files?tstat=000001020931' },
  iryomap: { label: '医療費の地域差分析（厚生労働省）', url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/database/iryomap/index.html' },
  kanja: { label: '患者調査（e-Stat）', url: 'https://www.e-stat.go.jp/' },
  shisetsu: { label: '医療施設調査・医師統計（e-Stat）', url: 'https://www.e-stat.go.jp/' },
  kenshin: { label: '特定健診・特定保健指導（e-Stat）', url: 'https://www.e-stat.go.jp/' },
  jinko: { label: '人口推計・国民生活基礎・人口動態（e-Stat）', url: 'https://www.e-stat.go.jp/' },
  ssds: { label: '社会・人口統計体系（e-Stat 地域統計）', url: 'https://www.e-stat.go.jp/regional-statistics/ssdsview' },
  est: { label: '政府統計（e-Stat）', url: 'https://www.e-stat.go.jp/' },
}

// 巻末の出典（資料名＋URL）。一次ソースのみ・URLは実在確認済み（2026-06検索で裏取り）
const SOURCES: [string, string][] = [
  ['国民医療費（厚生労働省 / e-Stat）', 'https://www.e-stat.go.jp/stat-search/files?tstat=000001020931'],
  ['医療費の地域差分析（厚生労働省 保険局調査課）', 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryouhoken/database/iryomap/index.html'],
  ['人口推計／医療施設調査／医師・歯科医師・薬剤師統計／患者調査／特定健診・特定保健指導／国民生活基礎調査／人口動態統計（政府統計 e-Stat）', 'https://www.e-stat.go.jp/'],
  ['社会・人口統計体系（地域要因・市区町村 / e-Stat 地域統計）', 'https://www.e-stat.go.jp/regional-statistics/ssdsview'],
  ['市区町村界 geojson（国土数値情報 N03 / niiyz JapanCityGeoJson・MIT）', 'https://github.com/niiyz/JapanCityGeoJson'],
]

// 相関係数。計算不能（n<3・分散0）は「r=0（相関なし）」と偽らず null を返し、呼び出し側で除外する
function corr(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2
    sxy += (xs[i] - mx) * (ys[i] - my)
    syy += (ys[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

// ごく軽量な Markdown -> HTML（見出し/箇条書き/太字/段落のみ）
function mdToHtml(md: string) {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false } }
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  for (const ln of lines) {
    const t = ln.trim()
    if (/^###\s/.test(t)) { closeUl(); out.push(`<h4>${inline(t.replace(/^###\s/, ''))}</h4>`) }
    else if (/^##\s/.test(t)) { closeUl(); out.push(`<h3>${inline(t.replace(/^##\s/, ''))}</h3>`) }
    else if (/^#\s/.test(t)) { closeUl(); out.push(`<h2>${inline(t.replace(/^#\s/, ''))}</h2>`) }
    else if (/^[-*]\s/.test(t)) { if (!inUl) { out.push('<ul>'); inUl = true } out.push(`<li>${inline(t.replace(/^[-*]\s/, ''))}</li>`) }
    else if (t === '') { closeUl() }
    else { closeUl(); out.push(`<p>${inline(t)}</p>`) }
  }
  closeUl()
  return out.join('\n')
}

// reveal.jsプレビューのHTMLを組む（モーダル内のiframe srcDocに使う＝ポップアップブロック回避）
function buildSlidesHtml(slidesMd: string): string {
  // textareaを抜けて任意HTMLを注入されないよう、閉じタグを文字参照化
  const safe = slidesMd.replace(/<\/(textarea)/gi, '&lt;/$1')
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>医療費分析スライド</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/white.css">
<style>html,body{margin:0;height:100%}.reveal h1{font-size:1.9em}.reveal h2{font-size:1.4em}.reveal{font-family:'Segoe UI',sans-serif}</style>
</head><body>
<div class="reveal"><div class="slides">
<section data-markdown data-separator="^---$"><textarea data-template>
${safe}
</textarea></section>
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/markdown/markdown.js"></script>
<script>Reveal.initialize({hash:false,embedded:true,plugins:[RevealMarkdown]});</script>
</body></html>`
}

// インサイト末尾の ```json {"focus_metrics":[...]} ``` を抜き取り、本文から除去する
function extractFocus(text: string): { keys: string[]; clean: string } {
  // 本文中に説明用の```jsonブロックがあっても誤爆しないよう「最後の```json」だけを対象にする
  const start = text.lastIndexOf('```json')
  if (start >= 0) {
    const m = text.slice(start).match(/^```json\s*([\s\S]*?)```\s*$/)
    if (m) {
      try {
        const j = JSON.parse(m[1])
        if (Array.isArray(j.focus_metrics)) return { keys: j.focus_metrics.map(String), clean: text.slice(0, start).trim() }
      } catch { /* fallthrough */ }
    }
  }
  // 行頭から始まる末尾JSONのみ対象（本文中の "focus_metrics" 言及を誤って削らない）
  const m2 = text.match(/(?:^|\n)(\{[^{}]*"focus_metrics"[\s\S]*?\})\s*$/)
  if (m2 && m2.index != null) {
    try {
      const j = JSON.parse(m2[1])
      if (Array.isArray(j.focus_metrics)) return { keys: j.focus_metrics.map(String), clean: text.slice(0, m2.index).trim() }
    } catch { /* ignore */ }
  }
  return { keys: [], clean: text }
}

// スライド1枚 = 見出し＋左の文章(データキャプション＋AI一言)＋右の可視化。文章と可視化を必ずセットにする
type PVisual =
  | { kind: 'image'; svg: string; w: number; h: number; big?: boolean; legend?: { label: string; unit: string; min: number; max: number } }
  | { kind: 'radar'; labels: string[]; values: number[]; base?: string; self?: string }
  | { kind: 'bar'; labels: string[]; values: number[]; title?: string; unit?: string; chrono?: boolean; full?: boolean }
  | { kind: 'table'; head: string[]; rows: string[][]; colW: number[]; fs?: number; colAlign?: ('left' | 'center' | 'right')[] }
type PSrc = { label: string; url: string }
// lead=このスライドの説明、bullets=結果、note=そこから言える示唆、source=出典(ハイパーリンク)
type PSlide = { heading: string; lead: string; bullets: string[]; note?: string; visual: PVisual | null; source?: PSrc }
type PSection = { title: string; slides: PSlide[] }
type PDeck = { title: string; subtitle: string; summary: string[]; sections: PSection[] }

// AETHERLINKブランド（ウェビナーデモ用ダミーブランド）に準拠したPPTX生成
const DH = { NAVY: '388052', SKY: '8AC8A1', INK: '1A1A1A', GRAY: '666666', FONT: 'Noto Sans JP', LOGO: '/aetherlink-logo.png' }

async function downloadPptx(d: PDeck) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  const { NAVY, SKY, INK, GRAY, FONT, LOGO } = DH

  // ロゴは事前にfetch→base64化して data で渡す。path渡しだと取得失敗が writeFile 時の reject になり
  // PPTX全体が生成失敗するため（addImage時のtry/catchでは捕まらない）。失敗時はロゴなしで続行
  let logoData: string | null = null
  try {
    const res = await fetch(LOGO)
    if (res.ok) {
      const blob = await res.blob()
      logoData = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(fr.error)
        fr.readAsDataURL(blob)
      })
    }
  } catch { logoData = null }
  // AETHERLINKロゴ、視認性向上のため拡大（ユーザー指定: 高さ3.36cm×幅6.18cm≒h1.32in×w2.43in）
  // 右端位置(旧x+w=12.74)は維持し、拡大分は左側に広げる
  const addLogo = (s: any) => { if (logoData) s.addImage({ data: logoData.replace(/^data:/, ''), x: 10.31, y: 0, w: 2.43, h: 1.32 }) }
  const header = (heading: string) => {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    addLogo(s)
    s.addText(heading, { x: 0.6, y: 0.42, w: 11.2, h: 0.85, fontSize: 23, bold: true, color: INK, fontFace: FONT, valign: 'top' })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 1.18, w: 13.33, h: 0.035, fill: { color: NAVY } })
    return s
  }

  // 表紙（ロゴは中央右・大きめに配置）
  const t = pptx.addSlide()
  t.background = { color: 'FFFFFF' }
  // 同じくアスペクト比1.83:1で再計算。右端位置(旧x+w=11.35)を維持
  if (logoData) t.addImage({ data: logoData.replace(/^data:/, ''), x: 8.23, y: 2.55, w: 3.12, h: 1.7 })
  t.addText('DATA HEALTH PLAN', { x: 0.85, y: 2.5, w: 10, h: 0.5, fontSize: 16, bold: true, charSpacing: 4, color: SKY, fontFace: FONT })
  t.addText(d.title, { x: 0.8, y: 3.1, w: 11.6, h: 1.5, fontSize: 38, bold: true, color: NAVY, fontFace: FONT, valign: 'top' })
  if (d.subtitle) t.addText(d.subtitle, { x: 0.85, y: 4.7, w: 11, h: 0.9, fontSize: 18, color: GRAY, fontFace: FONT, valign: 'top' })

  // 目次
  const toc = pptx.addSlide()
  toc.background = { color: 'FFFFFF' }
  addLogo(toc)
  toc.addText('目次', { x: 0.6, y: 0.45, w: 11, h: 0.9, fontSize: 28, bold: true, color: NAVY, fontFace: FONT, valign: 'top' })
  toc.addShape(pptx.ShapeType.rect, { x: 0, y: 1.35, w: 13.33, h: 0.035, fill: { color: NAVY } })
  let ty = 1.95
  // セクションが多い時は行間を詰め、最終行（出典）がスライド下端(7.5)を超えないようにする
  const tyStep = Math.min(0.72, (7.3 - 0.6 - 1.95) / Math.max(1, d.sections.length))
  d.sections.forEach((sec, i) => {
    // 参考資料セクションは中扉と同じく番号カウントから除外し【参考】表示にする（目次と中扉の番号食い違い対策）
    const isRef = sec.title === REFERENCE_SECTION_TITLE
    // wrap:falseで折り返しを防ぐ（【参考】は固定幅0.7inだと折り返すため。数字は1桁前提でそのまま）
    toc.addText(isRef ? '【参考】' : `${i + 1}`, { x: 0.9, y: ty, w: 0.7, h: 0.6, fontSize: isRef ? 15 : 22, bold: true, color: SKY, fontFace: FONT, wrap: false })
    toc.addText(sec.title, { x: 1.7, y: ty + 0.05, w: 10.6, h: 0.6, fontSize: 18, color: INK, fontFace: FONT, valign: 'top' })
    ty += tyStep
  })
  // 出典・データソースは本編の番号カウントに含めず【出典】固定表示にする（参考資料と同じ扱い）
  toc.addText('【出典】', { x: 0.9, y: ty, w: 0.7, h: 0.6, fontSize: 15, bold: true, color: SKY, fontFace: FONT, wrap: false })
  toc.addText('出典・データソース', { x: 1.7, y: ty + 0.05, w: 10.6, h: 0.6, fontSize: 18, color: INK, fontFace: FONT, valign: 'top' })

  // エグゼクティブサマリー（目次の次・資料全体の要点）
  if (d.summary.length) {
    const sm = header('エグゼクティブサマリー')
    let smy = 1.55
    d.summary.forEach((b) => {
      const lines = Math.max(1, Math.ceil(b.length / 56))
      const bh = lines * 0.3 + 0.1
      sm.addShape(pptx.ShapeType.rect, { x: 0.6, y: smy + 0.07, w: 0.18, h: 0.18, fill: { color: NAVY } })
      sm.addText(b, { x: 0.95, y: smy, w: 11.9, h: bh + 0.15, fontSize: 15, color: INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.12 })
      smy += bh + 0.18
    })
  }

  // 本文1枚の描画：見出し＋リード文＋特徴3点（左）＋可視化（右・大きめ）
  const renderContent = async (sl: PSlide) => {
    const s = header(sl.heading)
    const linesOf = (txt: string, w: number) => Math.max(1, Math.ceil(txt.length / Math.max(8, Math.floor(w * 5.2))))
    // 出典（ハイパーリンク）をスライド左下に描く
    const drawSource = () => {
      if (!sl.source) return
      s.addText([{ text: '出典: ', options: { color: GRAY } }, { text: sl.source.label, options: { color: '2F6FB0', underline: { style: 'sng', color: '2F6FB0' }, hyperlink: { url: sl.source.url } } }],
        { x: 0.5, y: 7.18, w: 10.0, h: 0.28, fontSize: 8.5, color: GRAY, fontFace: FONT, valign: 'top' })
    }
    // 表は全幅レイアウト（説明文＋表）
    if (sl.visual?.kind === 'table') {
      const v = sl.visual
      let y = 1.45
      if (sl.lead) { const lh = linesOf(sl.lead, 12.0) * 0.27 + 0.1; s.addText(sl.lead, { x: 0.6, y, w: 12.1, h: lh + 0.3, fontSize: 13, color: INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.12 }); y += lh + 0.3 }
      // 行数が多い表（市町村一覧等）は行高・文字を縮めて1枚に収める。上限0.58は
      // min()によりavail(残り高さ)を超えないので、行数が多い表では自動的に縮む
      const avail = 7.05 - y
      const rh = Math.max(0.16, Math.min(0.58, avail / (v.rows.length + 1)))
      const fs = v.fs ?? (v.rows.length > 22 ? 9 : v.rows.length > 14 ? 10 : 12)
      const headerRow = v.head.map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, align: 'center' as const, fontFace: FONT } }))
      const dataRows = v.rows.map((r) => r.map((c, ci) => ({ text: c, options: { align: (v.colAlign?.[ci] ?? (ci === 0 ? 'center' : 'left')) as 'left' | 'center' | 'right', fontFace: FONT, color: INK } })))
      s.addTable([headerRow, ...dataRows], { x: 0.6, y, w: 12.1, colW: v.colW, fontSize: fs, border: { type: 'solid', color: 'D6E0EE', pt: 1 }, rowH: rh, valign: 'middle' })
      drawSource()
      return
    }
    const v = sl.visual
    const hasViz = !!v
    const big = v?.kind === 'image' && !!v.big
    const textW = !hasViz ? 12.0 : (big ? 3.8 : 4.7)
    // 下端の上限：出典(y=7.18)や スライド外(7.5)にテキストが達しないよう、全体高さを事前計測する。
    // leadF=説明文の倍率／bodyF=箇条書き・示唆の倍率。画像付き(hasViz)スライドは説明文を常に等倍で保ち、
    // 溢れる分は箇条書き側だけ縮小する（2026-07-18: 説明文まで縮むのはおかしいという指摘で分離）。
    // visual:nullのフルwidthテキストスライドは画像が無く余白が大きく余りがちなので、収まる範囲で
    // 説明文・箇条書きとも同じ倍率で拡大して埋める（最大1.3倍）
    const yMax = sl.source ? 7.05 : 7.35
    const lofF = (txt: string, w: number, f: number) => Math.max(1, Math.ceil(txt.length / Math.max(8, Math.floor((w * 5.2) / f))))
    const leadHOf = (lf: number) => (sl.lead ? lofF(sl.lead, textW, lf) * 0.235 * lf + 0.08 * lf + 0.16 : 0)
    const bodyHOf = (bf: number) => {
      let yy = 0
      for (const b of sl.bullets) yy += lofF(b, textW - 0.33, bf) * 0.225 * bf + 0.1 * bf + 0.12
      if (sl.note) yy += 0.04 + lofF(sl.note, textW, bf) * 0.225 * bf + 0.08 * bf
      return yy
    }
    let leadF = 1
    let bodyF = 1
    if (!hasViz) {
      while (1.45 + leadHOf(leadF + 0.05) + bodyHOf(bodyF + 0.05) <= yMax && leadF < 1.3) { leadF = +(leadF + 0.05).toFixed(2); bodyF = leadF }
    }
    while (1.45 + leadHOf(leadF) + bodyHOf(bodyF) > yMax && bodyF > 0.72) bodyF = +(bodyF - 0.04).toFixed(2)
    let y = 1.45
    // ① 説明文（このスライドが何を示すか）。省略せず全文表示
    if (sl.lead) {
      const lh = lofF(sl.lead, textW, leadF) * 0.235 * leadF + 0.08 * leadF
      s.addText(sl.lead, { x: 0.5, y, w: textW, h: lh + 0.3, fontSize: 11 * leadF, color: GRAY, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.12 })
      y += lh + 0.16
    }
    // ② 結果（箇条書き・省略しない）。■は1行目の高さに合わせて少し下げる
    for (const raw of sl.bullets) {
      const bh = lofF(raw, textW - 0.33, bodyF) * 0.225 * bodyF + 0.1 * bodyF
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: y + 0.08, w: 0.14, h: 0.14, fill: { color: NAVY } })
      s.addText(raw, { x: 0.8, y, w: textW - 0.3, h: bh + 0.2, fontSize: 11.5 * bodyF, bold: true, color: INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.08 })
      y += bh + 0.12
    }
    // ③ 示唆（箇条書きの後・何が言えるか・省略しない）
    if (sl.note) {
      const nh = lofF(sl.note, textW, bodyF) * 0.225 * bodyF + 0.08 * bodyF
      s.addText([{ text: '→ 示唆: ', options: { bold: true, color: SKY } }, { text: sl.note, options: { color: INK } }],
        { x: 0.5, y: y + 0.04, w: textW, h: nh + 0.25, fontSize: 11 * bodyF, italic: true, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.1 })
    }
    drawSource()
    if (v?.kind === 'image') {
      try {
        const png = await svgToPng(v.svg, v.w, v.h, 2)
        const box = big ? { x: 4.35, y: 1.22, w: 9.0, h: 6.3 } : { x: 5.65, y: 1.5, w: 7.2, h: 5.3 }
        const ratio = v.w / v.h
        let w = box.w, h = box.w / ratio
        if (h > box.h) { h = box.h; w = box.h * ratio }
        const imgX = box.x + (box.w - w) / 2, imgY = box.y + (box.h - h) / 2
        s.addImage({ data: png.replace(/^data:/, ''), x: imgX, y: imgY, w, h })
        // 凡例は別画像で地図の左・東北付近の高さに重ねる。0.30 は実際にPPTXを書き出してPDF化し、
        // ピクセル単位で計測して出した値（2026-07-18・soffice+PyMuPDFで実測）。
        // 陸地の左端はy=2.0〜3.8in(fraction 0.12〜0.41)ではx=1100超で凡例位置(x≈710-950)と衝突しないが、
        // y=4.0in(fraction 0.44=旧値)で中国地方が左端x=710まで張り出し衝突する。東北の濃色域は
        // y=3.17〜4.32inで確認済みのため、両者が重なる0.30を採用（陸地衝突ゾーンの手前で東北の高さ）
        if (v.legend) {
          try {
            const lp = await svgToPng(legendSvg(v.legend.label, v.legend.unit, v.legend.min, v.legend.max), 244, 66, 2)
            s.addImage({ data: lp.replace(/^data:/, ''), x: imgX + 0.05, y: imgY + h * 0.30, w: 2.4, h: 0.65 })
          } catch (e) { console.warn('legend png failed', e) }
        }
      } catch (e) { console.warn('map png failed', e) /* 画像化失敗時は文章のみ */ }
    } else if (v?.kind === 'radar') {
      s.addChart(
        pptx.ChartType.radar,
        [{ name: v.self ?? '当県', labels: v.labels, values: v.values }, { name: v.base ?? '全国(=1.0)', labels: v.labels, values: v.labels.map(() => 1) }],
        // h=5.6：下端7.05に抑え、出典テキスト(y=7.18)と重ねない
        { x: 5.4, y: 1.45, w: 7.6, h: 5.6, radarStyle: 'standard', chartColors: [SKY, GRAY], showLegend: true, legendPos: 'b', legendFontFace: FONT, catAxisLabelFontSize: 9, catAxisLabelFontFace: FONT },
      )
    } else if (v?.kind === 'bar') {
      // 横棒は下から積まれるため最大が上に来るよう反転（降順表示）。時系列(chrono)は古い順を保つため反転しない。
      // full(縦棒・1枚1グラフ)は左から右に自然順で並ぶため反転不要
      const blab = v.full ? v.labels : v.chrono ? v.labels : [...v.labels].reverse()
      const bval = v.full ? v.values : v.chrono ? v.values : [...v.values].reverse()
      // unit(円・%・相関係数)で軸・データラベルの小数点表示を切り替える（円は桁区切り整数、
      // %は小数点1桁、相関係数は小数点2桁。一律'#,##0'だと相関係数が整数に丸められてしまうため分離）
      const fmtCode = v.unit === '円' ? '#,##0' : v.unit?.includes('相関係数') ? '0.00' : v.unit?.includes('%') ? '0.0' : '#,##0'
      s.addChart(
        pptx.ChartType.bar,
        [{ name: v.title ?? sl.heading, labels: blab, values: bval }],
        {
          // full: 市町村数が多い(>20)場合に1枚1グラフで全幅・縦棒表示（項目名が多いため回転させて詰め込む）
          // h=5.6：下端7.05に抑え、出典テキスト(y=7.18)と重ねない
          x: v.full ? 0.5 : 5.4, y: 1.45, w: v.full ? 12.3 : 7.6, h: 5.6, barDir: v.full ? 'col' : 'bar', chartColors: [NAVY],
          showLegend: false, showTitle: !!v.title, title: v.title, titleFontSize: 12, titleFontFace: FONT, titleColor: INK,
          showValAxisTitle: !!v.unit, valAxisTitle: v.unit, valAxisTitleFontSize: 10, valAxisTitleFontFace: FONT,
          catAxisLabelFontSize: v.full ? 7 : 8, valAxisLabelFontSize: 8, catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
          catAxisLabelRotate: v.full ? 45 : undefined,
          valAxisLabelFormatCode: fmtCode,
          // full時は棒が細く数値ラベルが重なって潰れるため非表示（軸の目盛りのみで代替）
          showValue: !v.full, dataLabelFormatCode: fmtCode, dataLabelPosition: 'outEnd', dataLabelFontSize: 8, dataLabelFontFace: FONT, dataLabelColor: INK,
        },
      )
    }
  }

  // 中扉（テンプレ準拠：白背景・大きい紺の番号＋英語キャプション・右に黒タイトル・下線）。ロゴは付けない
  const drawDivider = (title: string, numLabel: string, numFontSize = 96) => {
    const dv = pptx.addSlide()
    dv.background = { color: 'FFFFFF' }
    // wrap:falseで折り返しを防ぐ（【参考】【出典】は4文字あり、96/40ptだと固定幅2.5inでは折り返すため）
    dv.addText(numLabel, { x: 0.85, y: 2.5, w: 2.5, h: 1.7, fontSize: numFontSize, bold: true, color: NAVY, fontFace: FONT, align: 'left', wrap: false })
    const en = SECTION_EN[title] ?? ''
    if (en) dv.addText(en, { x: 0.95, y: 4.2, w: 3.2, h: 0.4, fontSize: 13, bold: true, charSpacing: 3, color: SKY, fontFace: FONT })
    dv.addText(title, { x: 3.6, y: 3.0, w: 9.2, h: 1.0, fontSize: 34, bold: true, color: INK, fontFace: FONT, valign: 'top' })
    dv.addShape(pptx.ShapeType.rect, { x: 3.65, y: 3.82, w: 2.8, h: 0.045, fill: { color: SKY } })
  }
  for (let i = 0; i < d.sections.length; i++) {
    const sec = d.sections[i]
    const isRef = sec.title === REFERENCE_SECTION_TITLE
    // 参考資料セクションは番号ではなく【参考】。4文字入るよう数字より小さいフォントにする
    drawDivider(sec.title, isRef ? '【参考】' : String(i + 1).padStart(2, '0'), isRef ? 40 : 96)
    for (const sl of sec.slides) await renderContent(sl)
  }

  // 出典・データソースにも中扉を入れる。参考資料と同様に本編の番号カウントには含めず【出典】固定表示にする
  drawDivider('出典・データソース', '【出典】', 40)

  // 巻末：出典・データソース（資料名＋URL）。資料名の行数に応じてURLを下にずらし重なりを防ぐ
  const sc = header('出典・データソース')
  let sy = 1.55
  SOURCES.forEach(([name, url]) => {
    const nameH = Math.max(1, Math.ceil(name.length / 60)) * 0.28 + 0.04 // ~60文字/行(幅12in)
    sc.addShape(pptx.ShapeType.rect, { x: 0.6, y: sy + 0.04, w: 0.15, h: 0.15, fill: { color: NAVY } })
    sc.addText(name, { x: 0.9, y: sy, w: 12.0, h: nameH + 0.15, fontSize: 13, bold: true, color: INK, fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.1 })
    sc.addText(url, { x: 0.9, y: sy + nameH, w: 12.0, h: 0.32, fontSize: 11, color: '2F6FB0', fontFace: FONT, valign: 'top', hyperlink: { url } })
    sy += nameH + 0.5
  })
  sc.addText('※ いずれも政府統計(e-Stat)等の一次ソース。各指標の年度は本文スライドに明記。', { x: 0.6, y: sy + 0.05, w: 12.0, h: 0.4, fontSize: 11, italic: true, color: GRAY, fontFace: FONT })

  await pptx.writeFile({ fileName: 'data-health-plan.pptx' })
}

export default function AiPanel({
  prefectures,
  municipalities,
  selected,
  metricCatalog,
  muniGeoUrl,
  medCost,
}: {
  prefectures: Pref[]
  municipalities: Muni[]
  selected: string | null
  metricCatalog: MetricDef[]
  muniGeoUrl: string | null
  medCost: { name: string; kokuho: number; kouki: number }[]
}) {
  const [insight, setInsight] = useState('')
  const [focusKeys, setFocusKeys] = useState<string[]>([])
  const [japanGeo, setJapanGeo] = useState<any>(null)
  const [cityGeo, setCityGeo] = useState<any>(null) // 選択県の市区町村geojson（県内地図用）
  const [report, setReport] = useState('')
  const [slidesMd, setSlidesMd] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  // reveal.jsプレビューを画面内モーダルで開く（window.openを使わずポップアップブロック回避）
  function openSlides(md: string) {
    setPreviewHtml(buildSlidesHtml(md))
  }

  // Convex永続保存
  const savedList = useQuery(api.outputs.list)
  const saveOutput = useMutation(api.outputs.save)
  const removeOutput = useMutation(api.outputs.remove)

  // 選択県の市町村要因（データがある県＝山口県のみ19件、他県は空）。未選択時はクエリしない
  const regionData = useQuery(
    api.seedRegion.listByPref,
    selected ? { pref: selected } : 'skip',
  ) as { pref: string; city: string; metrics: { item: string; label: string; value: number; year?: string | null }[] }[] | undefined

  // ユーザー編集可能なプロンプト（初期=デフォルト、localStorageに保存して再読込でも保持）
  const [prompts, setPrompts] = useState<Record<string, string>>({ ...DEFAULT_PROMPTS })
  const [showPrompts, setShowPrompts] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) setPrompts({ ...DEFAULT_PROMPTS, ...JSON.parse(saved) })
    } catch { /* ignore */ }
  }, [])

  function updatePrompt(mode: string, value: string) {
    setPrompts((prev) => {
      const next = { ...prev, [mode]: value }
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  function resetPrompt(mode: string) {
    updatePrompt(mode, DEFAULT_PROMPTS[mode])
  }

  // 日本地図geojsonを取得（全国地図用・一度だけ）。SVG自前描画でスライド画像化する
  useEffect(() => {
    fetch('/japan_prefectures.geojson').then((r) => r.json()).then(setJapanGeo).catch(() => {})
  }, [])
  // 選択県の市区町村geojsonを取得（県が変わるたび）。取得元URLを付帯し旧県geoでの誤描画を防ぐ
  useEffect(() => {
    let canceled = false
    if (!muniGeoUrl) { setCityGeo(null); return () => { canceled = true } }
    fetch(muniGeoUrl).then((r) => r.json()).then((g) => { if (!canceled) setCityGeo({ url: muniGeoUrl, geo: g }) }).catch(() => {})
    return () => { canceled = true }
  }, [muniGeoUrl])

  // 県を切り替えたら旧県の生成物（インサイト・レポート・スライドmd・AI選抜軸）をクリアする。
  // 残すと「県Bのデータ×県Aのインサイト」で混在レポートが生成され、レーダーも旧県向けの軸で描かれるため。
  // 通知を出し、Convex保存分は「保存済み」から再度開けることを伝える
  const prevSelected = useRef(selected)
  useEffect(() => {
    if (prevSelected.current === selected) return
    prevSelected.current = selected
    if (insight || report || slidesMd || focusKeys.length) {
      setInsight(''); setFocusKeys([]); setReport(''); setSlidesMd('')
      flash('県が変わったため前の県のインサイト・レポート表示をクリアしたニャ（Convex保存済みは残ってるニャ）')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const getM = (p: Pref, k: string) => (k === 'per_capita_cost' ? p.costByYear['2023'] : p.metrics[k])
  const labelOf = (k: string) => metricCatalog.find((m) => m.k === k)?.label ?? k

  // 各指標の「全国」基準値。e-Statの全国行/全国集計があればそれを使い（NATIONAL）、無い指標のみ47県平均で代替
  const natAvgMap = useMemo(() => {
    const o: Record<string, number> = {}
    metricCatalog.forEach((mm) => {
      if (typeof NATIONAL[mm.k] === 'number') { o[mm.k] = NATIONAL[mm.k]; return }
      const vs = prefectures.map((p) => getM(p, mm.k)).filter((v): v is number => typeof v === 'number')
      if (vs.length) o[mm.k] = vs.reduce((a, b) => a + b, 0) / vs.length
    })
    return o
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefectures, metricCatalog])

  // レーダー軸：AI選抜focus_metrics（無ければ全国平均からの乖離が大きい順に自動選抜）
  const radarAxes = useMemo(() => {
    const sel = selected ? prefectures.find((p) => p.name === selected) : null
    if (!sel) return [] as { k: string; label: string; ratio: number }[]
    // 国民医療費(per_capita_cost)は分析対象外（国保・後期で分析）のためレーダー軸から除外
    const keys = focusKeys.filter((k) => k !== 'per_capita_cost' && metricCatalog.some((m) => m.k === k) && natAvgMap[k] > 0)
    if (keys.length < 3) {
      const auto = metricCatalog
        .filter((m) => m.k !== 'per_capita_cost' && natAvgMap[m.k] > 0 && typeof getM(sel, m.k) === 'number')
        .map((m) => ({ k: m.k, dev: Math.abs((getM(sel, m.k) as number) / natAvgMap[m.k] - 1) }))
        .sort((a, b) => b.dev - a.dev)
        .map((d) => d.k)
      for (const k of auto) { if (!keys.includes(k)) keys.push(k); if (keys.length >= 5) break }
    }
    return keys.slice(0, 6)
      .filter((k) => typeof getM(sel, k) === 'number' && natAvgMap[k] > 0) // 値・正の平均の存在を保証（負平均で符号反転/NaN軸を防ぐ）
      .map((k) => ({ k, label: labelOf(k), ratio: +((getM(sel, k) as number) / natAvgMap[k]).toFixed(2) }))
      .filter((a) => Number.isFinite(a.ratio))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, prefectures, focusKeys, natAvgMap, metricCatalog])

  // スライド一式（PDeck・セクション構造）を組む。各本文=見出し＋リード文＋特徴3点＋大きい可視化。
  // 全国比較／疾病・医療資源／予防・社会要因／県内市町村 を複合的に扱う。
  // pairedDeckRef: 一括生成(genAll)の途中でstate更新を待たずに最新のdeckを読むためのref。
  // 一括生成中は setFocusKeys → 再計算 → doPptx() と続くが、doPptx自身は
  // クリック時点のクロージャで固定されるためstateだけだと古いdeckを使ってしまう。
  const pairedDeckRef = useRef<PDeck | null>(null)
  // genAll実行中に selected が変わったか検知するためのref（同じくクロージャのstale値対策）。
  // genInsight/genReportの待機中に別の県をクリックされると、途中まで旧県・以降が新県の
  // 混在成果物が生成されてしまうため、genAll側で毎ステップ後にこのrefと比較して中断する
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const pairedDeck = useMemo<PDeck | null>(() => {
    const sel = selected ? prefectures.find((p) => p.name === selected) : null
    if (!sel) return null
    const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    const OKINAWA_INSET = { clip: [122, 24, 132, 28.5] as [number, number, number, number], box: [368, 452, 142, 132] as [number, number, number, number], label: '沖縄' }
    // band=true: 凡例を焼き込まない地図（全国地図）でも下部66pxを空け、後から重ねる凡例画像が九州南部に被らないようにする
    const choro = (geo: any, key: string, vals: Record<string, number>, w: number, h: number, pad = 6, legend?: { label: string; unit: string }, clip?: [number, number, number, number], inset?: typeof OKINAWA_INSET, band = false) => {
      const arr = Object.values(vals); const mn = Math.min(...arr), mx = Math.max(...arr)
      const hasLeg = !!legend && Number.isFinite(mn) && Number.isFinite(mx)
      // 凡例がある時（またはband指定時）は下部66pxをバンドとして確保（地図と凡例が被らないように）
      let svg = buildChoropleth(geo, key, (name) => {
        const v = vals[name]; const t = mx > mn ? (v - mn) / (mx - mn) : 0.5
        const isSel = key === 'nam_ja' && !!selected && name === selected
        return { fill: v == null ? '#dfe6f0' : ramp(t), stroke: isSel ? '#388052' : '#ffffff', strokeWidth: isSel ? 2.6 : key === 'city' ? 0.6 : 0.5 }
      }, w, h, pad, hasLeg || band ? 66 : pad, clip, inset)
      if (hasLeg) {
        const lw = 170, lx = w - lw - 14 // 右下に配置
        const lg = `<defs><linearGradient id="lgleg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(255,255,204)"/><stop offset="0.5" stop-color="rgb(253,141,60)"/><stop offset="1" stop-color="rgb(189,0,38)"/></linearGradient></defs>`
          + `<text x="${lx}" y="${h - 50}" font-size="13" fill="#333">${esc(legend!.label)}</text>`
          + `<rect x="${lx}" y="${h - 40}" width="${lw}" height="13" fill="url(#lgleg)" stroke="#999" stroke-width="0.8"/>`
          + `<text x="${lx}" y="${h - 11}" font-size="12" fill="#555">低 ${nfmt(mn)}${esc(legend!.unit)}</text>`
          + `<text x="${lx + lw}" y="${h - 11}" font-size="12" fill="#555" text-anchor="end">高 ${nfmt(mx)}${esc(legend!.unit)}</text>`
        svg = svg.replace('</svg>', lg + '</svg>')
      }
      return svg
    }
    // 全国分布での指標情報（IQR判定・順位・全国比）
    const natInfo = (k: string) => {
      const arr = prefectures.map((p) => getM(p, k)).filter((v): v is number => typeof v === 'number')
      const v = getM(sel, k)
      if (typeof v !== 'number' || arr.length < 4) return null
      const dist = iqr(arr)
      const avg = natAvgMap[k] > 0 ? natAvgMap[k] : arr.reduce((a, b) => a + b, 0) / arr.length
      // natLbl: 基準が真の全国値なら「全国比」、47県平均での代替なら「47県平均比」（スライドに明示する）
      return { v, avg, dist, rank: arr.filter((x) => x > v).length + 1, n: arr.length, j: judge(v, dist), ratio: avg > 0 ? v / avg : null, natLbl: natLblOf(k) }
    }
    // 全国コロプレス（日本地図・対象県ハイライト・凡例つき）。縦長比率で余白を減らし大きく見せる
    const japanViz = (k: string, legLabel: string, unit: string): PVisual | null => {
      if (!japanGeo) return null
      const vals: Record<string, number> = {}
      prefectures.forEach((p) => { const v = getM(p, k); if (typeof v === 'number') vals[p.name] = v })
      const arr = Object.values(vals)
      if (!arr.length) return null
      // 凡例は焼き込まず別画像で重ねる（band=trueで下部を空け凡例が九州南部に被らないように）。clipで遠隔離島・沖縄を地図表示から外し本州中心に倍率UP（集計は全県含む）
      return { kind: 'image', svg: choro(japanGeo, 'nam_ja', vals, 520, 600, 4, undefined, [127, 30.8, 146.5, 46], OKINAWA_INSET, true), w: 520, h: 600, big: true, legend: { label: legLabel, unit, min: Math.min(...arr), max: Math.max(...arr) } }
    }
    // 国保/後期 一人当たり医療費は medCost 由来（prefectures.metricsに無いため別経路）
    const natInfoMed = (pick: (d: { kokuho: number; kouki: number }) => number, natTrue?: number) => {
      const selM = medCost.find((d) => d.name === selected)
      // 0/欠損は医療費として無効として除外（rank/IQRの歪み・全国比-100%表示を防ぐ）
      const arr = medCost.map(pick).filter((v): v is number => Number.isFinite(v) && v > 0)
      if (!selM || arr.length < 4 || !(Number.isFinite(pick(selM)) && pick(selM) > 0)) return null
      // 全国基準：真の全国値があればそれを使う（国保）。無ければ47県平均（後期）。
      const v = pick(selM); const dist = iqr(arr)
      const avg = typeof natTrue === 'number' ? natTrue : arr.reduce((a, b) => a + b, 0) / arr.length
      return { v, avg, dist, rank: arr.filter((x) => x > v).length + 1, n: arr.length, j: judge(v, dist), ratio: avg > 0 ? v / avg : null }
    }
    const japanVizMed = (pick: (d: { kokuho: number; kouki: number }) => number, legLabel: string, unit: string): PVisual | null => {
      if (!japanGeo) return null
      const vals: Record<string, number> = {}
      medCost.forEach((d) => { const v = pick(d); if (Number.isFinite(v) && v > 0) vals[d.name] = v })
      const arr = Object.values(vals)
      if (!arr.length) return null
      return { kind: 'image', svg: choro(japanGeo, 'nam_ja', vals, 520, 600, 4, undefined, [127, 30.8, 146.5, 46], OKINAWA_INSET), w: 520, h: 600, big: true, legend: { label: legLabel, unit, min: Math.min(...arr), max: Math.max(...arr) } }
    }
    const geoReady = !!(cityGeo && cityGeo.url === muniGeoUrl && regionData && regionData.length && regionData[0]?.pref === selected)
    const muniValsOf = (label: string) => {
      const o: Record<string, number> = {}
      if (geoReady) regionData!.forEach((r) => { const mm = r.metrics.find((x) => x.label === label); if (mm && Number.isFinite(mm.value)) o[r.city] = mm.value })
      return o
    }
    // 県内指標の年度（regionFactorsのyearフィールド。文章・グラフに年度を明記するため）
    const muniYr = (label: string): string => {
      if (!geoReady) return ''
      for (const r of regionData!) { const mm = r.metrics.find((x) => x.label === label); if (mm?.year) return wareki(String(mm.year)) }
      return ''
    }
    // 県内市町村マップのスライド（最高/最低/格差をIQR判定つきで）
    const cityMapSlide = (heading: string, lead: string, vals: Record<string, number>, unit: string, src: PSrc = SRC.ssds, note?: string, legLabel?: string): PSlide | null => {
      const entries = Object.entries(vals); if (entries.length < 2 || !geoReady) return null
      const arr = entries.map((e) => e[1]); const dist = iqr(arr)
      const hi = entries.reduce((a, b) => (b[1] > a[1] ? b : a)); const lo = entries.reduce((a, b) => (b[1] < a[1] ? b : a))
      const ratio = lo[1] > 0 ? hi[1] / lo[1] : null // 最低値が0以下の指標は倍率を出さない
      const gapTxt = ratio ? `約${ratio.toFixed(1)}倍` : `差${nfmt(hi[1] - lo[1])}${unit}`
      const spread = ratio == null ? '大きい' : ratio >= 2 ? '大きい' : ratio >= 1.3 ? 'やや大きい' : '小さい'
      // リードは簡潔に（詳細は箇条書きに分離）。県内ばらつきの大小だけ補足
      const fullLead = `${lead}県内${entries.length}市町村で${gapTxt}の差があり、ばらつきは${spread}。特に高い／低い市町村は重点的に検討する対象。`
      return {
        heading, lead: fullLead,
        bullets: [
          `最高 ${hi[0]} ${nfmt(hi[1])}${unit}（${judge(hi[1], dist)}）`,
          `最低 ${lo[0]} ${nfmt(lo[1])}${unit}（${judge(lo[1], dist)}）`,
          `格差 ${gapTxt}・県内中央値 ${nfmt(dist.med)}${unit}`,
        ],
        note: note ?? `県内${gapTxt}の差。外れ値の市町村を優先対象に保健事業を検討することが考えられる。`,
        visual: { kind: 'image', svg: choro(cityGeo!.geo, 'city', vals, 560, 520, 6, { label: legLabel ?? heading.replace(/^.*：/, '').replace(/（.*$/, ''), unit }), w: 560, h: 520 },
        source: src,
      }
    }
    // 県内 国保一人当たり医療費（municipalitiesをsel.nameで抽出）
    const costVals: Record<string, number> = {}
    municipalities.forEach((m) => { if (m.name.startsWith(sel.name)) { const c = m.name.slice(sel.name.length); if (typeof m.value === 'number') costVals[c] = m.value } })

    const sections: PSection[] = []
    const push = (title: string, slides: (PSlide | null)[]) => { const ss = slides.filter((x): x is PSlide => !!x); if (ss.length) sections.push({ title, slides: ss }) }

    // ── 1. 全国比較 ──
    const sec1: (PSlide | null)[] = []
    // 制度別：国保 → 後期 の一人当たり医療費（全国分布）。本資料は国保・後期で分析する（国民医療費は用いない）
    const ag = natInfo('aging_rate')
    const ko = natInfoMed((d) => d.kokuho, KOKUHO_NAT)
    if (ko) sec1.push({
      heading: '国保 一人当たり医療費（全国の位置）',
      lead: `まず全体像から。${sel.name}の国民健康保険（国保）の一人当たり医療費は全国${ko.rank}位（${ko.j}）。高齢化の影響も大きい。地図は全国分布で${sel.name}を濃紺枠で示す。`,
      bullets: [
        `${sel.name} ${nfmt(ko.v)}円（全国 ${nfmt(ko.avg)}円・${pctDiff(ko.v, ko.avg)}）＝${ko.j}`,
        ag ? `高齢化率も ${nfmt(ag.v)}%（${pctDiff(ag.v, ag.avg)}）と高い` : '国保は退職者・自営業・高齢者が多く、医療費が高く出やすい',
        '医療費の高さは「年齢構成」と「年齢を補正しても残る高さ」に分けて考える必要がある',
      ],
      note: '国保は高齢の加入者が多いほど一人当たり医療費が高くなりやすい。年齢で説明できる部分を除いた要因を以降で掘り下げる。次の後期とあわせて見る。',
      visual: japanVizMed((d) => d.kokuho, '国保一人当たり医療費(円)', '円'),
      source: SRC.iryomap,
    })
    const kk = natInfoMed((d) => d.kouki)
    if (kk) sec1.push({
      heading: '後期高齢者 一人当たり医療費（全国の位置）',
      lead: `国保に続き75歳以上の後期高齢者医療を見ると、${sel.name}の一人当たり医療費は全国${kk.rank}位（${kk.j}）。後期は全員が高齢者のため、地域差は医療のかかり方を反映しやすい。`,
      bullets: [
        `${sel.name} ${nfmt(kk.v)}円（全国(参考) ${nfmt(kk.avg)}円・${pctDiff(kk.v, kk.avg)}）＝${kk.j}`,
        '後期は全員が高齢者のため、地域差は医療のかかり方や提供体制を反映しやすい',
        '※後期の全国値は公表値が未取得のため、47都道府県平均を全国(参考)として表示',
      ],
      note: '後期は年齢の影響が小さいぶん、地域ごとの医療のかかり方の差が出やすいと考えられる。',
      visual: japanVizMed((d) => d.kouki, '後期一人当たり医療費(円)', '円'),
      source: SRC.iryomap,
    })
    if (radarAxes.length >= 3) {
      // 真の全国値が無い軸（47県平均で代替）は「※」を付けて注記する
      const approxAxes = radarAxes.filter((a) => typeof NATIONAL[a.k] !== 'number')
      sec1.push({
        heading: '主要指標の全国比較（レーダー）',
        lead: `医療費以外も含む主要指標を全国平均=1.0として比べると、${sel.name}の特徴は「${radarAxes[0].label.replace(/\(.*\)/, '')}」に集中している。1.0より外側が全国より高い。`,
        bullets: radarAxes.slice(0, 3).map((a) => `${a.label}：${natLblOf(a.k)} ${a.ratio.toFixed(2)}倍${a.ratio >= 1 ? '（高い）' : '（低い）'}`),
        note: `外側に張る指標が当県の特徴。これらを重点に以降で深掘りする。${approxAxes.length ? `※印の軸は全国値が未取得のため47都道府県平均=1.0で代替。` : ''}`,
        visual: { kind: 'radar', labels: radarAxes.map((a) => a.label + (typeof NATIONAL[a.k] === 'number' ? '' : '※')), values: radarAxes.map((a) => a.ratio) },
        source: SRC.est,
      })
    }
    push('全国の中での位置づけ', sec1)

    // ── クロス分析（医療費と要因の相関・全国47都道府県）──
    const corrDefs: [string, string][] = [
      ['aging_rate', '高齢化率'], ['beds_per_100k', '病床数'], ['doctors_per_100k', '医師数'],
      ['admit_rate', '入院受療率'], ['outpatient_rate', '外来受療率'], ['checkup_rate', '特定健診実施率'],
      ['dis_diabetes', '糖尿病外来'], ['dis_renal_in', '腎不全入院'], ['smoke_rate', '喫煙率'], ['guidance_rate', '保健指導実施率'],
    ]
    // 相関の対象は「国保 一人当たり医療費」（国民医療費は用いない）。県名でmedCostを引く
    const medMap: Record<string, { kokuho: number; kouki: number }> = {}
    medCost.forEach((d) => { medMap[d.name] = { kokuho: d.kokuho, kouki: d.kouki } })
    const costPairs = prefectures.map((p) => ({ cost: medMap[p.name]?.kokuho, p })).filter((d) => Number.isFinite(d.cost) && (d.cost as number) > 0)
    const corrs = corrDefs.map(([k, lbl]) => {
      const pr = costPairs.filter((d) => typeof getM(d.p, k) === 'number')
      if (pr.length < 5) return null
      const r = corr(pr.map((d) => getM(d.p, k) as number), pr.map((d) => d.cost as number))
      return r != null && Number.isFinite(r) ? { k, lbl, r: +r.toFixed(2) } : null
    }).filter((x): x is { k: string; lbl: string; r: number } => !!x).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    const strength = (r: number) => { const a = Math.abs(r); return a >= 0.7 ? '強い相関' : a >= 0.4 ? '比較的強い相関' : a >= 0.2 ? '弱い相関' : 'ほぼ相関なし' }
    const secX: (PSlide | null)[] = []
    if (corrs.length >= 3) {
      secX.push({
        heading: '国保医療費と要因の相関',
        lead: `国保医療費の地域差はどこから生まれるのか。全国47都道府県のデータで医療費と最も強く関係するのは「${corrs[0].lbl}」である（相関 r=${corrs[0].r}）。グラフは関連の強さ順。相関は因果ではない。`,
        bullets: corrs.slice(0, 3).map((c) => `${c.lbl}：r=${c.r}（${strength(c.r)}）`),
        note: '相関が強い要因は医療費の背景仮説の候補。ただし相関≠因果で、年齢構成等の交絡に注意。',
        visual: { kind: 'bar', labels: corrs.slice(0, 8).map((c) => c.lbl), values: corrs.slice(0, 8).map((c) => c.r), title: '国保 一人当たり医療費との相関係数 r', unit: '相関係数 r' },
        source: SRC.iryomap,
      })
      const top = corrs[0]
      const pts = costPairs.filter((d) => typeof getM(d.p, top.k) === 'number').map((d) => ({ x: getM(d.p, top.k) as number, y: d.cost as number, name: d.p.name }))
      const selPt = pts.find((p) => p.name === sel.name)
      if (pts.length >= 5) secX.push({
        heading: '相関の散布図',
        lead: `国保医療費と最も相関の強い「${top.lbl}」を散布図で見ると、${top.lbl}が高い県ほど医療費が${top.r >= 0 ? '高い' : '低い'}関係がはっきり出ている。点=都道府県、赤の点が${sel.name}、破線=傾向線。`,
        bullets: [
          `相関係数 r=${top.r}（${strength(top.r)}）・決定係数 R²≈${(top.r ** 2).toFixed(2)}`,
          `${top.lbl}が高い県ほど国保医療費が${top.r >= 0 ? '高い' : '低い'}傾向`,
          selPt ? `${sel.name}：${top.lbl} ${nfmt(selPt.x)}・国保医療費 ${nfmt(selPt.y)}円` : '※ 相関であり因果ではない',
        ],
        note: `回帰直線から大きく外れる県は他の要因が働く。赤で示した${sel.name}の位置（超過/割安）を確認する。`,
        visual: { kind: 'image', svg: scatterSvg(pts, top.lbl, '国保 一人当たり医療費(円)', 660, 540, sel.name), w: 660, h: 540 },
        source: SRC.iryomap,
      })
    }
    // 国保・後期 一人当たり医療費（令和5年度）との相関 上位5の表
    const factorKeys = metricCatalog.filter((m) => m.k !== 'per_capita_cost')
    const corrWith = (pick: (v: { kokuho: number; kouki: number }) => number) => factorKeys.map((m) => {
      // 0/欠損の医療費は無効値として除外（costPairsと同じ基準）
      const pr = prefectures.filter((p) => medMap[p.name] && Number.isFinite(pick(medMap[p.name])) && pick(medMap[p.name]) > 0 && typeof getM(p, m.k) === 'number')
      if (pr.length < 5) return null
      const r = corr(pr.map((p) => getM(p, m.k) as number), pr.map((p) => pick(medMap[p.name])))
      return r != null && Number.isFinite(r) ? { lbl: m.label, r: +r.toFixed(2) } : null
    }).filter((x): x is { lbl: string; r: number } => !!x).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    const koTop = corrWith((v) => v.kokuho).slice(0, 5)
    const kkTop = corrWith((v) => v.kouki).slice(0, 5)
    if (koTop.length >= 3 && kkTop.length >= 3) {
      const rows = Array.from({ length: Math.max(koTop.length, kkTop.length) }, (_, i) => [
        `${i + 1}`, koTop[i]?.lbl ?? '', koTop[i] ? `r=${koTop[i].r}` : '', kkTop[i]?.lbl ?? '', kkTop[i] ? `r=${kkTop[i].r}` : '',
      ])
      secX.push({
        heading: '国保・後期の相関 上位5',
        lead: '国保・後期それぞれで、医療費と関係の強い要因を上位5つ整理した（全国47都道府県）。相関は因果ではない。',
        bullets: [],
        note: '国保と後期で相関の強い要因が異なる場合、保険者・対象層ごとに打ち手を変えることが望ましいと考えられる。',
        visual: { kind: 'table', head: ['順位', '国保：相関の強い要因', 'r', '後期：相関の強い要因', 'r'], rows, colW: [1.1, 4.3, 1.2, 4.3, 1.2] },
        source: SRC.iryomap,
      })
    }
    push('クロス分析（医療費と要因の相関）', secX)

    // ── 2. 疾病構造・医療資源 ──
    const sec2: (PSlide | null)[] = []
    const disDefs: [string, string][] = [['dis_renal_in', '腎不全'], ['dis_diabetes_in', '糖尿病'], ['dis_stroke_in', '脳血管'], ['dis_mental_in', '精神'], ['dis_cancer_in', 'がん'], ['dis_msk_in', '筋骨格'], ['dis_htn_in', '高血圧'], ['dis_ihd_in', '虚血性心']]
    const disRows = disDefs.map(([k, lbl]) => { const di = natInfo(k); return di && di.ratio ? { name: lbl, value: Math.round(di.ratio * 100 - 100), natLbl: di.natLbl } : null })
      .filter((x): x is { name: string; value: number; natLbl: string } => !!x).sort((a, b) => b.value - a.value)
    const adm = natInfo('admit_rate'); const out = natInfo('outpatient_rate')
    if (disRows.length && adm) {
      sec2.push({
        heading: '疾患別の入院',
        lead: `${sel.name}の入院の中身を疾患別に見ると、${disRows[0].name}${disRows[1] ? `・${disRows[1].name}` : ''}などが上位で、生活習慣病の重症化が疑われる。グラフは疾患別 入院受療率の全国比。`,
        bullets: [
          `入院受療率(${NYEAR.admit_rate})：${adm.j}（${adm.natLbl} ${pctDiff(adm.v, adm.avg)}）`,
          out ? `外来受療率(${NYEAR.outpatient_rate})：${out.j}（${out.natLbl} ${pctDiff(out.v, out.avg)}）` : '外来受療率：データ参照',
          `突出疾患：${disRows[0].name}入院 ${disRows[0].natLbl} ${disRows[0].value >= 0 ? '+' : ''}${disRows[0].value}%（${NYEAR.dis_renal_in}）`,
        ],
        note: `${disRows[0].name}など入院が高い疾患は、重症化予防・在宅療養推進により入院抑制につながる可能性があり、重点的な検討対象と考えられる。`,
        visual: { kind: 'bar', labels: disRows.map((r) => r.name), values: disRows.map((r) => r.value), title: `疾患別 入院受療率の全国比（${NYEAR.admit_rate}）`, unit: '全国比(%)' },
        source: SRC.kanja,
      })
    }
    const beds = natInfo('beds_per_100k'); const docs = natInfo('doctors_per_100k')
    if (beds || docs) {
      sec2.push({
        heading: '医療資源（病床・医師）',
        lead: `入院の多さの背景としてよく指摘されるのが病床（ベッド）で、病床が多い地域ほど入院が生まれやすいとされる。${sel.name}の病床・医師の水準を全国と比べて確認する。`,
        bullets: [
          docs ? `医師数(10万対,${NYEAR.doctors_per_100k})：${docs.j}（${docs.natLbl} ${pctDiff(docs.v, docs.avg)}）` : '医師数：データ参照',
          beds ? `病床数(10万対,${NYEAR.beds_per_100k})：${beds.j}（${beds.natLbl} ${pctDiff(beds.v, beds.avg)}）` : '病床数：データ参照',
          '病床数と入院受療率の関連に注意（相関であり断定はしない）',
        ],
        note: 'ベッドが多い地域ほど入院も増えやすいと言われている。入院から在宅・外来へ移すことで、ムダな入院を減らせる余地がある。',
        visual: (geoReady && Object.keys(muniValsOf('病院病床数(人口10万対)')).length)
          ? { kind: 'image', svg: choro(cityGeo!.geo, 'city', muniValsOf('病院病床数(人口10万対)'), 560, 520, 6, { label: '病床数(10万対)', unit: '' }), w: 560, h: 520 }
          : japanViz('beds_per_100k', '病床数(10万対)', ''),
        source: SRC.shisetsu,
      })
    }
    push('疾病構造と医療資源', sec2)

    // ── 3. 予防・社会要因 ──
    const sec3: (PSlide | null)[] = []
    const chk = natInfo('checkup_rate'); const gui = natInfo('guidance_rate')
    if (chk || gui) {
      sec3.push({
        heading: '特定健診・特定保健指導',
        lead: `重症化を防ぐ入口にあたるのが特定健診・特定保健指導である。${sel.name}の実施率は全国の中でも低く、早く見つけて介入する機会を逃しやすい。`,
        bullets: [
          chk ? `特定健診実施率(${NYEAR.checkup_rate})：${chk.j}（${chk.natLbl} ${pctDiff(chk.v, chk.avg)}）` : '特定健診：データ参照',
          gui ? `特定保健指導実施率(${NYEAR.guidance_rate})：${gui.j}（${gui.natLbl} ${pctDiff(gui.v, gui.avg)}）` : '特定保健指導：データ参照',
          '実施率が低い＝生活習慣病の早期介入が弱く、重症化・入院増につながりやすい',
        ],
        note: '実施率が低いほど早期介入の機会を逃しやすい可能性。受診率向上が重症化予防につながる可能性が考えられる。',
        visual: japanViz('checkup_rate', '特定健診実施率(%)', '%'),
        source: SRC.kenshin,
      })
    }
    const smk = natInfo('smoke_rate'); const dth = natInfo('death_rate')
    const agi = natInfo('aging_rate')
    sec3.push({
      heading: '高齢化・生活習慣',
      lead: `医療需要の土台となるのが高齢化で、喫煙などの生活習慣も病気のなりやすさに影響する。${sel.name}の高齢化・生活習慣の水準を確認する（指標ごとに年度が異なる）。`,
      bullets: [
        agi ? `高齢化率(${NYEAR.aging_rate})：${agi.j}（${agi.natLbl} ${pctDiff(agi.v, agi.avg)}）` : '高齢化率：データ参照',
        smk ? `喫煙者割合(${NYEAR.smoke_rate})：${smk.j}（${smk.natLbl} ${pctDiff(smk.v, smk.avg)}）` : '喫煙：データ参照',
        dth ? `死亡率(粗・全死因,${NYEAR.death_rate})：${dth.j}（${dth.natLbl} ${pctDiff(dth.v, dth.avg)}）※高齢化の影響大` : '死亡率：データ参照',
      ],
      note: '高齢化や喫煙は病気のなりやすさにつながる。食事・運動などの生活習慣の改善や、歩きやすいまちづくりが役立つと考えられる。',
      visual: japanViz('aging_rate', '高齢化率(%)', '%'),
      source: SRC.jinko,
    })
    push('予防と社会・生活要因', sec3)

    // ── 4. 県内市町村（ストーリー：医療費の結果→予防の入口→需要の基盤の3枚に厳選）──
    // 医師数・病床数の市町村別は「施設の所在地」を映し住民の受療と一致しないため、誤解回避で除外
    if (geoReady) {
      const sec4: (PSlide | null)[] = []
      const yc = (l: string) => { const y = muniYr(l); return y ? `（${y}）` : '' }
      // ① 結果：国保医療費の県内格差
      if (Object.keys(costVals).length) sec4.push(cityMapSlide(
        '県内：国保 一人当たり医療費',
        '視点を県全体から県内の市町村に移すと、国保の一人当たり医療費は市町村によって差がある（令和5年度）。', costVals, '円', SRC.iryomap,
        '医療費が高い市町村ほど、重症化予防や適正化で改善できる余地が大きいと考えられる。', '国保一人当たり医療費(円)'))
      // ② 入口：予防（特定健診）の県内差
      const chkV = muniValsOf('特定健診実施率(%)')
      if (Object.keys(chkV).length) sec4.push(cityMapSlide(
        '県内：特定健診実施率',
        `医療費と同じく、予防の入口である特定健診の受診率も市町村によって差がある${yc('特定健診実施率(%)')}。`, chkV, '%', SRC.ssds,
        '健診率が低い市町村は早期発見の機会を逃しやすく、優先的な受診勧奨の対象と考えられる。', '特定健診実施率(%)'))
      // ③ 基盤：高齢化の県内差
      const ageV = muniValsOf('高齢化率(%)')
      if (Object.keys(ageV).length) sec4.push(cityMapSlide(
        '県内：高齢化率',
        `医療需要の土台となる高齢化の進み方は市町村によって差があり、その差が地域ごとの医療需要の差につながる${yc('高齢化率(%)')}。`, ageV, '%', SRC.ssds,
        '高齢化が進む地域では、在宅医療や介護との連携がより重要になると考えられる。', '高齢化率(%)'))
      // ④ 供給：医療資源（病床）。市町村別は施設の所在地である点を注記
      const bedV = muniValsOf('病院病床数(人口10万対)')
      if (Object.keys(bedV).length) sec4.push(cityMapSlide(
        '県内：病床数',
        `医療を支える資源（病床）は市町村ごとに偏りがある（病院の所在地による）${yc('病院病床数(人口10万対)')}。`, bedV, '床', SRC.ssds,
        '市町村別の病床数は「病院がどこにあるか」を映すもので、住民の受け方とは別。近隣市町村との連携で見る必要がある。', '病床数(10万対)'))
      // ⑤ 社会経済：就業構造（第1次産業の比率）
      const ind1 = muniValsOf('第1次産業就業者比率(%)')
      if (Object.keys(ind1).length) sec4.push(cityMapSlide(
        '県内：第1次産業の比率',
        `社会経済の面では、就業構造（第1次産業の比率）に市町村差がある${yc('第1次産業就業者比率(%)')}。`, ind1, '%', SRC.ssds,
        '第1次産業の比率が高い地域は高齢化・過疎が進みやすく、医療の受けやすさにも影響すると考えられる。', '第1次産業就業者比率(%)'))
      // ⑥ 社会経済：所得水準。元データ（社会人口統計体系 C120110）の単位は千円（例: 3,436千円≈344万円）
      const incV = muniValsOf('納税義務者1人当課税対象所得')
      if (Object.keys(incV).length) sec4.push(cityMapSlide(
        '県内：課税対象所得',
        `暮らしの面では、所得水準に市町村差があり、受診行動や生活習慣の背景になる${yc('納税義務者1人当課税対象所得')}。`, incV, '千円', SRC.ssds,
        '所得が低い地域は受診控えや生活習慣の課題が出やすく、医療費の背景になりうると考えられる。', '課税対象所得(千円)'))
      push('県内市町村の比較', sec4)

      // 各市町村ごとの複合的な考察（全市町村・県内分布で多面的に判定）。県内中央値から最も乖離した指標=その市町村の特徴を起点に、
      // 他指標との組み合わせで原因仮説を語り、健康アウトカム(SMR・平均余命)・医療費は補足に回す
      const ageV2 = muniValsOf('高齢化率(%)'); const chkV2 = muniValsOf('特定健診実施率(%)')
      const guiV = muniValsOf('特定保健指導実施率(%)'); const shuV = muniValsOf('国保収納率(%)')
      const jisV = muniValsOf('自殺死亡率(10万対)')
      const docV = muniValsOf('医師数(人口10万対)'); const hcV = muniValsOf('在宅療養支援病院診療所数(10万対)')
      const sng65 = muniValsOf('65歳以上単身世帯割合(%)')
      // SMR(標準化死亡比・年齢調整済)と平均余命は男女の平均を市町村ごとに合成
      const smrM = muniValsOf('標準化死亡比_全死因_男'); const smrF = muniValsOf('標準化死亡比_全死因_女')
      const lifeM = muniValsOf('平均余命0歳(男)'); const lifeF = muniValsOf('平均余命0歳(女)')
      const meanOf = (a: Record<string, number>, b: Record<string, number>) => {
        const o: Record<string, number> = {}
        new Set([...Object.keys(a), ...Object.keys(b)]).forEach((c) => {
          const vs = [a[c], b[c]].filter((x) => Number.isFinite(x)); if (vs.length) o[c] = vs.reduce((s, x) => s + x, 0) / vs.length
        })
        return o
      }
      const smrV = meanOf(smrM, smrF); const lifeV = meanOf(lifeM, lifeF)
      const distOf = (o: Record<string, number>) => iqr(Object.values(o).filter((x) => Number.isFinite(x)))
      const dCost = distOf(costVals), dAge = distOf(ageV2), dChk = distOf(chkV2)
      const dInc = distOf(incV), dDoc = distOf(docV), dHc = distOf(hcV), dSng = distOf(sng65)
      const dSmr = distOf(smrV), dLife = distOf(lifeV), dGui = distOf(guiV), dShu = distOf(shuV), dJis = distOf(jisV)
      const isHi = (o: Record<string, number>, d: ReturnType<typeof iqr>, c: string) => d.iqr > 0 && Number.isFinite(o[c]) && o[c] > d.q3
      const isLo = (o: Record<string, number>, d: ReturnType<typeof iqr>, c: string) => d.iqr > 0 && Number.isFinite(o[c]) && o[c] < d.q1
      // 市町村プロファイルの指標プール。bad=課題側の極（hi=高いほど課題／lo=低いほど課題）。axis=レーダー軸ラベル
      // w=[高い側の言い方, 低い側の言い方]（率は高い/低い、数は多い/少ない、余命は長い/短い を正しく使い分ける）
      type Pool = { label: string; axis: string; o: Record<string, number>; d: ReturnType<typeof iqr>; bad: 'hi' | 'lo'; unit: string; w: [string, string] }
      const pool: Pool[] = [
        { label: '国保医療費', axis: '医療費', o: costVals, d: dCost, bad: 'hi', unit: '円', w: ['高い', '低い'] },
        { label: 'SMR(死亡比)', axis: 'SMR', o: smrV, d: dSmr, bad: 'hi', unit: '', w: ['高い', '低い'] },
        { label: '平均余命', axis: '余命', o: lifeV, d: dLife, bad: 'lo', unit: '歳', w: ['長い', '短い'] },
        { label: '高齢化率', axis: '高齢化', o: ageV2, d: dAge, bad: 'hi', unit: '%', w: ['高い', '低い'] },
        { label: '健診受診率', axis: '健診', o: chkV2, d: dChk, bad: 'lo', unit: '%', w: ['高い', '低い'] },
        { label: '保健指導実施率', axis: '保健指導', o: guiV, d: dGui, bad: 'lo', unit: '%', w: ['高い', '低い'] },
        { label: '医師数', axis: '医師', o: docV, d: dDoc, bad: 'lo', unit: '/10万', w: ['多い', '少ない'] },
        { label: '在宅医療資源', axis: '在宅', o: hcV, d: dHc, bad: 'lo', unit: '/10万', w: ['多い', '少ない'] },
        { label: '高齢単身世帯', axis: '単身', o: sng65, d: dSng, bad: 'hi', unit: '%', w: ['多い', '少ない'] },
        { label: '所得', axis: '所得', o: incV, d: dInc, bad: 'lo', unit: '千円', w: ['高い', '低い'] }, // 課税対象所得の単位は千円（円ではない）
        { label: '国保収納率', axis: '収納率', o: shuV, d: dShu, bad: 'lo', unit: '%', w: ['高い', '低い'] },
        { label: '自殺死亡率', axis: '自殺', o: jisV, d: dJis, bad: 'hi', unit: '/10万', w: ['高い', '低い'] },
      ]
      const nv = (x: number) => (Number.isFinite(x) ? nfmt(x) : '-')
      // 県で高い疾病（章2 disRows：全国比＋の上位）と、その疾病に効くリスク要因（市町村のconcernラベル）。
      // promptのフェーズ6因果チェーン：生活習慣・環境→疾病リスク→健診→受診→医療費 を市町村のリスク要因で結ぶ
      const diseaseRisk: Record<string, string[]> = {
        腎不全: ['健診受診率', '保健指導実施率', '所得', '高齢化率'],
        糖尿病: ['健診受診率', '保健指導実施率', '所得'],
        脳血管: ['高齢化率', '健診受診率', '所得'],
        精神: ['高齢単身世帯', '所得'],
        がん: ['健診受診率', '高齢化率'],
        筋骨格: ['高齢化率'],
        高血圧: ['健診受診率', '所得'],
        虚血性心: ['高齢化率', '健診受診率'],
      }
      const topDis = disRows.filter((d) => d.value > 0).slice(0, 2) // 県で全国比＋の疾病 上位2
      // 特徴軸の原因仮説辞書：各市町村で最も乖離した指標(=レーダーの筆頭軸)について「なぜそうなっているか」を
      // 他指標の実態(hi/lo)との組み合わせで語る。disLinkと同じ発想＝複数指標の収束で仮説を組む。
      // need=その市町村で成立している必要がある条件（全て満たす最初の仮説を採用）。条件が多いものを先に置く
      type FeatHyp = { need: [string, 'hi' | 'lo'][]; t: string }
      const featureWhy: Record<string, { hi: FeatHyp[]; lo: FeatHyp[]; baseHi: string; baseLo: string }> = {
        国保医療費: {
          hi: [
            { need: [['高齢化率', 'hi'], ['健診受診率', 'lo']], t: '高齢化による需要の大きさに予防（健診）の弱さが重なり、重症化してからの受療が医療費を押し上げている可能性がある' },
            { need: [['高齢化率', 'hi']], t: '高齢化による医療需要の大きさが土台にあると考えられる' },
            { need: [['健診受診率', 'lo']], t: '健診受診率の低さから、重症化してから受療するパターンが医療費を押し上げている可能性がある' },
            { need: [['在宅医療資源', 'lo']], t: '在宅の受け皿の乏しさが入院への依存を招き、医療費を押し上げている可能性がある' },
          ],
          lo: [
            { need: [['医師数', 'lo']], t: 'ただし医師数も少なく、健康の良さではなく受診アクセスの制約で医療費が抑えられている可能性に注意が必要' },
            { need: [['健診受診率', 'hi']], t: '健診受診率の高さ＝予防の入口の強さが、重症化の抑制を通じて医療費の低さにつながっている可能性がある' },
          ],
          baseHi: '需要（高齢化）・供給（資源）・予防（健診）のどれが押し上げているかを切り分けて対策する必要がある',
          baseLo: '医療費の低さが健康の良さによるものか受診控えによるものか、健診・資源の指標と併せた確認が必要',
        },
        'SMR(死亡比)': {
          hi: [
            { need: [['健診受診率', 'lo'], ['保健指導実施率', 'lo']], t: '健診・保健指導がともに弱く、生活習慣病を早期に見つけて介入できないまま重症化・死亡に至っている可能性がある' },
            { need: [['健診受診率', 'lo']], t: '健診受診率の低さによる発見の遅れが、年齢では説明できない死亡水準の高さにつながっている可能性がある' },
            { need: [['所得', 'lo']], t: '所得の低さによる受診控えや生活習慣の課題が、死亡水準の高さの背景にある可能性がある' },
          ],
          lo: [
            { need: [['健診受診率', 'hi']], t: '健診受診率の高さ＝早期発見・介入の機能が、年齢調整後の死亡の少なさに寄与している可能性がある' },
          ],
          baseHi: '年齢構成を調整しても死亡が多く、生活習慣・受療行動など年齢以外の要因を疑う必要がある',
          baseLo: '年齢調整後の死亡が少なく、健康水準は県内でも良好な部類にある',
        },
        平均余命: {
          hi: [
            { need: [['健診受診率', 'hi']], t: '健診受診率の高さなど予防の強さが、余命の長さを支えている可能性がある' },
          ],
          lo: [
            { need: [['SMR(死亡比)', 'hi']], t: '死亡比(SMR)の高さと符合しており、生活習慣・早期発見の遅れなど共通の要因が寿命を縮めている可能性がある' },
            { need: [['健診受診率', 'lo']], t: '健診受診率の低さによる早期発見の遅れが、余命の短さの一因になっている可能性がある' },
          ],
          baseHi: '長寿の背景に生活習慣・受療環境の良さがあると考えられ、健康寿命の維持が次の課題になる',
          baseLo: '余命の短さの背景に生活習慣・受療環境など複合的な要因がないか確認が必要',
        },
        高齢化率: {
          hi: [
            { need: [['国保医療費', 'hi']], t: '年齢構成そのものが医療需要を膨らませ、医療費の高さの土台になっていると考えられる' },
            { need: [['高齢単身世帯', 'hi']], t: '独居の高齢者も多く、受診・服薬・生活支援が個人任せになりやすい構造がうかがえる' },
            { need: [['在宅医療資源', 'lo']], t: '需要の増加に在宅の受け皿整備が追いついておらず、入院・施設への依存が強まりやすい' },
          ],
          lo: [],
          baseHi: '医療・介護の需要が構造的に大きく、提供体制と予防の両面での備えが必要になる',
          baseLo: '現役世代が相対的に厚く、健診・保健指導など働く世代への予防介入の効果が出やすい人口構成といえる',
        },
        健診受診率: {
          hi: [
            { need: [['国保医療費', 'lo']], t: '予防の入口が機能し、重症化の抑制を通じて医療費の低さにつながっている可能性がある' },
          ],
          lo: [
            { need: [['SMR(死亡比)', 'hi']], t: '早期発見の入口の弱さが、死亡水準の高さ(SMR高)につながっている可能性がある' },
            { need: [['国保医療費', 'hi']], t: '未受診のまま重症化してから受療するパターンが、医療費の高さの一因になっている可能性がある' },
            { need: [['所得', 'lo']], t: '所得の低さによる受診控えが健診離れの背景にあると考えられ、費用面の障壁を下げる工夫が必要' },
          ],
          baseHi: '予防の入口は機能しており、受診後の保健指導・受療への接続が次の焦点になる',
          baseLo: '生活習慣病を早期に見つける入口が弱く、重症化してから見つかるリスクを抱えている',
        },
        保健指導実施率: {
          hi: [],
          lo: [
            { need: [['健診受診率', 'lo']], t: '健診とその後の指導がともに弱く、リスクを見つけても行動変容につなげられない構造になっている' },
          ],
          baseHi: '健診後の介入が機能しており、重症化予防の基盤があるといえる',
          baseLo: '健診で見つけたリスクを行動変容につなげる仕組みが弱く、重症化予防の効果が出にくい',
        },
        医師数: {
          hi: [
            { need: [['国保医療費', 'hi']], t: '拠点的な医療機関の立地で受療機会が多く、供給の厚さが受診・医療費の多さと表裏になっている可能性がある' },
          ],
          lo: [
            { need: [['健診受診率', 'lo']], t: '医療への物理的な距離が受診・健診離れの背景にある可能性があり、アクセス確保が予防の前提になる' },
          ],
          baseHi: '医療機関の立地に恵まれ受診アクセスの面で優位にあり、周辺市町村の受療も支えている可能性がある',
          baseLo: '医師の確保が難しく日常の受診は近隣市町村への依存が大きいとみられ、広域連携が前提になる',
        },
        在宅医療資源: {
          hi: [
            { need: [['国保医療費', 'lo']], t: '入院に頼らず在宅で療養を完結できる体制が、医療費の低さにつながっている可能性がある' },
            { need: [['高齢化率', 'hi']], t: '高い高齢化率に応えて在宅の受け皿づくりが進んだ結果とみられ、入院・施設への依存を和らげている可能性がある' },
          ],
          lo: [
            { need: [['高齢化率', 'hi']], t: '高齢化が進むわりに在宅の受け皿が乏しく、入院・施設への依存や家族の介護負担につながりやすい' },
            { need: [['国保医療費', 'hi']], t: '在宅の受け皿の乏しさが入院への依存を招き、医療費を押し上げている可能性がある' },
          ],
          baseHi: '住み慣れた地域で療養を続けられる体制があり、入院に頼らない療養の受け皿になっているとみられる',
          baseLo: '在宅療養の受け皿が乏しく、退院後の療養先の確保が課題になりやすい',
        },
        高齢単身世帯: {
          hi: [
            { need: [['自殺死亡率', 'hi']], t: '孤立しやすい世帯構造が自殺死亡率の高さと重なっており、見守り・相談体制の強化が急務と考えられる' },
            { need: [['高齢化率', 'hi']], t: '高齢化と独居化が同時に進み、受診・服薬の管理が本人任せになりやすい' },
          ],
          lo: [],
          baseHi: '独居高齢者の受診・服薬・急変時対応を支える見守りの仕組みが課題になりやすい',
          baseLo: '家族と同居する高齢者が多く、日常の見守りや受診支援を家庭が担えている構造とみられる',
        },
        所得: {
          hi: [],
          lo: [
            { need: [['健診受診率', 'lo']], t: '経済的な余裕のなさが受診控え・健診離れにつながっている可能性がある' },
            { need: [['国保収納率', 'lo']], t: '収納率の低さにも表れており、保険料・受診の負担感が医療から足を遠ざけている可能性がある' },
          ],
          baseHi: '経済的な余裕は受診・予防行動に向かいやすい条件であり、健診体制の充実が活きやすい',
          baseLo: '経済的な事情による受診控えや生活習慣の乱れが健康リスクの背景になりやすい',
        },
        国保収納率: {
          hi: [],
          lo: [
            { need: [['所得', 'lo']], t: '所得水準の低さの反映と考えられ、保険料負担の重さが受診控えにつながる懸念もある' },
          ],
          baseHi: '保険料の納付状況が良好で、国保財政の基盤は安定している',
          baseLo: '国保財政の基盤に不安があり、負担感の軽減と収納支援が課題になる',
        },
        自殺死亡率: {
          hi: [
            { need: [['高齢単身世帯', 'hi']], t: '独居・孤立しやすい世帯構造と重なっており、社会的つながりの希薄さが背景にある可能性がある' },
            { need: [['所得', 'lo']], t: '経済的な苦しさがメンタル面の負荷になっている可能性があり、生活支援と一体の対策が必要' },
          ],
          lo: [],
          baseHi: 'データからは特定の背景に収束しないが、相談体制・気づきの仕組みづくりが優先課題と考えられる',
          baseLo: 'メンタル面の指標は良好で、現在の地域のつながりを維持することが予防になる',
        },
      }
      // 1市町村ぶんの複合考察：各指標を県内中央値比で評価し、課題(concern)・強み(strength)・特徴的な軸を抽出
      const considOf = (c: string) => {
        const items = pool.map((p) => {
          const v = p.o[c]; const has = p.d.med > 0 && Number.isFinite(v)
          const ratio = has ? v / p.d.med : null
          const concern = p.bad === 'hi' ? isHi(p.o, p.d, c) : isLo(p.o, p.d, c)
          const strength = p.bad === 'hi' ? isLo(p.o, p.d, c) : isHi(p.o, p.d, c)
          return { ...p, v, ratio, concern, strength, dev: ratio != null ? Math.abs(ratio - 1) : -1 }
        })
        const concerns = items.filter((i) => i.concern)
        const strengths = items.filter((i) => i.strength)
        // 医療費データが無い市町村（muniStatsと名前不一致等）を「中位」と断定しない → null=データなし
        const lvl: string | null = Number.isFinite(costVals[c])
          ? (isHi(costVals, dCost, c) ? '高い' : isLo(costVals, dCost, c) ? '低い' : '中位')
          : null
        const severe = (isHi(smrV, dSmr, c) ? 1 : 0) + (isLo(lifeV, dLife, c) ? 1 : 0)
        const has = (l: string) => concerns.some((i) => i.label === l)
        const acts: string[] = []
        if (lvl === '高い' || severe) acts.push('重症化予防・医療費適正化')
        if (has('健診受診率') || has('保健指導実施率')) acts.push('健診・保健指導の受診勧奨')
        if (has('高齢化率') || has('高齢単身世帯')) acts.push('在宅・介護連携と高齢者見守り')
        if (has('医師数') || has('在宅医療資源')) acts.push('医療提供体制・広域連携の確保')
        if (has('所得') || has('国保収納率')) acts.push('受診しやすい環境・収納支援')
        if (has('自殺死亡率')) acts.push('メンタルヘルス相談体制の強化')
        // 健康アウトカムの一言
        const health: string[] = []
        if (isHi(smrV, dSmr, c)) health.push('死亡がやや多い(SMR高)'); else if (isLo(smrV, dSmr, c)) health.push('死亡がやや少ない(SMR低)')
        if (isLo(lifeV, dLife, c)) health.push('平均余命が短め'); else if (isHi(lifeV, dLife, c)) health.push('平均余命が長め')
        const healthTxt = health.length ? health.join('・') : '健康指標は県内で平均的'
        // 特徴起点の考察：レーダー(radarFor)と同じ「県内中央値から最も乖離した指標」を筆頭に据え、
        // featureWhyで他指標の実態(hi/lo)と組み合わせた原因仮説を作る（市町村ごとに特徴も原因文も変わる）
        const posMap: Record<string, 'hi' | 'lo' | 'mid'> = {}
        items.forEach((i) => { posMap[i.label] = i.concern ? i.bad : i.strength ? (i.bad === 'hi' ? 'lo' : 'hi') : 'mid' })
        const ft = items.filter((i) => i.ratio != null).sort((a, b) => b.dev - a.dev)[0]
        let feat: { label: string; ratioTxt: string; word: string; emph: string; why: string } | null = null
        if (ft && ft.dev >= 0.1) {
          const fdir: 'hi' | 'lo' = (ft.ratio as number) > 1 ? 'hi' : 'lo'
          const rr = ft.ratio as number
          const hyp = featureWhy[ft.label]
          const matched = hyp ? (fdir === 'hi' ? hyp.hi : hyp.lo).find((h) => h.need.every(([l, p]) => posMap[l] === p)) : undefined
          feat = {
            label: ft.label,
            ratioTxt: Math.abs(rr - 1) >= 0.15 ? `県内中央値の${rr.toFixed(1)}倍` : `県内中央値比${rr >= 1 ? '+' : ''}${Math.round((rr - 1) * 100)}%`,
            word: fdir === 'hi' ? ft.w[0] : ft.w[1],
            emph: ft.dev >= 0.3 ? '際立って' : '',
            why: matched ? matched.t : hyp ? (fdir === 'hi' ? hyp.baseHi : hyp.baseLo) : '',
          }
        }
        const featTxt = feat
          ? `一番の特徴は${feat.label}（${feat.ratioTxt}・${feat.word}）。${feat.why ? `${feat.why}。` : ''}`
          : '県内中央値から大きく乖離した指標はなく、指標構成は平均的。'
        const text = `${featTxt}${healthTxt}。${lvl ? `医療費は県内で${lvl}。` : '医療費はデータなし。'}${acts.length ? `打ち手は${acts.slice(0, 2).join('・')}。` : ''}`
        // 疾病リンク（因果チェーン）：県で高い疾病に対し、その疾病のリスク要因がこの市町村で県内課題か＝収束層数で信頼度
        const cset = new Set(concerns.map((i) => i.label))
        const disLink = topDis.map((d) => {
          const hit = (diseaseRisk[d.name] || []).filter((r) => cset.has(r))
          return hit.length ? { dis: d.name, hit, conf: hit.length >= 3 ? '高' : hit.length === 2 ? '中' : '低' } : null
        }).filter((x): x is { dis: string; hit: string[]; conf: string } => !!x)
        const disText = disLink.length
          ? `県内で高い${disLink.map((x) => x.dis).join('・')}について、${disLink[0].hit.join('・')}の弱さが重なり重症化が懸念される（収束${disLink[0].hit.length}層・信頼度${disLink[0].conf}・相関であり因果ではない）`
          : (topDis.length ? `県で高い${topDis.map((d) => d.name).join('・')}に対し、本市で収束するリスク要因は乏しい` : '')
        return { lvl, severe, health, concerns, strengths, items, acts, text, feat, disLink, disText }
      }
      const allCities = regionData!.map((r) => r.city)
        .map((c) => ({ city: c, cost: costVals[c], ...considOf(c) }))
        .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1))
      if (allCities.length) {
        const muniSlides: PSlide[] = []
        // PowerPointの表は行高指定が「最小値」で、セル文字列の折り返しで行が自動伸長する。
        // 考察列(8.3in,fs10.5)は1行約45字。130字上限（≒3行）×6行で表下端が出典(y=7.18)に届かない
        // （文字を9→10.5ptに拡大した分、1行の字数が減るため上限を150→130字に調整）
        const CH = 6 // 1枚あたりの市町村数
        const clipTxt = (t: string) => (t.length > 130 ? t.slice(0, 129) + '…' : t)
        const pages = Math.ceil(allCities.length / CH)
        for (let i = 0; i < allCities.length; i += CH) {
          const chunk = allCities.slice(i, i + CH)
          const pageNo = Math.floor(i / CH) + 1
          muniSlides.push({
            heading: pages > 1 ? `市町村ごとの複合考察 一覧（${pageNo}/${pages}）` : '市町村ごとの複合考察 一覧',
            lead: i === 0
              ? `県内${allCities.length}市町村それぞれについて、県内中央値から最も乖離した指標＝その市町村の一番の特徴を起点に、なぜそうなっているのかを他の指標との組み合わせで考察した（国保医療費の高い順）。次ページ以降で1市町村ずつ詳説する。※SMR・平均余命は男女値の単純平均（基準人口が異なるため近似値）。`
              : '市町村ごとの複合考察 一覧の続き（国保医療費の高い順）。',
            bullets: [],
            visual: { kind: 'table', head: ['市町村', '国保医療費(円)', '複合的な考察（特徴と原因・健康・打ち手）'], rows: chunk.map((r) => [r.city, typeof r.cost === 'number' ? nfmt(r.cost) : '-', clipTxt(r.text)]), colW: [1.9, 1.9, 8.3], fs: 10.5, colAlign: ['center', 'right', 'left'] },
            source: SRC.ssds,
          })
        }
        const posOf = (o: Record<string, number>, d: ReturnType<typeof iqr>, c: string) => (isHi(o, d, c) ? '高め' : isLo(o, d, c) ? '低め' : '中位')
        // 県内中央値=1.0のレーダー。軸はその市町村で中央値から最も乖離した上位6指標＝市町村ごとに可変
        const radarFor = (items: { axis: string; ratio: number | null; dev: number }[], c: string): PVisual | null => {
          const sel = items.filter((i) => i.ratio != null).sort((a, b) => b.dev - a.dev).slice(0, 6)
          return sel.length >= 3
            ? { kind: 'radar', labels: sel.map((i) => i.axis), values: sel.map((i) => +(i.ratio as number).toFixed(2)), base: '県内中央値(=1.0)', self: c }
            : null
        }
        // 重要度スコア（健康課題＋課題の重なり＋医療費高）順。先頭を重点として扱い、全市町村を1枚ずつ考察
        const score = (r: { severe: number; concerns: unknown[]; lvl: string | null }) => r.severe * 2 + r.concerns.length + (r.lvl === '高い' ? 2 : 0)
        const ranked = [...allCities].sort((a, b) => score(b) - score(a) || ((b.cost ?? 0) - (a.cost ?? 0)))
        ranked.forEach((r, idx) => {
          const c = r.city
          const priority = r.severe > 0 || r.lvl === '高い'
          const isFocus = idx === 0 && (priority || r.concerns.length > 0)
          muniSlides.push({
            heading: `${isFocus ? '【重点】' : ''}${c}の複合考察`,
            // リードの主役は「その市町村で最も乖離した特徴とその原因仮説」（レーダーの筆頭軸と一致）。
            // SMR・余命・医療費は補足として箇条書き側が担う。左カラムは狭い(textW4.7)ためこれ以上は足さない
            lead: r.feat
              ? `${c}の最大の特徴は${r.feat.label}（${r.feat.ratioTxt}・県内でも${r.feat.emph}${r.feat.word}）。${r.feat.why ? `${r.feat.why}。` : ''}`
              : `${c}は県内中央値から大きく乖離した指標がなく、指標構成は平均的。${r.health.length ? `健康面は${r.health.join('・')}。` : ''}${r.lvl ? `医療費は県内で${r.lvl}。` : ''}`,
            bullets: [
              `健康：SMR ${nv(smrV[c])}（${posOf(smrV, dSmr, c)}）${Number.isFinite(lifeV[c]) ? `・余命 ${nv(lifeV[c])}歳（${posOf(lifeV, dLife, c)}）` : ''}`,
              `医療費：国保 ${typeof r.cost === 'number' ? nfmt(r.cost) : '-'}円（${r.lvl ? `県内${r.lvl}` : 'データなし'}）`,
              `課題：${r.concerns.length ? r.concerns.slice(0, 2).map((i) => `${i.label} ${nv(i.v)}${i.unit}`).join('・') : '小さい'}${r.strengths.length ? `／良好 ${r.strengths.slice(0, 2).map((i) => i.label).join('・')}` : ''}`,
              `疾病リンク：${r.disLink.length ? r.disLink.map((x) => `${x.dis}←${x.hit.join('・')}（信頼度${x.conf}）`).join('／') : '県の高位疾病に収束する要因は乏しい'}`,
              `打ち手：${r.acts.length ? r.acts.slice(0, 2).join('・') : '現状維持・経過観察'}`,
            ],
            note: `疾病リンクは因果チェーン仮説で相関≠因果。SMR・余命は男女単純平均（近似）。図は県内中央値=1.0で特徴的な指標を軸に表示。${priority ? '健康・医療費の両面で優先度が高いと考えられる。' : '大きな課題は目立たないが予防の維持が望ましい。'}`,
            visual: radarFor(r.items, c),
            source: SRC.ssds,
          })
        })
        push('市町村ごとの複合考察と提案', muniSlides)
      }
    }

    // ── 5. まとめ（コンサル的に具体的な保健事業を提案）──
    const costRows = Object.entries(costVals).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    const admS = natInfo('admit_rate'); const chkS = natInfo('checkup_rate'); const guiS = natInfo('guidance_rate')
    const renalIn = natInfo('dis_renal_in'); const diabIn = natInfo('dis_diabetes_in')
    // グラフ（県内市町村別 国保医療費）と提案を紐づける：上位2市町村を名指しし、
    // 中央値との比較を根拠として添える。以前は「ハイリスク市町村への資源集中」という
    // 市町村名なしの箇条書きだったが、下のslice上限からあふれて実際には表示されていなかった
    // （2026-07-18 PPTXを実レンダリングして発見）。先頭に置くことで必ず表示されるようにする
    const topMuni = costRows.slice(0, 2)
    const costSorted = costRows.map((r) => r.value).slice().sort((a, b) => a - b)
    const costMed = costSorted.length ? costSorted[Math.floor(costSorted.length / 2)] : 0
    // データ起点で提案する具体的な保健事業（条件に該当するものから）
    const actions: string[] = []
    if (topMuni.length >= 2) {
      const diffPct = costMed > 0 ? Math.round((topMuni[0].value / costMed - 1) * 100) : null
      actions.push(`特に${topMuni.map((r) => r.name).join('・')}は国保医療費が県内で最も高く（${topMuni.map((r) => `${r.name} ${nfmt(r.value)}円`).join('・')}）${diffPct != null ? `、県内中央値(${nfmt(costMed)}円)を+${diffPct}%上回る` : ''}。重症化予防・在宅医療連携などの重点投入先として優先的に検討する`)
    }
    if ((renalIn?.ratio ?? 0) > 1.15 || (diabIn?.ratio ?? 0) > 1.15)
      actions.push('糖尿病性腎症重症化予防プログラム：レセプトと健診のデータから「血糖値が高いのに治療していない人」を見つけ、専門の指導員が数か月寄り添う。人工透析になるのを遅らせられる可能性があり、費用対効果が高いとされる')
    if (admS && admS.ratio && admS.ratio > 1)
      actions.push('在宅療養支援・退院支援連携事業：本来は避けられる入院を在宅・外来に移すことで、入院への偏りと入院医療費の抑制につながる可能性がある')
    if (chkS && chkS.ratio && chkS.ratio < 1)
      actions.push('特定健診受診率向上事業：受けていない人への分かりやすい個別案内・休日夜間の健診・がん検診との同時実施で、受診率の底上げが見込める')
    if (guiS && guiS.ratio && guiS.ratio < 1)
      actions.push('特定保健指導の実施率改善：オンラインを使った個別指導や職場との連携で途中離脱を防ぎ、発症前の対応の強化につながると考えられる')
    actions.push('重複服薬・頻回受診の適正化事業：レセプト分析でポリファーマシー該当者を抽出し、かかりつけ薬局・医と連携して服薬管理')
    // 総括（複合分析からの考察）：高医療費の背景に絡む要因を県データから組み立てる
    const agM = natInfo('aging_rate'); const bedM = natInfo('beds_per_100k')
    const factors: string[] = []
    if (agM && agM.ratio && agM.ratio > 1) factors.push('高齢化の高さ')
    if (bedM && bedM.ratio && bedM.ratio > 1) factors.push('病床（ベッド）の多さ')
    if (admS && admS.ratio && admS.ratio > 1) factors.push('入院の多さ')
    if (disRows[0]) factors.push(`${disRows[0].name}など生活習慣病の重症化`)
    if (chkS && chkS.ratio && chkS.ratio < 1) factors.push('予防（健診）の弱さ')
    const facTxt = factors.length ? factors.join('・') : '複数の要因'
    const synth = `${sel.name}において、医療費が高い背景には ${facTxt} が重なって絡んでいると推察される。年齢構成で説明できる部分を除いても、入院や予防の課題が残ると考えられる。さらに県内では市町村ごとに状況が異なり、課題は地域によって違う。`
    const synthBullets: string[] = []
    if (agM && agM.ratio && agM.ratio > 1) synthBullets.push('高齢化が土台にあり、医療の需要そのものが大きい')
    if (admS && admS.ratio && admS.ratio > 1) synthBullets.push(`入院が多く医療費を押し上げている${bedM && bedM.ratio && bedM.ratio > 1 ? '（病床の多さが背景の可能性）' : ''}`)
    if (disRows[0]) synthBullets.push(`入院の中身は${disRows[0].name}など生活習慣病の重症化が中心`)
    if (chkS && chkS.ratio && chkS.ratio < 1) synthBullets.push('予防（健診）が弱く、重症化を防ぎきれていない可能性')
    synthBullets.push('県内では医療費・健診・所得・就業構造に市町村差があり、課題は地域ごとに異なる')
    // 市町村数が多い(>20)県は、横棒1枚に収めるとラベルが間引かれ読みにくくなる（2026-07-18実測で判明）。
    // 20件を境に「提案（文章）」と「グラフ（縦棒・全幅1枚）」を2枚に分割し、少ない県は従来通り1枚に収める
    const muniChartTitle = '県内市町村別 国保 一人当たり医療費（令和5年度）'
    const proposalSlide: PSlide = {
      heading: '提案する保健事業',
      lead: costRows.length > 20
        ? `総括の考察をふまえ、${sel.name}に提案する保健事業をまとめる。データは次ページの県内市町村別グラフの上位市町村が優先対象に対応する。`
        : `総括の考察をふまえ、${sel.name}に提案する保健事業をまとめる。グラフは県内市町村別の国保一人当たり医療費で、右のグラフの上位市町村が下の提案の優先対象に対応する。`,
      // actionsは最大6件（条件付き5＋末尾の無条件push）。slice(0,5)で末尾の無条件push分
      // （重複服薬・頻回受診の適正化事業）が切れて表示されない不具合があったため上限を撤廃。
      // はみ出し対策は renderContent 側のフォント自動縮小に委ねる（2026-07-18修正）
      bullets: actions,
      note: `${topMuni.length >= 2 ? `${topMuni.map((r) => r.name).join('・')}を含む` : ''}ハイリスク市町村に資源を集中し、対象・目標・検証時期を定めて効果を確かめる（PDCA）。`,
      visual: costRows.length && costRows.length <= 20
        ? { kind: 'bar', labels: costRows.map((r) => r.name), values: costRows.map((r) => r.value), title: muniChartTitle, unit: '円' }
        : null,
      source: costRows.length <= 20 ? SRC.iryomap : undefined,
    }
    const muniChartSlide: PSlide | null = costRows.length > 20 ? {
      heading: muniChartTitle,
      lead: `${sel.name}内${costRows.length}市町村の国保一人当たり医療費（令和5年度・降順）。上位市町村が前ページの提案の優先対象に対応する。`,
      bullets: [],
      visual: { kind: 'bar', labels: costRows.map((r) => r.name), values: costRows.map((r) => r.value), title: muniChartTitle, unit: '円', full: true },
      source: SRC.iryomap,
    } : null
    sections.push({
      title: 'まとめ／総括と提案',
      slides: [
        {
          heading: '総括 — 複合分析からの考察',
          lead: synth,
          bullets: synthBullets.slice(0, 5),
          note: '次のスライドで、この考察にもとづく具体的な保健事業を提案する。',
          visual: null,
          source: SRC.est,
        },
        proposalSlide,
        ...(muniChartSlide ? [muniChartSlide] : []),
      ],
    })

    // 目次の次に置くエグゼクティブサマリー（資料全体の要点）
    const summary: string[] = []
    if (ko) summary.push(`国保の一人当たり医療費は全国${ko.rank}位/47と「${ko.j}」水準にあり、全国比${pctDiff(ko.v, ko.avg)}となっている（令和5年度）。${kk ? `後期高齢者医療は全国${kk.rank}位。` : ''}`)
    if (admS) summary.push(`入院受療率は${admS.natLbl}${pctDiff(admS.v, admS.avg)}で「${admS.j}」水準にある。${renalIn?.ratio ? `特に腎不全による入院は${renalIn.natLbl}${pctDiff(renalIn.v, renalIn.avg)}と突出している。` : ''}`)
    if (chkS) summary.push(`特定健診の実施率は${chkS.natLbl}${pctDiff(chkS.v, chkS.avg)}で「${chkS.j}」水準にあり、早期介入の面で課題がある。`)
    if (corrs[0]) summary.push(`医療費と最も強く相関するのは「${corrs[0].lbl}」（相関係数r=${corrs[0].r}）で、相関は因果関係を意味しない点に留意が必要である。`)
    if (costRows.length > 1) {
      // 最低値が0以下なら倍率は無意味な巨大値になるため出さない（差額も出せるが要点なので省略）
      const loCost = costRows[costRows.length - 1].value
      summary.push(`県内では市町村間で医療費に差があり、最も高い${costRows[0].name}と最も低い${costRows[costRows.length - 1].name}${loCost > 0 ? `では約${(costRows[0].value / loCost).toFixed(1)}倍の開きがある。` : `との間に差がある。`}`)
    }
    summary.push('こうした状況を踏まえ、重症化予防・受診率向上・在宅療養支援・服薬適正化といった保健事業を、リスクの高い市町村へ重点的に配分することを提案する（詳細は本編）。')

    // 「市町村ごとの複合考察」は分量が多いため、本編（まとめ／総括と提案）の後ろに参考資料として回す。
    // タイトル文字列は変えず、中扉側で REFERENCE_SECTION_TITLE と一致するかで【参考】表示に切り替える
    const muniSecIdx = sections.findIndex((s) => s.title === '市町村ごとの複合考察と提案')
    if (muniSecIdx >= 0 && muniSecIdx < sections.length - 1) {
      const [muniSec] = sections.splice(muniSecIdx, 1)
      sections.push(muniSec)
    }

    return { title: `${sel.name} データヘルス分析`, subtitle: '医療費と地域要因の可視化（全国比較・疾病・医療資源・予防・社会要因・県内市町村）', summary, sections }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [japanGeo, cityGeo, regionData, prefectures, selected, radarAxes, muniGeoUrl, natAvgMap, municipalities, medCost, metricCatalog])
  pairedDeckRef.current = pairedDeck

  // Claudeに渡す構造化サマリー（トークン節約＋論点提示）
  const summary = useMemo(() => {
    // 医療費は国保 一人当たり医療費(R5,円)で分析する（国民医療費は用いない）
    const medMap: Record<string, number> = {}
    medCost.forEach((d) => { if (Number.isFinite(d.kokuho) && d.kokuho > 0) medMap[d.name] = d.kokuho })
    const withCost = prefectures
      .map((p) => ({ name: p.name, cost: medMap[p.name], m: p.metrics }))
      .filter((d) => typeof d.cost === 'number')
    const sorted = [...withCost].sort((a, b) => b.cost - a.cost)
    const correlations = DRIVERS.map((d) => {
      const pair = withCost.filter((p) => typeof p.m[d.k] === 'number')
      const r = corr(pair.map((p) => p.m[d.k]), pair.map((p) => p.cost))
      // 計算不能(null)は「r=0」と偽の事実をAIに渡さないため除外する
      return r != null ? { 要因: d.label, r: +r.toFixed(2) } : null
    }).filter((x): x is { 要因: string; r: number } => !!x).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    const natAvg = KOKUHO_NAT // 国保の真の全国値(円,R5)
    const sel = selected ? prefectures.find((p) => p.name === selected) : null
    const selRank = sel ? sorted.findIndex((d) => d.name === sel.name) + 1 : 0
    const selCost = sel ? medMap[sel.name] ?? null : null
    return {
      分析の焦点: sel ? `${sel.name}（この県を主役に分析する）` : '全国俯瞰',
      分析対象県: sel
        ? {
            県: sel.name,
            国保医療費R5: selCost,
            全国順位: selRank > 0 ? `${selRank}/${sorted.length}位（高い順）` : '不明（国保医療費データなし）',
            全国との差: natAvg != null && typeof selCost === 'number' ? +(selCost - natAvg).toFixed(0) : null,
            指標: sel.metrics,
          }
        : null,
      全国比較用_対象: '都道府県別 国保 一人当たり医療費(R5, 円) と要因',
      医療費_高い順TOP5: sorted.slice(0, 5).map((d) => ({ 県: d.name, 国保医療費: d.cost })),
      医療費_低い順TOP5: sorted.slice(-5).reverse().map((d) => ({ 県: d.name, 国保医療費: d.cost })),
      全国国保医療費: natAvg,
      医療費との相関_絶対値順: correlations,
      市町村_国保医療費_高い順TOP5: municipalities.slice(0, 5),
      市町村_国保医療費_低い順TOP5: municipalities.slice(-5).reverse(),
      // 選択県に市町村データがあれば県内ばらつきを同梱（全国→県→市町村の複合分析用）
      県内市町村比較: regionData && regionData.length
        ? {
            県: selected,
            市町村数: regionData.length,
            主要指標_市町村別: regionData.map((r) => {
              const pick = (label: string) => r.metrics.find((x) => x.label === label)?.value ?? null
              return {
                市町: r.city,
                高齢化率: pick('高齢化率(%)'),
                人口: pick('人口'),
                医師数10万対: pick('医師数(人口10万対)'),
                病床数10万対: pick('病院病床数(人口10万対)'),
                課税対象所得_千円: pick('納税義務者1人当課税対象所得'), // 単位は千円（AIが円と誤解して1/1000の金額を書かないようキー名に明示）
                第1次産業比率: pick('第1次産業就業者比率(%)'),
              }
            }),
          }
        : null,
      // focus_metrics選定用：keyと全国平均・対象県値（末尾JSONのfocus_metricsはここのkeyから選ぶ）
      metric_catalog: sel
        ? metricCatalog
            .filter((mm) => mm.k !== 'per_capita_cost' && natAvgMap[mm.k])
            .map((mm) => ({
              key: mm.k,
              指標: mm.label,
              全国平均: +natAvgMap[mm.k].toFixed(1),
              // 基準: 真の全国値（e-Stat全国行）か、未取得で47県単純平均かをAIに明示する
              基準: typeof NATIONAL[mm.k] === 'number' ? '全国実数値' : '47県単純平均',
              対象県: typeof getM(sel, mm.k) === 'number' ? +(getM(sel, mm.k) as number).toFixed(1) : null,
              全国比: typeof getM(sel, mm.k) === 'number' ? +((getM(sel, mm.k) as number) / natAvgMap[mm.k]).toFixed(2) : null,
            }))
        : metricCatalog.filter((mm) => mm.k !== 'per_capita_cost' && natAvgMap[mm.k]).map((mm) => ({ key: mm.k, 指標: mm.label })),
      留意点: '外来疾病は外来のみ・年齢調整なし・市町村は国保医療費R5(2023)・相関は因果でない',
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefectures, municipalities, selected, regionData, metricCatalog, natAvgMap, medCost])

  async function call(mode: string, payload: any) {
    setErr('')
    setBusy(mode)
    try {
      // payload に編集済みsystem_promptを同梱（route側でデフォルトより優先される）
      const res = await fetch('/api/insight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, payload: { ...payload, systemPrompt: prompts[mode] } }),
      })
      // JSON以外（Vercelのタイムアウト等のプレーンエラー）でも落ちないよう防御的にparse
      const raw = await res.text()
      let j: any = null
      try { j = raw ? JSON.parse(raw) : null } catch { /* not JSON */ }
      if (!res.ok || !j || typeof j.text !== 'string') {
        const base = j?.error ?? (raw ? raw.slice(0, 200) : `HTTP ${res.status}`)
        const hint = res.status === 504 || /timeout|timed out|An error o/i.test(raw) ? '（生成が長すぎてタイムアウトした可能性）' : ''
        throw new Error(`${base}${hint}`)
      }
      return j.text as string
    } catch (e: any) {
      setErr(e?.message ?? String(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  // 戻り値の生成テキストを返す（genAllが state 更新を待たずに次工程へ渡せるように）
  async function genInsight() {
    const t = await call('insight', { data: summary })
    if (!t) return null
    const { keys, clean } = extractFocus(t)
    setFocusKeys(keys)
    setInsight(clean)
    setReport(''); setSlidesMd('')
    return clean
  }
  // insightText省略時はstateのinsightを使う（②単体ボタン用）。genAllからは直前に生成した文字列を渡す
  async function genReport(insightText?: string) {
    const t = await call('report', { data: summary, insight: insightText ?? insight })
    if (t) { setReport(t); setSlidesMd('') }
    return t
  }
  // ③スライド化：AIを呼ばずpairedDeck(データ駆動)からプレビューmdを組む（高速・確実・整合）
  function genSlides() {
    if (!pairedDeck || !pairedDeck.sections.length) { setErr('スライドには県の選択が必要ニャ（地図クリック or ドロップダウンで選択）'); return }
    // PPTX側(目次・中扉)と同じ番号方式：参考資料は【参考】固定、出典は【出典】固定で番号カウントに含めない
    const toc = `## 目次\n${pairedDeck.sections.map((s, i) => `- ${s.title === REFERENCE_SECTION_TITLE ? '【参考】' : i + 1}. ${s.title}`).join('\n')}\n- 【出典】 出典・データソース`
    const body = pairedDeck.sections.map((sec, i) =>
      `## ■ ${sec.title === REFERENCE_SECTION_TITLE ? '【参考】' : i + 1}. ${sec.title}\n\n` + sec.slides.map((s) =>
        `### ${s.heading}\n${s.lead}\n${s.bullets.map((b) => `- ${b}`).join('\n')}${s.note ? `\n\n→ 示唆: ${s.note}` : ''}${s.source ? `\n\n出典: [${s.source.label}](${s.source.url})` : ''}`,
      ).join('\n\n'),
    ).join('\n\n---\n\n')
    const sumMd = pairedDeck.summary.length ? `## エグゼクティブサマリー\n${pairedDeck.summary.map((b) => `- ${b}`).join('\n')}\n\n---\n\n` : ''
    const srcMd = `## 出典・データソース\n${SOURCES.map(([n, u]) => `- ${n}\n  ${u}`).join('\n')}`
    const md = `# ${pairedDeck.title}\n${pairedDeck.subtitle}\n\n---\n\n${toc}\n\n---\n\n${sumMd}${body}\n\n---\n\n${srcMd}`
    setSlidesMd(md)
    setErr('')
    openSlides(md)
  }
  // 二重実行ガードはrefで持つ（saving stateはレンダー時のクロージャ値のため同一フレーム内の連打を防げない）
  const pptxBusy = useRef(false)
  async function doPptx() {
    // ref経由で読む：genAllの一括実行中は直前のsetFocusKeys等がまだ再レンダーを
    // 経ていない可能性があり、この関数自身のクロージャの pairedDeck は古い値のままになりうる
    const deck = pairedDeckRef.current
    if (!deck || pptxBusy.current) return
    pptxBusy.current = true
    setSaving(true)
    try { await downloadPptx(deck); flash('PPTXをダウンロードしたニャ') }
    catch (e) { console.error('pptx error', e); flash('PPTX生成に失敗ニャ') }
    finally { setSaving(false); pptxBusy.current = false }
  }
  // ①→②→③を一括実行。途中でAI呼び出しが失敗したら次工程には進まない（errはcall()内で表示済み）
  async function genAll() {
    if (runningAll || busy || saving || pptxBusy.current) return
    // 開始時点の県を固定し、各ステップの待機中に県が切り替わっていたら中断する
    // （旧県のinsight/reportと新県のPPTXが混在する不整合成果物を防ぐ）
    const startedFor = selectedRef.current
    setRunningAll(true)
    try {
      const clean = await genInsight()
      if (clean == null) return
      if (selectedRef.current !== startedFor) { flash('県が変更されたため一括生成を中断したニャ'); return }
      const rep = await genReport(clean)
      if (rep == null) return
      if (selectedRef.current !== startedFor) { flash('県が変更されたため一括生成を中断したニャ'); return }
      await doPptx()
    } finally {
      setRunningAll(false)
    }
  }

  const btn = (on: boolean): React.CSSProperties => ({
    padding: '8px 12px', borderRadius: 7, fontSize: 13, fontWeight: 600,
    border: '1px solid #2f6fb0', cursor: on ? 'pointer' : 'not-allowed',
    background: on ? '#2f6fb0' : '#c2d2e6', color: '#fff',
  })
  const smallBtn: React.CSSProperties = {
    padding: '3px 9px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
    border: '1px solid #c2d2e6', background: '#fff', color: '#2f6fb0',
  }

  // 連続flash時に前のタイマーが後発の通知を早消ししないよう、タイマーidを持ってclearしてから張り直す
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function flash(msg: string) {
    setNotice(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setNotice(''), 2000)
  }

  async function doSave(kind: 'insight' | 'report' | 'slides', content: string) {
    if (saving) return
    setSaving(true)
    try { await saveOutput({ kind, content }); flash('Convexに保存したニャ') }
    catch { flash('Convex保存に失敗ニャ') }
    finally { setSaving(false) }
  }

  // 保存ボタン群（.mdダウンロード＋コピー＋Convex永続保存）
  function SaveBar({ kind, name, text }: { kind: 'insight' | 'report' | 'slides'; name: string; text: string }) {
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <button style={smallBtn} onClick={() => { download(name, text); flash(`${name} を保存したニャ`) }}>⬇ .md保存</button>
        <button style={smallBtn} onClick={async () => flash((await copyText(text)) ? 'コピーしたニャ' : 'コピー失敗ニャ')}>📋 コピー</button>
        <button
          style={{ ...smallBtn, color: '#1f9d57', borderColor: '#bfe6cd', opacity: saving ? 0.5 : 1 }}
          disabled={saving}
          onClick={() => doSave(kind, text)}
        >💾 Convexに保存</button>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #d6e0ee', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 14 }}>🤖 AIインサイト → レポート → スライド</h2>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, color: '#5d6f8c' }}>
        Claude 3.5 Sonnet（fal.ai経由）が今のデータを読み、示唆→提案レポート→スライドを生成。{selected ? `（${selected}を含めて分析）` : '（県クリックで対象を絞れる）'}
      </p>

      <button style={{ ...smallBtn, marginBottom: 8 }} onClick={() => setShowPrompts((v) => !v)}>
        {showPrompts ? '▲ プロンプト編集を閉じる' : '⚙ プロンプトを編集'}
      </button>
      {showPrompts && (
        <div style={{ marginBottom: 10, padding: 10, background: '#f6f9fc', border: '1px solid #e1e9f3', borderRadius: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#5d6f8c' }}>
            各モードのAIへの指示文（system_prompt）を編集できるニャ。変更はブラウザに保存され、次回も保持されるニャ。
          </p>
          {MODES.map((m) => (
            <div key={m} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#1b2740' }}>{PROMPT_LABELS[m]}</label>
                <button
                  style={{ ...smallBtn, opacity: prompts[m] === DEFAULT_PROMPTS[m] ? 0.5 : 1 }}
                  disabled={prompts[m] === DEFAULT_PROMPTS[m]}
                  onClick={() => resetPrompt(m)}
                >↺ デフォルトに戻す</button>
              </div>
              <textarea
                value={prompts[m]}
                onChange={(e) => updatePrompt(m, e.target.value)}
                rows={4}
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 11.5, lineHeight: 1.5, padding: 6, border: '1px solid #d6e0ee', borderRadius: 6, resize: 'vertical', fontFamily: 'inherit' }}
              />
              {/* サーバー側(route.ts)が8,000字で切り詰めるため、超過を警告する（末尾のfocus_metrics指示が切れると軸選抜が静かに失われる） */}
              <div style={{ fontSize: 10.5, textAlign: 'right', color: prompts[m].length > 8000 ? '#c0392b' : '#8a98ad' }}>
                {prompts[m].length.toLocaleString('ja-JP')}字{prompts[m].length > 8000 ? '（⚠ 8,000字を超えた分はAIに渡らないニャ。末尾の指示が切れるニャ）' : '／上限8,000字'}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          style={{ ...btn(!busy && !!pairedDeck && !saving && !runningAll), background: (busy || !pairedDeck || saving || runningAll) ? '#c2d2e6' : '#1f9d57', borderColor: '#1f9d57' }}
          disabled={!!busy || !pairedDeck || saving || runningAll}
          onClick={genAll}
          title={!pairedDeck ? '県を選択すると有効' : '①→②→③を順番に自動実行するニャ'}
        >{runningAll ? `一括生成中…(${busy ?? (saving ? 'PPTX' : '')})` : '🚀 ①→②→③ 一括生成'}</button>
        <button style={btn(!busy && !runningAll)} disabled={!!busy || runningAll} onClick={genInsight}>
          {busy === 'insight' ? '生成中…' : '① AIインサイト生成'}
        </button>
        <button style={btn(!busy && !runningAll && !!insight)} disabled={!!busy || runningAll || !insight} onClick={() => genReport()}>
          {busy === 'report' ? '作成中…' : '② レポート作成'}
        </button>
        <button
          style={{ ...btn(!busy && !!pairedDeck && !saving && !runningAll), background: (busy || !pairedDeck || saving || runningAll) ? '#c2d2e6' : '#b8541f', borderColor: '#b8541f' }}
          disabled={!!busy || !pairedDeck || saving || runningAll}
          onClick={doPptx}
          title={!pairedDeck ? '県を選択すると有効' : ''}
        >{saving ? '生成中…' : '③ PPTXダウンロード'}</button>
      </div>

      {err && <div style={{ color: '#c0392b', fontSize: 12, marginBottom: 8 }}>⚠ {err}</div>}
      {notice && <div style={{ color: '#1f9d57', fontSize: 12, marginBottom: 8 }}>✓ {notice}</div>}

      {insight && (
        <details open style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#2f6fb0' }}>インサイト</summary>
          <div style={mdBox} dangerouslySetInnerHTML={{ __html: mdToHtml(insight) }} />
          <SaveBar kind="insight" name="insight.md" text={insight} />
        </details>
      )}

      {pairedDeck && (
        <details open style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#b8541f' }}>
            📊 スライド内容プレビュー（{selected}・{pairedDeck.sections.length}セクション／文章＋可視化セット）
          </summary>
          <div style={{ fontSize: 11, color: '#5d6f8c', margin: '6px 0' }}>
            目次：{pairedDeck.sections.map((s, i) => `${i + 1}.${s.title}`).join(' / ')}
          </div>
          {pairedDeck.summary.length > 0 && (
            <div style={{ background: '#eef4fb', border: '1px solid #cfe0f3', borderRadius: 7, padding: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: '#388052', marginBottom: 5, fontSize: 12.5 }}>エグゼクティブサマリー（目次の次）</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.6, color: '#1b2740' }}>
                {pairedDeck.summary.map((b, i) => (<li key={i}>{b}</li>))}
              </ul>
            </div>
          )}
          {pairedDeck.sections.map((sec, si) => (
            <div key={si} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#388052', borderRadius: 6, padding: '4px 8px', marginBottom: 6 }}>{si + 1}. {sec.title}</div>
              {sec.slides.map((sl, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, background: '#fff', border: '1px solid #e1e9f3', borderRadius: 7, padding: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#388052', marginBottom: 4 }}>{sl.heading}</div>
                    <div style={{ fontSize: 11, color: '#5d6f8c', marginBottom: 5 }}>{sl.lead}</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.6, color: '#1b2740' }}>
                      {sl.bullets.map((b, j) => (<li key={j}>{b}</li>))}
                    </ul>
                    {sl.note && <div style={{ fontSize: 11, color: '#1b2740', marginTop: 5, paddingTop: 5, borderTop: '1px solid #eef3f9' }}><b style={{ color: '#8AC8A1' }}>→ 示唆:</b> {sl.note}</div>}
                    {sl.source && <div style={{ fontSize: 10, color: '#8a98ad', marginTop: 4 }}>出典: <a href={sl.source.url} target="_blank" rel="noreferrer" style={{ color: '#2f6fb0' }}>{sl.source.label}</a></div>}
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                    {sl.visual?.kind === 'image' && <div dangerouslySetInnerHTML={{ __html: sl.visual.svg }} />}
                    {sl.visual?.kind === 'radar' && <Radar axes={sl.visual.labels.map((l, k) => ({ label: l, ratio: (sl.visual as any).values[k] }))} baseLabel={(sl.visual as any).base} selfLabel={(sl.visual as any).self} />}
                    {sl.visual?.kind === 'bar' && <BarH rows={sl.visual.labels.map((l, k) => ({ name: l, value: (sl.visual as any).values[k] }))} />}
                    {sl.visual?.kind === 'table' && (
                      <table style={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
                        <thead><tr>{sl.visual.head.map((h, k) => (<th key={k} style={{ background: '#388052', color: '#fff', padding: '3px 5px', border: '1px solid #d6e0ee' }}>{h}</th>))}</tr></thead>
                        <tbody>{sl.visual.rows.map((r, ri) => (<tr key={ri}>{r.map((c, ci) => (<td key={ci} style={{ padding: '3px 5px', border: '1px solid #e1e9f3', textAlign: ci === 0 ? 'center' : 'left' }}>{c}</td>))}</tr>))}</tbody>
                      </table>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#1b2740', background: '#f6f9fc', border: '1px solid #e1e9f3', borderRadius: 7, padding: 8 }}>
            <div style={{ fontWeight: 700, color: '#388052', marginBottom: 4 }}>出典・データソース（巻末）</div>
            {SOURCES.map(([n, u], i) => (
              <div key={i} style={{ marginBottom: 3 }}>・{n}<br /><a href={u} target="_blank" rel="noreferrer" style={{ color: '#2f6fb0' }}>{u}</a></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button style={smallBtn} onClick={genSlides}>▶ reveal形式でプレビュー表示</button>
            <span style={{ fontSize: 11, color: '#8a98ad' }}>※上の「③ PPTXダウンロード」でこの内容が PowerPoint になるニャ</span>
          </div>
        </details>
      )}
      {report && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#2f6fb0' }}>提案レポート</summary>
          <div style={mdBox} dangerouslySetInnerHTML={{ __html: mdToHtml(report) }} />
          <SaveBar kind="report" name="report.md" text={report} />
        </details>
      )}
      {slidesMd && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#2f6fb0' }}>スライド(Markdown)</summary>
          <SaveBar kind="slides" name="slides.md" text={slidesMd} />
        </details>
      )}

      {savedList && savedList.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#1f9d57' }}>
            💾 保存済み（Convex・{savedList.length}件）
          </summary>
          <div style={{ marginTop: 6 }}>
            {savedList.map((it) => (
              <div key={it._id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid #eef3f9', fontSize: 12 }}>
                <span style={{ flex: 1 }}>
                  <b>{PROMPT_LABELS[it.kind] ?? it.kind}</b>{' '}
                  <span style={{ color: '#5d6f8c' }}>{new Date(it.createdAt).toLocaleString('ja-JP')}</span>
                </span>
                <button
                  style={smallBtn}
                  onClick={() => {
                    if (it.kind === 'insight') {
                      // 旧保存分に末尾JSONが残っていればfocusKeysも復元する（無ければ[]→レーダーは自動選抜に戻す）
                      const { keys, clean } = extractFocus(it.content)
                      setInsight(clean); setFocusKeys(keys)
                    }
                    else if (it.kind === 'report') setReport(it.content)
                    else if (it.kind === 'slides') { setSlidesMd(it.content); openSlides(it.content) }
                    flash('読み込んだニャ')
                  }}
                >開く</button>
                <button
                  style={{ ...smallBtn, color: '#c0392b', borderColor: '#f0c7c2', opacity: saving ? 0.5 : 1 }}
                  disabled={saving}
                  onClick={async () => { if (saving) return; setSaving(true); try { await removeOutput({ id: it._id }); flash('削除したニャ') } catch { flash('削除に失敗ニャ') } finally { setSaving(false) } }}
                >削除</button>
              </div>
            ))}
          </div>
        </details>
      )}

      {previewHtml && (
        <div
          onClick={() => setPreviewHtml(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(960px, 92vw)', height: 'min(620px, 86vh)', background: '#fff', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e9f3' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1b2740' }}>スライドプレビュー（矢印キーで送り）</span>
              <button style={{ ...btn(true), padding: '4px 10px', fontSize: 12 }} onClick={() => setPreviewHtml(null)}>✕ 閉じる</button>
            </div>
            <iframe title="slides" srcDoc={previewHtml} sandbox="allow-scripts" style={{ flex: 1, border: 'none', width: '100%' }} />
          </div>
        </div>
      )}
    </div>
  )
}

const mdBox: React.CSSProperties = {
  fontSize: 12.5, lineHeight: 1.7, color: '#1b2740', marginTop: 8,
  maxHeight: 360, overflowY: 'auto', padding: '4px 10px',
  background: '#f6f9fc', border: '1px solid #e1e9f3', borderRadius: 7,
}
