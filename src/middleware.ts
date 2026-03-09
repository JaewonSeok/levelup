import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 허용 IP 목록: 환경변수 ALLOWED_IPS (쉼표 구분) 우선, 없으면 기본값 사용
const ALLOWED_IPS = (process.env.ALLOWED_IPS || "220.85.141.12,220.85.141.27")
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
  // Vercel은 x-forwarded-for로 실제 클라이언트 IP를 전달
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return req.ip ?? "";
}

export function middleware(req: NextRequest) {
  const clientIp = getClientIp(req);

  if (!ALLOWED_IPS.includes(clientIp)) {
    return new NextResponse(FORBIDDEN_HTML, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 정적 파일·이미지·폰트·favicon 제외, 나머지 모든 경로 (API 포함) 보호
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)$).*)",
  ],
};
