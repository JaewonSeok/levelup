import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { recalculatePointsFromGrades } from "@/lib/points/recalculate";
import { autoSelectCandidates } from "@/lib/candidates/auto-select";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];
const READ_ROLES: Role[] = [Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];

// GET /api/grade-criteria
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!READ_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const criteria = await prisma.gradeCriteria.findMany({
    orderBy: [{ yearRange: "asc" }, { grade: "asc" }],
  });

  return NextResponse.json({ criteria });
}

// POST /api/grade-criteria
// Body: { criteria: { grade: string; yearRange: string; points: number }[] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 수정할 수 있습니다." }, { status: 403 });
  }

  let body: { criteria: { grade: string; yearRange: string; points: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  if (!Array.isArray(body.criteria) || body.criteria.length === 0) {
    return NextResponse.json({ error: "criteria 배열이 필요합니다." }, { status: 400 });
  }

  // Upsert each grade criteria entry
  await prisma.$transaction(
    body.criteria.map(({ grade, yearRange, points }) =>
      prisma.gradeCriteria.upsert({
        where: { grade_yearRange: { grade, yearRange } },
        create: { grade, yearRange, points },
        update: { points },
      })
    )
  );

  // 재계산 + 자동 선정 (비동기, 에러 무시)
  const currentYear = new Date().getFullYear();
  recalculatePointsFromGrades()
    .then(() => autoSelectCandidates(currentYear))
    .catch((e) => console.error("[grade-criteria] recalculate error:", e));

  return NextResponse.json({ success: true });
}
