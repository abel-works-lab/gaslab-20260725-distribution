import type { Metadata } from 'next'
import { ConvexClientProvider } from './ConvexClientProvider'

export const metadata: Metadata = {
  title: '医療費・要因分析マップ',
  description: 'e-Stat 都道府県別 医療費・要因・疾病マップ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, padding: 0 }}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  )
}
