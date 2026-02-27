import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, Prisma } from "@prisma/client";

const REVIEW_ROLES: Role[] = [Role.DEPT_HEAD, Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];

// ── GET /api/reviews ─────────────────────────────────────────────
// 심사대상자 목록 + Review 레코드 자동 생성
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!REVIEW_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";
  const targetType = searchParams.get("targetType") ?? "all"; // all | own | other

  const currentDept = session.user.department ?? "";

  const userConditions: Prisma.UserWhereInput[] = [
    { role: { not: Role.DEPT_HEAD } },
  ];
  if (department) userConditions.push({ department: { contains: department, mode: "insensitive" } });
  if (team) userConditions.push({ team: { contains: team, mode: "insensitive" } });
  if (targetType === "own") userConditions.push({ department: currentDept });
  else if (targetType === "other") userConditions.push({ NOT: { department: currentDept } });

  const candidateWhere: Prisma.CandidateWhereInput = {
    year,
    ...(userConditions.length > 0 ? { user: { AND: userConditions } } : {}),
  };

  // Fetch candidates
  const candidates = await prisma.candidate.findMany({
    where: candidateWhere,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          department: true,
          team: true,
          level: true,
          hireDate: true,
          yearsOfService: true,
          competencyLevel: true,
        },
      },
    },
    orderBy: [
      { user: { department: "asc" } },
      { user: { team: "asc" } },
      { user: { name: "asc" } },
    ],
  });

  const [metaDepts, metaTeams] = await Promise.all([
    prisma.user.findMany({ distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } }),
    prisma.user.findMany({ distinct: ["team"], select: { team: true }, orderBy: { team: "asc" } }),
  ]);

  if (candidates.length === 0) {
    return NextResponse.json({
      candidates: [],
      total: 0,
      meta: {
        departments: metaDepts.map((d) => d.department).filter(Boolean),
        teams: metaTeams.map((t) => t.team).filter(Boolean),
      },
      currentUser: { id: session.user.id, role: session.user.role, department: currentDept },
    });
  }

  const candidateIds = candidates.map((c) => c.id);
  const userIds = candidates.map((c) => c.userId);
  const levelSet = candidates
    .map((c) => c.user.level)
    .filter((l): l is Level => l != null);
  const levels = Array.from(new Set(levelSet));

  // Fetch existing reviews
  const existingReviews = await prisma.review.findMany({
    where: { candidateId: { in: candidateIds } },
    include: { opinions: true },
  });
  const reviewMap = new Map(existingReviews.map((r) => [r.candidateId, r]));

  // Auto-create missing Review records
  const missingCandidateIds = candidateIds.filter((id) => !reviewMap.has(id));
  if (missingCandidateIds.length > 0) {
    await prisma.review.createMany({
      data: missingCandidateIds.map((candidateId) => ({ candidateId })),
      skipDuplicates: true,
    });
    const newReviews = await prisma.review.findMany({
      where: { candidateId: { in: missingCandidateIds } },
      include: { opinions: true },
    });
    for (const r of newReviews) reviewMap.set(r.candidateId, r);
  }

  // Fetch level criteria, latest points, latest credits, grades, bonus-penalty
  const [criteriaList, latestPoints, latestCredits, allGrades, bonusPenaltyRecords] = await Promise.all([
    levels.length > 0
      ? prisma.levelCriteria.findMany({ where: { year, level: { in: levels } } })
      : Promise.resolve([]),
    prisma.point.findMany({
      where: { userId: { in: userIds } },
      orderBy: { year: "desc" },
      distinct: ["userId"],
    }),
    prisma.credit.findMany({
      where: { userId: { in: userIds } },
      orderBy: { year: "desc" },
      distinct: ["userId"],
    }),
    prisma.performanceGrade.findMany({
      where: { userId: { in: userIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
      select: { userId: true, year: true, grade: true },
    }),
    prisma.bonusPenalty.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, type: true, points: true },
    }),
  ]);

  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }

  const criteriaMap = new Map(criteriaList.map((c) => [c.level as string, c]));
  const pointMap = new Map(latestPoints.map((p) => [p.userId, p.cumulative]));
  const creditMap = new Map(latestCredits.map((c) => [c.userId, c.cumulative]));
  const bpMap = new Map<string, { bonusTotal: number; penaltyTotal: number }>();
  for (const bp of bonusPenaltyRecords) {
    if (!bpMap.has(bp.userId)) bpMap.set(bp.userId, { bonusTotal: 0, penaltyTotal: 0 });
    const entry = bpMap.get(bp.userId)!;
    if (bp.points > 0) entry.bonusTotal += bp.points;
    else entry.penaltyTotal += Math.abs(bp.points);
  }

  // Build response rows
  const result = candidates.map((candidate) => {
    const review = reviewMap.get(candidate.id);
    const opinions = review?.opinions ?? [];

    const currentUserOpinion = opinions.find((o) => o.reviewerId === session.user.id);

    // 추천여부: review.recommendation 값을 직접 사용
    const recommendationStatus: "추천" | "제외" | null =
      review?.recommendation === true ? "추천" :
      review?.recommendation === false ? "제외" :
      null;

    const criteria = candidate.user.level ? criteriaMap.get(candidate.user.level) : null;

    const userGrades = gradeMap.get(candidate.userId) ?? {};
    const { bonusTotal = 0, penaltyTotal = 0 } = bpMap.get(candidate.userId) ?? {};
    const adjustment = bonusTotal - penaltyTotal;
    const baseCumulative = pointMap.get(candidate.userId) ?? 0;

    return {
      candidateId: candidate.id,
      userId: candidate.userId,
      reviewId: review?.id ?? null,
      name: candidate.user.name,
      department: candidate.user.department,
      team: candidate.user.team,
      level: candidate.user.level as string | null,
      hireDate: candidate.user.hireDate?.toISOString() ?? null,
      yearsOfService: candidate.user.yearsOfService,
      competencyLevel: candidate.user.competencyLevel,
      pointCumulative: baseCumulative + adjustment,
      creditCumulative: creditMap.get(candidate.userId) ?? 0,
      bonusTotal,
      penaltyTotal,
      requiredPoints: criteria?.requiredPoints ?? null,
      requiredCredits: criteria?.requiredCredits ?? null,
      competencyScore: review?.competencyScore ?? null,
      competencyEval: review?.competencyEval ?? null,
      promotionType: candidate.promotionType ?? "normal",
      currentUserOpinionSavedAt: currentUserOpinion?.savedAt?.toISOString() ?? null,
      recommendationStatus,
      grades: {
        2021: userGrades[2021] ?? null,
        2022: userGrades[2022] ?? null,
        2023: userGrades[2023] ?? null,
        2024: userGrades[2024] ?? null,
        2025: userGrades[2025] ?? null,
      },
    };
  });

  return NextResponse.json({
    candidates: result,
    total: result.length,
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
    currentUser: {
      id: session.user.id,
      role: session.user.role,
      department: currentDept,
    },
  });
}
