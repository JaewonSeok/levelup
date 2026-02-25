import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, ConfirmationStatus } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.CEO, Role.HR_TEAM, Role.SYSTEM_ADMIN];

function getCurrentYear() {
  return new Date().getFullYear();
}

// ── GET /api/confirmation ──────────────────────────────────────────
// 쿼리: year, department?, team?
// isReviewTarget=true인 Candidate 조회 + Review join + Confirmation 자동 upsert
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? getCurrentYear());
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";

  // isReviewTarget=true인 Candidate 조회
  const candidates = await prisma.candidate.findMany({
    where: {
      year,
      isReviewTarget: true,
      user: {
        role: { not: Role.DEPT_HEAD },
        ...(department ? { department: { contains: department, mode: "insensitive" } } : {}),
        ...(team ? { team: { contains: team, mode: "insensitive" } } : {}),
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          department: true,
          team: true,
          level: true,
          competencyLevel: true,
          yearsOfService: true,
          hireDate: true,
        },
      },
      review: {
        select: {
          id: true,
          competencyScore: true,
          competencyEval: true,
          recommendation: true,
        },
      },
      confirmation: true,
    },
    orderBy: [
      { user: { department: "asc" } },
      { user: { team: "asc" } },
      { user: { name: "asc" } },
    ],
  });

  // 평가등급 일괄 조회
  const candidateUserIds = candidates.map((c) => c.userId);
  const allGrades = await prisma.performanceGrade.findMany({
    where: { userId: { in: candidateUserIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
    select: { userId: true, year: true, grade: true },
  });
  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }

  // Confirmation이 없으면 자동 upsert (PENDING)
  const rows = await Promise.all(
    candidates.map(async (c) => {
      let confirmation = c.confirmation;
      if (!confirmation) {
        confirmation = await prisma.confirmation.upsert({
          where: { candidateId: c.id },
          create: { candidateId: c.id, status: ConfirmationStatus.PENDING },
          update: {},
        });
      }

      // 포인트/학점 누적 조회
      const [latestPoint, latestCredit] = await Promise.all([
        prisma.point.findFirst({ where: { userId: c.userId }, orderBy: { year: "desc" } }),
        prisma.credit.findFirst({ where: { userId: c.userId }, orderBy: { year: "desc" } }),
      ]);

      // 기준 조회
      const criteria = c.user.level
        ? await prisma.levelCriteria.findFirst({
            where: { level: c.user.level, year },
          })
        : null;

      const userGrades = gradeMap.get(c.userId) ?? {};

      return {
        candidateId: c.id,
        confirmationId: confirmation.id,
        userId: c.userId,
        name: c.user.name,
        department: c.user.department,
        team: c.user.team,
        level: c.user.level as string | null,
        competencyLevel: c.user.competencyLevel,
        yearsOfService: c.user.yearsOfService,
        hireDate: c.user.hireDate?.toISOString() ?? null,
        pointCumulative: latestPoint?.cumulative ?? 0,
        creditCumulative: latestCredit?.cumulative ?? 0,
        requiredPoints: criteria?.requiredPoints ?? null,
        requiredCredits: criteria?.requiredCredits ?? null,
        competencyScore: c.review?.competencyScore ?? null,
        competencyEval: c.review?.competencyEval ?? null,
        reviewRecommendation: c.review?.recommendation ?? null,
        status: confirmation.status,
        confirmedAt: confirmation.confirmedAt?.toISOString() ?? null,
        grades: {
          2021: userGrades[2021] ?? null,
          2022: userGrades[2022] ?? null,
          2023: userGrades[2023] ?? null,
          2024: userGrades[2024] ?? null,
          2025: userGrades[2025] ?? null,
        },
      };
    })
  );

  // 요약 통계
  const summary = {
    pending: rows.filter((r) => r.status === ConfirmationStatus.PENDING).length,
    confirmed: rows.filter((r) => r.status === ConfirmationStatus.CONFIRMED).length,
    deferred: rows.filter((r) => r.status === ConfirmationStatus.DEFERRED).length,
  };

  // 드롭다운용 메타데이터
  const [metaDepts, metaTeams] = await Promise.all([
    prisma.user.findMany({
      distinct: ["department"],
      select: { department: true },
      orderBy: { department: "asc" },
    }),
    prisma.user.findMany({
      distinct: ["team"],
      select: { team: true },
      orderBy: { team: "asc" },
    }),
  ]);

  return NextResponse.json({
    employees: rows,
    total: rows.length,
    summary,
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
  });
}
