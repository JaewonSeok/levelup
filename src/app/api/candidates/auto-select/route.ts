import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Role } from "@prisma/client";
import { autoSelectCandidates } from "@/lib/candidates/auto-select";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// POST /api/candidates/auto-select
// Body: { year: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀 또는 관리자만 자동 선정을 실행할 수 있습니다." }, { status: 403 });
  }

  let body: { year?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const year = Number(body.year);
  if (!year) {
    return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });
  }

  try {
    const result = await autoSelectCandidates(year);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: `자동 선정 오류: ${msg}` }, { status: 500 });
  }
}
