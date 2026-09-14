import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ロリポップ！デプロイナウは standalone 出力が必須
  output: "standalone",
};

export default nextConfig;
