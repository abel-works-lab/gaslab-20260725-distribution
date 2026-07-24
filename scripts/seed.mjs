// data/facts_00.json を Convex に投入するスクリプト
// 使い方: webapp/ で `npx convex dev` を一度起動(コード反映)した後、`node scripts/seed.mjs`
// seed:seed は internalMutation（外部クライアントから呼べない）のため、管理者キーが必要。
// 環境変数 CONVEX_DEPLOY_KEY か .env.local の CONVEX_DEPLOY_KEY=... に設定しておく
// （Convexダッシュボード → Settings → Deploy Keys で発行。devとprodで別キー）。
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// 前後の空白・引用符(' や ")を取り除く（貼り付け時に付きがちなため）
function stripQuotes(value) {
  return value.trim().replace(/^['"]|['"]$/g, '').trim()
}

// 環境変数 → .env.local の順で参照する
function envVar(name) {
  if (process.env[name]) return stripQuotes(process.env[name])
  const p = path.join(root, '.env.local')
  if (fs.existsSync(p)) {
    const txt = fs.readFileSync(p, 'utf-8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(new RegExp('^' + name + '=(.+)$'))
      if (m) {
        const value = stripQuotes(m[1])
        if (value) return value
      }
    }
  }
  throw new Error(`${name} が環境変数にも .env.local にもありません`)
}

// facts_01: cost_by_yearをR3-R5にトリム・muni_kokuho空(国保2019は退避→muniStats R5へ)
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'facts_01.json'), 'utf-8'))

const prefectures = data.prefs.map((name) => ({
  name,
  metrics: data.facts[name] ?? {},
  costByYear: data.cost_by_year[name] ?? {},
}))
const municipalities = data.muni_kokuho.map((d) => ({ name: d.name, value: d.value }))

const client = new ConvexHttpClient(envVar('NEXT_PUBLIC_CONVEX_URL'))
// internalMutation を呼ぶための管理者認証（Convex CLI と同じ仕組み）
client.setAdminAuth(envVar('CONVEX_DEPLOY_KEY'))
const res = await client.mutation(internal.seed.seed, { prefectures, municipalities })
console.log('seeded:', res)
