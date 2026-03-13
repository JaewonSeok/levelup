import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, Prisma } from "@prisma/client";
import { calculateFinalPoints, getNextLevel, gradeToPoints } from "@/lib/pointCalculation";
import { calculateAiScore } from "@/lib/aiScoring";

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

  // [QA] try/catch 추가 — 이전에는 전체 함수에 에러 처리 없었음
  try {

  // ── 현재 심사 Phase 조회 (없으면 1차 기본값) ──────────────────────
  const reviewPhaseRecord = await prisma.reviewPhase.findUnique({ where: { year } }).catch(() => null);
  const currentPhase = reviewPhaseRecord?.currentPhase ?? 1;

  const userConditions: Prisma.UserWhereInput[] = [
    { role: { not: Role.DEPT_HEAD } },
    { isActive: true },
    { level: { not: Level.L5 } }, // L5는 최고 레벨 → 레벨업 대상 아님
  ];
  if (department) userConditions.push({ department: { contains: department, mode: "insensitive" } });
  if (team) userConditions.push({ team: { contains: team, mode: "insensitive" } });

  // ── DEPT_HEAD: Phase에 따라 조회 범위 분기 ────────────────────────
  // Phase 1: 소속 본부만 (targetType 무관하게 강제 적용)
  // Phase 2: 기존 targetType 로직 유지 (own/other/all)
  if (session.user.role === Role.DEPT_HEAD && currentPhase === 1) {
    userConditions.push({ department: currentDept });
  } else {
    if (targetType === "own") {
      userConditions.push({ department: currentDept });
    } else if (targetType === "other") {
      userConditions.push({ NOT: { department: currentDept } });
      // 타본부장은 L3, L4, L5 승진 심사 담당
      if (session.user.role === Role.DEPT_HEAD) {
        userConditions.push({ level: { in: [Level.L3, Level.L4, Level.L5] } });
      }
    } else if (targetType === "all" && session.user.role === Role.DEPT_HEAD) {
      // 본부장 전체: 본인소속 L1~L5 전부 + 타본부 L3,L4,L5
      userConditions.push({
        OR: [
          { department: currentDept },
          {
            AND: [
              { NOT: { department: currentDept } },
              { level: { in: [Level.L3, Level.L4, Level.L5] } },
            ],
          },
        ],
      });
    }
  }

  const candidateWhere: Prisma.CandidateWhereInput = {
    year,
    // 제외 처리된 대상자 미포함 (candidates 페이지와 동일)
    source: { not: "excluded" },
    // 포인트+학점 모두 충족 또는 수동 추가 (candidates 페이지 isQualified와 동일)
    OR: [{ pointMet: true, creditMet: true }, { source: "manual" }],
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
      note: true,
    },
    orderBy: [
      { user: { department: "asc" } },
      { user: { team: "asc" } },
      { user: { name: "asc" } },
    ],
  });

  const metaDepts = await prisma.user.findMany({ distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } });
  const metaTeams = await prisma.user.findMany({ distinct: ["team"], select: { team: true }, orderBy: { team: "asc" } });

  if (candidates.length === 0) {
    return NextResponse.json({
      candidates: [],
      total: 0,
      meta: {
        departments: metaDepts.map((d) => d.department).filter(Boolean),
        teams: metaTeams.map((t) => t.team).filter(Boolean),
      },
      currentUser: { id: session.user.id, role: session.user.role, department: currentDept, currentPhase },
    });
  }

  let candidateIds = candidates.map((c) => c.id);

  // Fetch existing reviews (auto-create 전에 먼저 조회)
  const existingReviews = await prisma.review.findMany({
    where: { candidateId: { in: candidateIds } },
    include: { opinions: true },
  });
  const reviewMap = new Map(existingReviews.map((r) => [r.candidateId, r]));

  // ── Phase 2 + DEPT_HEAD: 타본부 후보자를 1차 추천자로만 제한 ──────
  // [보안] 백엔드에서 필터링 — 타본부장이 1차에서 추천(recommendation=true)한 후보만 반환
  let workingCandidates = candidates;
  if (
    session.user.role === Role.DEPT_HEAD &&
    currentPhase === 2 &&
    targetType !== "own"
  ) {
    const recommendedIds = new Set(
      existingReviews
        .filter((r) => r.recommendation === true)
        .map((r) => r.candidateId)
    );
    workingCandidates = candidates.filter(
      (c) => c.user.department === currentDept || recommendedIds.has(c.id)
    );
    candidateIds = workingCandidates.map((c) => c.id);
  }

  const userIds = workingCandidates.map((c) => c.userId);
  const levelSet = workingCandidates
    .map((c) => c.user.level)
    .filter((l): l is Level => l != null);
  const levels = Array.from(new Set(levelSet));

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

  // Fetch level criteria, latest points(fallback), credits(2025), grades, bonus-penalty, gradeCriteria (순차 조회)
  const criteriaList = levels.length > 0
    ? await prisma.levelCriteria.findMany({ where: { year, level: { in: levels } } })
    : [];
  const latestPoints = await prisma.point.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, cumulative: true, merit: true, penalty: true },
    orderBy: { year: "desc" },
  });
  const latestCredits = await prisma.credit.findMany({
    where: { userId: { in: userIds }, year: 2025 },
    select: { userId: true, score: true },
  });
  const allGrades = await prisma.performanceGrade.findMany({
    where: { userId: { in: userIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
    select: { userId: true, year: true, grade: true },
  });
  const bonusPenaltyRecords = await prisma.bonusPenalty.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, type: true, points: true },
  });
  const gradeCriteriaAll = await prisma.gradeCriteria.findMany();

  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }

  const criteriaMap = new Map(criteriaList.map((c) => [c.level as string, c]));
  // GradeCriteria 미설정 시 fallback cumulative(최신) + totalMerit/totalPenalty 집계
  const pointMap = new Map<string, number>();
  const meritMap = new Map<string, number>();
  const penaltyMap = new Map<string, number>();
  const seenPointUsers = new Set<string>();
  for (const p of latestPoints) {
    if (!seenPointUsers.has(p.userId)) {
      pointMap.set(p.userId, p.cumulative); // 최신 연도 cumulative
      seenPointUsers.add(p.userId);
    }
    meritMap.set(p.userId, (meritMap.get(p.userId) ?? 0) + p.merit);
    penaltyMap.set(p.userId, (penaltyMap.get(p.userId) ?? 0) + p.penalty);
  }
  const creditMap = new Map(latestCredits.map((c) => [c.userId, c.score])); // 2025년 Credit.score
  const bpMap = new Map<string, { bonusTotal: number; penaltyTotal: number }>();
  for (const bp of bonusPenaltyRecords) {
    if (!bpMap.has(bp.userId)) bpMap.set(bp.userId, { bonusTotal: 0, penaltyTotal: 0 });
    const entry = bpMap.get(bp.userId)!;
    if (bp.points > 0) entry.bonusTotal += bp.points;
    else entry.penaltyTotal += Math.abs(bp.points);
  }

  // Build response rows
  const result = workingCandidates.map((candidate) => {
    const review = reviewMap.get(candidate.id);
    const opinions = review?.opinions ?? [];

    const currentUserOpinion = opinions.find((o) => o.reviewerId === session.user.id);

    // 소속본부장 의견 — "의견" 컬럼 전용 (텍스트 입력 여부 판단)
    const ownDeptHeadOpinion = opinions.find((o) => o.reviewerRole === "소속본부장");
    const ownDeptHeadHasOpinion = !!(ownDeptHeadOpinion?.opinionText?.trim());
    // 추천여부: 소속본부장 Opinion.recommendation만 반영
    // (타본부장 의견은 팝업 참고용이며 목록 추천여부에 영향 없음)
    const recommendationStatus: "추천" | "제외" | "의견없음" | null =
      ownDeptHeadOpinion?.noOpinion ? "의견없음" :
      ownDeptHeadOpinion?.recommendation === true ? "추천" :
      ownDeptHeadOpinion?.recommendation === false ? "제외" :
      null;

    const criteria = candidate.user.level ? criteriaMap.get(candidate.user.level) : null;

    const userGrades = gradeMap.get(candidate.userId) ?? {};
    const { bonusTotal = 0, penaltyTotal = 0 } = bpMap.get(candidate.userId) ?? {};

    // 포인트 관리·candidates와 동일한 공통 함수 — grade window + merit/penalty + adjustment
    const yearsOfService = candidate.user.yearsOfService ?? 0;
    const totalMerit = meritMap.get(candidate.userId) ?? 0;
    const totalPenalty = penaltyMap.get(candidate.userId) ?? 0;
    const adjustment = bonusTotal - penaltyTotal;
    const pointCumulative = gradeCriteriaAll.length > 0
      ? calculateFinalPoints(userGrades, gradeCriteriaAll, year, yearsOfService, totalMerit, totalPenalty, adjustment)
      : (pointMap.get(candidate.userId) ?? 0) + adjustment; // GradeCriteria 미설정 시 DB fallback + adjustment

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
      pointCumulative,
      creditCumulative: creditMap.get(candidate.userId) ?? 0,
      bonusTotal,
      penaltyTotal,
      requiredPoints: criteria?.requiredPoints ?? null,
      requiredCredits: criteria?.requiredCredits ?? null,
      competencyScore: review?.competencyScore ?? null,
      competencyEval: review?.competencyEval ?? null,
      promotionType: candidate.promotionType ?? "normal",
      currentUserOpinionSavedAt: currentUserOpinion?.savedAt?.toISOString() ?? null,
      currentUserHasOpinion: !!(currentUserOpinion?.opinionText?.trim()),
      currentUserRecommendation: currentUserOpinion
        ? (currentUserOpinion.noOpinion ? "의견없음" as const :
           currentUserOpinion.recommendation === true ? "추천" as const :
           currentUserOpinion.recommendation === false ? "제외" as const : null)
        : null,
      currentUserRecommendationReason: currentUserOpinion?.recommendationReason ?? null,
      ownDeptHeadHasOpinion,
      recommendationStatus,
      recommendationReason: ownDeptHeadOpinion?.recommendationReason ?? null,
      grades: {
        2021: userGrades[2021] ?? null,
        2022: userGrades[2022] ?? null,
        2023: userGrades[2023] ?? null,
        2024: userGrades[2024] ?? null,
        2025: userGrades[2025] ?? null,
      },
      note: candidate.note
        ? { noteText: candidate.note.noteText ?? null, fileUrl: candidate.note.fileUrl ?? null, fileName: candidate.note.fileName ?? null }
        : null,
    };
  });

  // ── 수정 1: 타본부장 조회 시 소속본부장 미추천 직원 제외 (어드민은 전체 표시) ──
  const resultForScoring = (session.user.role === Role.DEPT_HEAD)
    ? result.filter((r) =>
        r.department === currentDept || r.recommendationStatus !== "제외"
      )
    : result;

  // ── AI 스코어링: 레벨별 평균 계산 후 각 대상자에 점수 부여 ──
  const levelGroupAvg: Record<string, { avgPoints: number; avgCredits: number }> = {};
  {
    const lvGroups: Record<string, { pts: number[]; creds: number[] }> = {};
    for (const r of resultForScoring) {
      const lv = (r.level ?? "").substring(0, 2);
      if (!lvGroups[lv]) lvGroups[lv] = { pts: [], creds: [] };
      lvGroups[lv].pts.push(r.pointCumulative);
      lvGroups[lv].creds.push(r.creditCumulative);
    }
    for (const [lv, d] of Object.entries(lvGroups)) {
      levelGroupAvg[lv] = {
        avgPoints: d.pts.reduce((a, b) => a + b, 0) / (d.pts.length || 1),
        avgCredits: d.creds.reduce((a, b) => a + b, 0) / (d.creds.length || 1),
      };
    }
  }

  const enrichedResult = resultForScoring.map((r) => {
    const nl = getNextLevel(r.level);
    const crit = nl ? criteriaMap.get(nl) : (r.level ? criteriaMap.get(r.level) : null);
    const lv = (r.level ?? "").substring(0, 2);
    const avg = levelGroupAvg[lv] ?? { avgPoints: 0, avgCredits: 0 };
    const userGrades = gradeMap.get(r.userId) ?? {};
    const gradeList = ([2021, 2022, 2023, 2024, 2025] as const).flatMap((y) => {
      const grade = userGrades[y];
      if (!grade) return [] as { year: number; grade: string; points: number }[];
      return [{ year: y as number, grade, points: gradeToPoints(grade, y, gradeCriteriaAll) }];
    });
    const aiScore = calculateAiScore({
      grades: gradeList,
      finalPoints: r.pointCumulative,
      requiredPoints: r.requiredPoints ?? crit?.requiredPoints ?? 0,
      creditScore: r.creditCumulative,
      requiredCredits: r.requiredCredits ?? crit?.requiredCredits ?? 0,
      yearsOfService: r.yearsOfService ?? 0,
      minTenure: crit?.minTenure ?? 0,
      sameLevelAvgPoints: avg.avgPoints,
      sameLevelAvgCredits: avg.avgCredits,
    });
    return {
      ...r,
      aiScore,
      sameLevelAvgPoints: avg.avgPoints,
      sameLevelAvgCredits: avg.avgCredits,
      minTenure: crit?.minTenure ?? 0,
    };
  });

  return NextResponse.json({
    candidates: enrichedResult,
    total: enrichedResult.length,
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
    currentUser: {
      id: session.user.id,
      role: session.user.role,
      department: currentDept,
      currentPhase,
    },
  });

  } catch (error) {
    console.error("[GET /api/reviews] error:", error);
    return NextResponse.json(
      { error: "심사 목록을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
