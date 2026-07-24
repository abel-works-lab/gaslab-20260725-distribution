// 参加者向けの環境構築セットアップスクリプト。`npm run setup` から実行する。
//
// 自動化する範囲: npm install / .env.local雛形生成・不足分の補完 / Convexプロジェクトの
//              作成・コード反映 / データseed投入
// 自動化しない範囲（参加者本人の操作が必須）:
//   - WorkOSアカウント作成・Application作成・API Key/Client IDの取得
//   - fal.aiアカウント作成・API Key（FAL_KEY）の取得（AIインサイト/レポート/PPTX生成に必須）
//   - Convexログイン（ブラウザでのOAuth承認）
//   - ConvexダッシュボードでのDeploy Key発行
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const envPath = path.join(root, '.env.local')

// package.jsonのdevスクリプトが使う --use-system-ca フラグに、お使いのNode.jsが対応しているか
// 実際に試して確認する（対応バージョンはNode.jsのリリースにより異なり決め打ちできないため）。
// 対応していないと npm run dev が「bad option」で分かりにくく失敗するので、ここで先に止める。
const flagCheck = spawnSync(process.execPath, ['--use-system-ca', '-e', 'process.exit(0)'])
if (flagCheck.status !== 0) {
  console.error(`✗ お使いのNode.js（v${process.versions.node}）は --use-system-ca フラグに対応していません。`)
  console.error('このプロジェクトの npm run dev はこのフラグを使用します。')
  console.error('https://nodejs.org/ から最新のNode.js（LTS）に更新してから再実行してください。')
  process.exit(1)
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.error) {
    console.error(`\n✗ 実行できませんでした: ${cmd} ${args.join(' ')}`)
    console.error(res.error.message)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`\n✗ 失敗しました: ${cmd} ${args.join(' ')}`)
    console.error('証明書エラー（unable to verify the first certificate）が出た場合は、ENV_SETUP.mdのトラブルシューティングを参照してください。')
    process.exit(1)
  }
}

// 値の前後の空白・引用符(' や ")を取り除いた「実質の値」を返す。未設定ならnull。
// 同名行が複数ある場合は最初の非空値を返す（seed*.mjsのenvVar()と同じ挙動に揃える）
function readVar(name) {
  if (!fs.existsSync(envPath)) return null
  const txt = fs.readFileSync(envPath, 'utf-8')
  const re = new RegExp(`^${name}=(.*)$`, 'gm')
  let m
  while ((m = re.exec(txt)) !== null) {
    const value = m[1].trim().replace(/^['"]|['"]$/g, '').trim()
    if (value.length > 0) return value
  }
  return null
}

function isFilled(name) {
  return readVar(name) !== null
}

// 既存の.env.localに対して、nameが空欄/未設定なら valueGenerator() の値で埋める（重複行を作らない）
function ensureFilled(name, valueGenerator) {
  if (isFilled(name)) return
  const value = valueGenerator()
  let txt = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
  const lineRe = new RegExp(`^${name}=.*$`, 'm')
  if (lineRe.test(txt)) {
    txt = txt.replace(lineRe, `${name}=${value}`)
  } else {
    txt = (txt.length && !txt.endsWith('\n') ? txt + '\n' : txt) + `${name}=${value}\n`
  }
  fs.writeFileSync(envPath, txt, 'utf-8')
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans) }))
}

// OS標準コマンドでURLをデフォルトブラウザで自動的に開く。失敗しても握りつぶす
// （呼び出し側で必ずURLをコンソールにも表示するため、失敗時は手動で開けば良いだけ）
function openUrl(url) {
  console.log(`→ ブラウザで開きます: ${url}`)
  try {
    if (process.platform === 'win32') {
      spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      spawnSync('open', [url], { stdio: 'ignore' })
    } else {
      spawnSync('xdg-open', [url], { stdio: 'ignore' })
    }
  } catch {
    console.log('（自動で開けませんでした。上記URLを手動で開いてください）')
  }
}

async function waitUntilAllFilled(names, guideText) {
  if (names.every(isFilled)) {
    console.log(`✓ 設定済みです: ${names.join(', ')}`)
    return
  }
  console.log(guideText)
  console.log(`\n(貼り付け先ファイル: ${envPath})`)
  while (names.some((n) => !isFilled(n))) {
    await ask('\n貼り付けが完了したらEnterキーを押してください... ')
    const missing = names.filter((n) => !isFilled(n))
    if (missing.length) {
      console.log(`まだ入力されていません: ${missing.join(', ')}。.env.local を保存したか確認してください。`)
    }
  }
  console.log(`✓ 確認しました: ${names.join(', ')}`)
}

console.log('=== e-Stat医療データ分析アプリ セットアップ ===\n')

