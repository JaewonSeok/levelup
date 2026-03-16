import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 허용 IP 목록: 환경변수 ALLOWED_IPS (쉼표 구분) 우선, 없으면 기본값 사용
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "220.85.141.12")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

const FORBIDDEN_HTML = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>접근 제한</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0">
  <div style="text-align:center">
    <h1 style="font-size:4rem;margin:0">403</h1>
    <p style="color:#555;margin-top:0.5rem">접근이 제한된 페이지입니다.</p>
  </div>
</body>
</html>`;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return req.ip ?? "";
}

export function middleware(req: NextRequest) {
  // 1. Vercel 내부 요청 허용 (SSR prefetch, Next.js data 요청 등)
  const isInternalRequest =
    req.headers.get("x-middleware-prefetch") ||
    req.headers.get("x-nextjs-data") ||
    req.headers.get("purpose") === "prefetch";
  if (isInternalRequest) return NextResponse.next();

  // 2. IP 확인
  const clientIp = getClientIp(req);

  // 3. 로컬/개발 환경 자동 허용
  if (!clientIp || clientIp === "::1" || clientIp === "127.0.0.1") {
    return NextResponse.next();
  }

  // 4. 허용 IP 체크 — 모든 페이지/API 동일하게 적용
  if (!ALLOWED_IPS.includes(clientIp)) {
    return new NextResponse(FORBIDDEN_HTML, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

// 정적 자산(_next/static, _next/image, favicon 등)만 제외, 나머지 전체 적용
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)$).*)",
  ],
};
