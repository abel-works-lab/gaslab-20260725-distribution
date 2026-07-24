// data/region_factors_yamaguchi_00.json を Convex の regionFactors に投入。
// 使い方: webapp/ で `npx convex dev` を一度起動(スキーマ反映)した後、`node scripts/seed_region.mjs`
// seedRegion は internalMutation（外部クライアントから呼べない）のため、管理者キーが必要。
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

// all_02: 山口・奈良・島根の3県(77市町村)・各指標に年度付与
const rows = JSON.parse(
  fs.readFileSync(path.join(root, 'data', 'region_factors_all_02.json'), 'utf-8')
)

const client = new ConvexHttpClient(envVar('NEXT_PUBLIC_CONVEX_URL'))
// internalMutation を呼ぶための管理者認証（Convex CLI と同じ仕組み）
client.setAdminAuth(envVar('CONVEX_DEPLOY_KEY'))
const res = await client.mutation(internal.seedRegion.seedRegion, { rows })
console.log('seeded regionFactors:', res)
