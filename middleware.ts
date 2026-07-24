import { authkitMiddleware } from '@workos-inc/authkit-nextjs'

// 注意: middlewareAuth未指定のためデフォルト無効（このmiddlewareはセッション更新と
// ヘッダ付与のみで、未認証リクエストをブロックしない）。
// APIの認証はルートハンドラ側の withAuth で行う（app/api/insight/route.ts 参照）。
export default authkitMiddleware({
  redirectUri: process.env.WORKOS_REDIRECT_URI ?? 'http://localhost:3100/callback',
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|japan_prefectures.geojson|yamaguchi_cities.geojson).*)'],
}
