'use client'

import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { useState } from 'react'

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  // useRefだと引数のnewが毎レンダー評価されるため、初期化関数つきuseStateで1回だけ生成
  const [client] = useState(() => new ConvexReactClient(url))
  return <ConvexProvider client={client}>{children}</ConvexProvider>
}
