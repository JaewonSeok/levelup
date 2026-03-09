/** @type {import('next').NextConfig} */
const nextConfig = {
  // [보안] X-Powered-By: Next.js 헤더 제거 — 프레임워크/버전 정보 노출 방지
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 클릭재킹 방지
          { key: "X-Frame-Options", value: "DENY" },
          // MIME 타입 스니핑 방지
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer 정보 최소화
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HTTPS 강제 (2년, 서브도메인 포함)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // 불필요한 브라우저 기능 비활성화
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // CSP — Next.js 14 hydration 호환 (unsafe-inline/eval 필요)
          // 향후 nonce 기반 CSP로 강화 가능
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self' https://api.anthropic.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      {
        // API 응답은 캐시 비활성화 (민감 데이터 보호)
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
