/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer, webpack }) => {
    // pptxgenjs はブラウザでは node:fs 等を使わないが、webpackが node: スキームを
    // 解決できず失敗する。クライアントバンドルで node: を剥がし、Node組込みをスタブ化。
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '')
        }),
      )
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        https: false,
        http: false,
        path: false,
        os: false,
      }
    }
    return config
  },
}

export default nextConfig