// 1. npm install
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  console.log('[1/6] npm install を実行します...')
  run('npm', ['install'])
} else {
  console.log('[1/6] node_modules は既に存在するためスキップします')
}

// 2. .env.local 雛形生成・不足分の補完
if (!fs.existsSync(envPath)) {
  console.log('[2/6] .env.local を新規作成します')
  const template = `# ---- Convex ----
# NEXT_PUBLIC_CONVEX_URL は後のステップで npx convex dev --once が自動で書き込みます
NEXT_PUBLIC_CONVEX_URL=
# Convexダッシュボード → Settings → Deploy Keys で発行して貼り付けてください
CONVEX_DEPLOY_KEY=

# ---- WorkOS AuthKit ----
# https://dashboard.workos.com で取得
WORKOS_API_KEY=
WORKOS_CLIENT_ID=
# Cookie暗号化用（自動生成されます・変更不要）
WORKOS_COOKIE_PASSWORD=
# ログイン後リダイレクト先（このプロジェクトはポート3100固定・自動設定されます）
WORKOS_REDIRECT_URI=

# ---- fal.ai（AIインサイト・レポート・PPTX生成に必須）----
# https://fal.ai でアカウント作成 → ダッシュボードでAPI Keyを発行して貼る
FAL_KEY=
`
  fs.writeFileSync(envPath, template, 'utf-8')
} else {
  console.log('[2/6] .env.local は既に存在するためスキップします')
}
// 自動生成・固定値でよい項目は、既存ファイルの補完も含めてここで必ず埋める
ensureFilled('WORKOS_COOKIE_PASSWORD', () => crypto.randomBytes(32).toString('base64'))
ensureFilled('WORKOS_REDIRECT_URI', () => 'http://localhost:3100/callback')
console.log('✓ WORKOS_COOKIE_PASSWORD / WORKOS_REDIRECT_URI を確認・設定しました')

// 3. WorkOSキーの入力待ち
console.log('\n[3/6] WorkOSの設定')
if (!isFilled('WORKOS_API_KEY') || !isFilled('WORKOS_CLIENT_ID')) {
  openUrl('https://dashboard.workos.com')
}
await waitUntilAllFilled(
  ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID'],
  [
    '以下の手順でWorkOSのキーを取得し、.env.local に貼り付けてください（引用符は付けずそのまま貼ってください）:',
    '  1. https://dashboard.workos.com でアカウント作成・ログイン',
    '  2. Applications で新規Applicationを作成',
    '  3. Redirects に http://localhost:3100/callback を登録',
    '  4. AuthKit を有効化（Email+Password 等）',
    '  5. API Key と Client ID をコピーし、.env.local の WORKOS_API_KEY= / WORKOS_CLIENT_ID= に貼る',
  ].join('\n'),
)

// 4. fal.aiキーの入力待ち
console.log('\n[4/6] fal.aiの設定（AIインサイト・レポート・PPTX生成に必須）')
if (!isFilled('FAL_KEY')) {
  openUrl('https://fal.ai')
}
await waitUntilAllFilled(
  ['FAL_KEY'],
  [
    '以下の手順でfal.aiのキーを取得し、.env.local に貼り付けてください（引用符は付けずそのまま貼ってください）:',
    '  1. https://fal.ai でアカウント作成・ログイン',
    '  2. ダッシュボードでAPI Keyを発行',
    '  3. .env.local の FAL_KEY= に貼る',
  ].join('\n'),
)

// 5. Convexプロジェクト作成・コード反映（ブラウザログインが必要）
console.log('\n[5/6] Convexのセットアップを行います（ブラウザでログイン画面が開きます）')
run('npx', ['convex', 'dev', '--once'])
console.log('✓ Convexプロジェクトの作成・コード反映が完了しました')

await waitUntilAllFilled(
  ['CONVEX_DEPLOY_KEY'],
  '開発（Dev）デプロイメント側のConvexダッシュボード → Settings → Deploy Keys でキーを発行し、.env.local の CONVEX_DEPLOY_KEY= に貼り付けてください（Productionのキーではありません）',
)

// 6. データseed投入
if (!isFilled('NEXT_PUBLIC_CONVEX_URL')) {
  console.error('\n✗ NEXT_PUBLIC_CONVEX_URL が未設定です。手順5の npx convex dev --once が正常終了したか確認し、再実行してください。')
  process.exit(1)
}
console.log('\n[6/6] データを投入します')
run('node', ['scripts/seed.mjs'])
run('node', ['scripts/seed_medical_cost.mjs'])
run('node', ['scripts/seed_muni_stats.mjs'])
run('node', ['scripts/seed_region.mjs'])

console.log('\n=== セットアップ完了 ===')
console.log('次のコマンドで起動してください: npm run dev')
console.log('ブラウザで http://localhost:3100 を開いてください')
