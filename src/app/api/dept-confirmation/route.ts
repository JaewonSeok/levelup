import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, ConfirmationStatus } from "@prisma/client";

const CURRENT_YEAR = new Date().getFullYear();

// GET /api/dept-confirmation
// DEPT_HEAD 전용 — 본인 소속 본부의 확정 완료된 레벨업 대상자 조회 (읽기 전용)
// 결과 공개 설정(result_visible_{year})이 true일 때만 데이터 반환
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  // 본부장 화면 보기 (impersonation) — SYSTEM_ADMIN / HR_TEAM 허용
  const { searchParams } = new URL(req.url);
  const impersonateDeptParam = searchParams.get("impersonate");
  const isAdminOrHR = session.user.role === Role.SYSTEM_ADMIN || session.user.role === Role.HR_TEAM;
  const isImpersonating = !!(isAdminOrHR && impersonateDeptParam);

  if (!isImpersonating && session.user.role !== Role.DEPT_HEAD) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  // 공개 여부 확인
  const visibilitySetting = await prisma.appSetting.findUnique({
    where: { key: `result_visible_${CURRENT_YEAR}` },
  });
  if (visibilitySetting?.value !== "true") {
    return NextResponse.json({ employees: [], visible: false });
  }

  const dept = isImpersonating ? (impersonateDeptParam ?? null) : session.user.department;
  if (!dept) {
    return NextResponse.json({ employees: [], visible: true });
  }

  const candidates = await prisma.candidate.findMany({
    where: {
      isReviewTarget: true,
      review: { recommendation: true },
      confirmation: { status: ConfirmationStatus.CONFIRMED },
      user: {
        department: dept,
        role: { not: Role.DEPT_HEAD },
        isActive: true,
      },
    },
    include: {
      user: {
        select: {
          name: true,
          department: true,
          team: true,
          level: true,
          competencyLevel: true,
          yearsOfService: true,
          hireDate: true,
        },
      },
      confirmation: { select: { status: true, confirmedAt: true } },
    },
    orderBy: [
      { user: { team: "asc" } },
      { user: { name: "asc" } },
    ],
  });

  const userIds = candidates.map((c) => c.userId);

  const allPoints = await prisma.point.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, cumulative: true },
    orderBy: { year: "desc" },
  });
  const allCredits = await prisma.credit.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, cumulative: true },
    orderBy: { year: "desc" },
  });
  const bonusPenalties = await prisma.bonusPenalty.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, type: true, points: true },
  });

  const pointMap = new Map<string, number>();
  for (const p of allPoints) {
    if (!pointMap.has(p.userId)) pointMap.set(p.userId, p.cumulative);
  }
  const creditMap = new Map<string, number>();
  for (const cr of allCredits) {
    if (!creditMap.has(cr.userId)) creditMap.set(cr.userId, cr.cumulative);
  }
  const bpMap = new Map<string, number>();
  for (const bp of bonusPenalties) {
    bpMap.set(bp.userId, (bpMap.get(bp.userId) ?? 0) + bp.points);
  }

  const employees = candidates.map((c, idx) => ({
    no: idx + 1,
    name: c.user.name,
    department: c.user.department,
    team: c.user.team,
    level: c.user.level,
    competencyLevel: c.user.competencyLevel,
    yearsOfService: c.user.yearsOfService,
    hireDate: c.user.hireDate?.toISOString() ?? null,
    pointCumulative: (pointMap.get(c.userId) ?? 0) + (bpMap.get(c.userId) ?? 0),
    creditCumulative: creditMap.get(c.userId) ?? 0,
  }));

  return NextResponse.json({ employees, visible: true });
}
