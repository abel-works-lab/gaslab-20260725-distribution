import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { DEFAULT_PROMPTS } from '../../prompts'

export const runtime = 'nodejs'
export const maxDuration = 60

// fal.ai の openrouter/router 経由で Claude を呼ぶ（同期REST）
const FAL_ENDPOINT = 'https://fal.run/openrouter/router'
const MODEL = 'anthropic/claude-sonnet-4.6'

// Vercel Hobbyの60秒制限に余裕を持って収める（実測: report 3000tok=57秒でギリギリ→削減）
// slidesはJSONデッキ全体を出し切る必要がある。途中truncationで壊れるのを避けるため上限は余裕を持たせる
// （速度はプロンプト側で枚数・字数を絞って稼ぐ）
const MAXTOK: Record<string, number> = { insight: 2200, report: 2200, slides: 2600 }

export async function POST(req: NextRequest) {
  // 認証必須。authkitMiddlewareはmiddlewareAuth未指定だとセッション更新のみで
  // 未認証リクエストをブロックしないため、ここでログイン済みかを検証する
  // （未認証だと所有者のFAL_KEYで誰でもAIを呼べてしまう）。
  // withAuth自体が例外を投げることがある（middlewareの被覆漏れ等）ため、ここで捕まえて
  // 必ずJSONで返す。素通しするとNext.jsの既定HTMLエラーページが返り、クライアント側で
  // raw HTMLがそのままエラーメッセージ表示されてしまう（2026-07-18に実際に発生）
  let user: { id: string } | null = null
  try {
    ({ user } = await withAuth())
  } catch (e) {
    console.error('withAuth failed', e)
    return NextResponse.json({ error: '認証確認に失敗しました。ログインし直してください' }, { status: 401 })
  }
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }
  const key = process.env.FAL_KEY
  if (!key) {
    return NextResponse.json(
      { error: 'FAL_KEY が未設定です（Vercel環境変数 / ローカルは .env.local に追加）' },
      { status: 500 },
    )
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの解析に失敗しました' }, { status: 400 })
  }
  const mode: string = body?.mode
  const payload = body?.payload
  // 自前プロパティのみ許可（"constructor"等がObject.prototype経由で通過するのを防ぐ）
  if (
    typeof mode !== 'string' ||
    !Object.hasOwn(DEFAULT_PROMPTS, mode) ||
    typeof DEFAULT_PROMPTS[mode] !== 'string'
  ) {
    return NextResponse.json({ error: '不明なmodeです' }, { status: 400 })
  }
  // ユーザーがUIで編集したsystem_promptがあれば優先。無ければデフォルト
  // 巨大入力によるコスト膨張・タイムアウト防止に上限8000字（サーバー側で必須）
  const rawSys = typeof payload?.systemPrompt === 'string' ? payload.systemPrompt.trim() : ''
  const sys = rawSys ? rawSys.slice(0, 8000) : DEFAULT_PROMPTS[mode]

  // data/insight にも上限を設ける（systemPrompt・reportと同様、巨大入力によるコスト膨張防止）。
  // dataは正規利用時のデータ要約JSONが収まる程度、insightはAI出力の最大トークン相当を目安にした
  const dataText = JSON.stringify(payload?.data ?? {}, null, 1).slice(0, 20_000)
  const insightText = String(payload?.insight ?? '').slice(0, 8000)
  const userText =
    mode === 'report'
      ? `# 元データ要約\n${dataText}\n\n# 先に生成したインサイト\n${insightText}`
      : mode === 'slides'
        ? `# レポート本文（これをスライド化）\n${String(payload?.report ?? '').slice(0, 7000)}`
        : `# 医療費・要因データ要約\n${dataText}`

  try {
    // fal.ai openrouter/router の同期REST。body = input そのもの。output に生成テキスト
    const res = await fetch(FAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Key ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        system_prompt: sys,
        prompt: userText,
        max_tokens: MAXTOK[mode] ?? 3000,
      }),
      // maxDuration=60秒でVercelに強制終了される前に、制御されたエラーを返すための上限
      signal: AbortSignal.timeout(55_000),
    })
    const j: any = await res.json()
    if (!res.ok || j?.error) {
      // 内部詳細はサーバーログのみ。クライアントには汎用メッセージを返す
      console.error('fal.ai API error', res.status, j?.error ?? j)
      return NextResponse.json({ error: `AI API エラー (${res.status})` }, { status: 502 })
    }
    const text: string = typeof j?.output === 'string' ? j.output : ''
    if (!text) {
      console.error('fal.ai empty output', j)
      return NextResponse.json({ error: 'AIが空の応答を返しました' }, { status: 502 })
    }
    return NextResponse.json({ text })
  } catch (e: any) {
    // 内部詳細はサーバーログのみ。クライアントには汎用メッセージを返す（上のfal.aiエラー処理と同方針）
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      console.error('fal.ai timeout', e)
      return NextResponse.json({ error: 'AI APIがタイムアウトしました' }, { status: 504 })
    }
    console.error('insight route error', e)
    return NextResponse.json({ error: 'AI API 呼び出しに失敗しました' }, { status: 500 })
  }
}
