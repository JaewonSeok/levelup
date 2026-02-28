import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType, Prisma } from "@prisma/client";
import { recalculatePointsFromGrades } from "@/lib/points/recalculate";
import { calculateFinalPoints, getNextLevel } from "@/lib/pointCalculation";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

function getCurrentYear() {
  return new Date().getFullYear();
}

// ── GET /api/points ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";
  const keyword = searchParams.get("keyword") ?? "";
  const isMetFilter = searchParams.get("isMet") ?? "all";
  const position = searchParams.get("position") ?? "";
  const employmentType = searchParams.get("employmentType") ?? "";
  const level = searchParams.get("level") ?? "";
  const hireDateFrom = searchParams.get("hireDateFrom") ?? "";
  const hireDateTo = searchParams.get("hireDateTo") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));

  const CURRENT_YEAR = getCurrentYear();

  // 등급 기준 설정이 있으면 포인트 재계산 (비동기, 응답 차단 없음)
  prisma.gradeCriteria.count().then((cnt) => {
    if (cnt > 0) recalculatePointsFromGrades().catch((e) => console.error("[points/GET] recalculate error:", e));
  }).catch(() => {});

  // ── 필터 조건 구성 ─────────────────────────────────────────
  const conditions: Prisma.UserWhereInput[] = [
    { role: { not: Role.DEPT_HEAD } },
    { isActive: true },
  ];

  if (department) conditions.push({ department: { contains: department, mode: "insensitive" } });
  if (team) conditions.push({ team: { contains: team, mode: "insensitive" } });
  if (keyword) conditions.push({ name: { contains: keyword, mode: "insensitive" } });
  if (position) conditions.push({ position: { contains: position, mode: "insensitive" } });
  if (level && Object.values(Level).includes(level as Level)) {
    conditions.push({ level: level as Level });
  }
  if (employmentType && Object.values(EmploymentType).includes(employmentType as EmploymentType)) {
    conditions.push({ employmentType: employmentType as EmploymentType });
  }
  if (hireDateFrom || hireDateTo) {
    const hireDateFilter: { gte?: Date; lte?: Date } = {};
    if (hireDateFrom) hireDateFilter.gte = new Date(hireDateFrom);
    if (hireDateTo) hireDateFilter.lte = new Date(hireDateTo);
    conditions.push({ hireDate: hireDateFilter });
  }
  const where: Prisma.UserWhereInput =
    conditions.length > 0 ? { AND: conditions } : {};

  // ── 쿼리 (isMet 필터는 JS에서 처리) ──────────────────────
  const [users, metaDepts, metaTeams] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        department: true,
        team: true,
        level: true,
        position: true,
        employmentType: true,
        hireDate: true,
        yearsOfService: true,
        competencyLevel: true,
        levelUpYear: true,
        isActive: true,
        points: { orderBy: { year: "asc" } },
      },
      orderBy: [{ department: "asc" }, { team: "asc" }, { name: "asc" }],
    }),
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

  // 평가등급 + 학점 누적값 + 포인트/레벨 기준 일괄 조회
  const allUserIds = users.map((u) => u.id);
  const [allGrades, latestCredits, gradeCriteriaAll, levelCriteriaAll] = await Promise.all([
    prisma.performanceGrade.findMany({
      where: { userId: { in: allUserIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
      select: { userId: true, year: true, grade: true },
    }),
    prisma.credit.findMany({
      where: { userId: { in: allUserIds }, year: 2025 },
      select: { userId: true, score: true },
    }),
    prisma.gradeCriteria.findMany(),
    // year 필터 없이 전체 로드 후 최신 연도 기준 사용 (2025 저장 데이터도 2026에서 활용)
    prisma.levelCriteria.findMany({
      select: { level: true, requiredPoints: true, year: true },
      orderBy: { year: "desc" },
    }),
  ]);

  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }
  const creditMap = new Map(latestCredits.map((c) => [c.userId, c.score]));

  // LevelCriteria: level별 최신 연도 기준 사용
  const lcMap = new Map<string, { requiredPoints: number | null }>();
  for (const c of levelCriteriaAll) {
    if (!lcMap.has(c.level as string)) {
      lcMap.set(c.level as string, { requiredPoints: c.requiredPoints });
    }
  }
  // 가감점 일괄 조회
  const bonusPenaltyRecords = await prisma.bonusPenalty.findMany({
    where: { userId: { in: allUserIds } },
    select: { userId: true, type: true, points: true },
  });
  const bpMap = new Map<string, { bonusTotal: number; penaltyTotal: number }>();
  for (const bp of bonusPenaltyRecords) {
    if (!bpMap.has(bp.userId)) bpMap.set(bp.userId, { bonusTotal: 0, penaltyTotal: 0 });
    const entry = bpMap.get(bp.userId)!;
    if (bp.points > 0) entry.bonusTotal += bp.points;
    else entry.penaltyTotal += Math.abs(bp.points);
  }

  // ── 포인트 데이터 가공 ─────────────────────────────────────
  const allYearsSet = new Set<number>();

  const employeesData = users.map((user) => {
    const years = user.yearsOfService ?? 0;
    const startYear = Math.max(years > 0 ? CURRENT_YEAR - years + 1 : CURRENT_YEAR, 2021);
    const hireYear = user.hireDate ? new Date(user.hireDate).getFullYear() : null;

    const pointsByYear = new Map(user.points.map((p) => [p.year, p]));

    // 연도별 데이터 구성 (startYear ~ currentYear)
    const yearData: Record<
      number,
      { score: number | null; isAutoFill: boolean }
    > = {};

    for (let yr = startYear; yr <= CURRENT_YEAR; yr++) {
      allYearsSet.add(yr);
      const point = pointsByYear.get(yr);

      // 신규입사자 처리: hireYear보다 이전 연도에 포인트 없으면 G기준 2점 자동부여
      const isPreHire = hireYear !== null && yr < hireYear;
      const shouldAutoFill = isPreHire && !point;

      yearData[yr] = {
        score: point
          ? point.score
          : shouldAutoFill
            ? 2
            : null,
        isAutoFill: shouldAutoFill,
      };
    }

    // 집계 — GradeCriteria 기반 실시간 계산 (stale Point.cumulative 비의존)
    const totalMerit = user.points.reduce((s, p) => s + p.merit, 0);
    const totalPenalty = user.points.reduce((s, p) => s + p.penalty, 0);
    const userGrades = gradeMap.get(user.id) ?? {};
    const userLc = user.level ? lcMap.get(getNextLevel(user.level as string) ?? "") : null;

    const { bonusTotal = 0, penaltyTotal = 0 } = bpMap.get(user.id) ?? {};
    const adjustment = bonusTotal - penaltyTotal;

    let cumulative: number;
    if (gradeCriteriaAll.length > 0) {
      // 등급 기준이 설정된 경우: 공통 함수로 grade + merit/penalty + adjustment 합산
      cumulative = calculateFinalPoints(userGrades, gradeCriteriaAll, CURRENT_YEAR, user.yearsOfService ?? 0, totalMerit, totalPenalty, adjustment);
    } else {
      // GradeCriteria 미설정 시 DB Point 값 fallback (cumulative에 merit/penalty 포함) + 가감점
      const latestPoint = user.points[user.points.length - 1];
      cumulative =
        (latestPoint?.cumulative ??
        Object.values(yearData).reduce((s, d) => s + (d.score ?? 0), 0) +
          totalMerit -
          totalPenalty) + adjustment;
    }

    const isMet = userLc
      ? cumulative >= (userLc.requiredPoints ?? 0)
      : false;

    const creditCumulative = creditMap.get(user.id) ?? 0;
    const totalPoints = cumulative + creditCumulative; // 포인트합 + 학점

    return {
      id: user.id,
      name: user.name,
      department: user.department,
      team: user.team,
      level: user.level as string | null,
      position: user.position,
      employmentType: user.employmentType as string | null,
      hireDate: user.hireDate?.toISOString() ?? null,
      yearsOfService: user.yearsOfService,
      competencyLevel: user.competencyLevel,
      levelUpYear: user.levelUpYear,
      isActive: user.isActive,
      startYear,
      yearData,
      totalMerit,
      totalPenalty,
      cumulative,
      isMet,
      creditCumulative,
      bonusTotal,
      penaltyTotal,
      adjustment,
      totalPoints,
      grades: {
        2021: userGrades[2021] ?? null,
        2022: userGrades[2022] ?? null,
        2023: userGrades[2023] ?? null,
        2024: userGrades[2024] ?? null,
        2025: userGrades[2025] ?? null,
      },
    };
  });

  const yearColumns = Array.from(allYearsSet).sort((a, b) => a - b);

  // isMet JS 필터링 + 페이지네이션
  const filteredData = isMetFilter === "Y"
    ? employeesData.filter((e) => e.isMet)
    : isMetFilter === "N"
      ? employeesData.filter((e) => !e.isMet)
      : employeesData;
  const total = filteredData.length;
  const pagedData = filteredData.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({
    employees: pagedData,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    yearColumns,
    currentYear: CURRENT_YEAR,
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
  });
}

// ── POST /api/points ───────────────────────────────────────────
// Body:
// {
//   userId: string,
//   yearScores: { year: number; score: number }[],
//   totalMerit: number,
//   totalPenalty: number
// }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const CURRENT_YEAR = getCurrentYear();

  let body: {
    userId: string;
    yearScores: { year: number; score: number }[];
    yearGrades?: { year: number; grade: string }[];
    totalMerit: number;
    totalPenalty: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { userId, yearScores, yearGrades, totalMerit = 0, totalPenalty = 0 } = body;

  if (!userId || !Array.isArray(yearScores)) {
    return NextResponse.json({ error: "필수 값이 없습니다." }, { status: 400 });
  }

  // 직원 및 직급 확인
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, level: true },
  });
  if (!user) {
    return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  // LevelCriteria 조회 (충족 여부 판단)
  const criteria = user.level
    ? await prisma.levelCriteria.findFirst({
        where: { level: user.level, year: CURRENT_YEAR },
      })
    : null;

  // 저장할 연도 정렬 (오름차순)
  const sortedYears = [...yearScores]
    .filter((ys) => ys.score !== null && !isNaN(ys.score))
    .sort((a, b) => a.year - b.year);

  // yearScores가 비어있어도 merit/penalty가 있으면 현재 연도로 생성
  if (sortedYears.length === 0 && (totalMerit !== 0 || totalPenalty !== 0)) {
    sortedYears.push({ year: CURRENT_YEAR, score: 0 });
  }

  if (sortedYears.length === 0) {
    return NextResponse.json({ error: "저장할 데이터가 없습니다." }, { status: 400 });
  }

  const latestYear = sortedYears[sortedYears.length - 1].year;

  try {
    await prisma.$transaction(async (tx) => {
      let running = 0;

      for (const { year, score } of sortedYears) {
        running += score;
        const isLatest = year === latestYear;
        const merit = isLatest ? totalMerit : 0;
        const penalty = isLatest ? totalPenalty : 0;
        const cumulativeAtYear = running + (isLatest ? totalMerit - totalPenalty : 0);
        const isMet = criteria && criteria.requiredPoints != null && criteria.requiredPoints > 0 ? cumulativeAtYear >= criteria.requiredPoints : false;

        await tx.point.upsert({
          where: { userId_year: { userId, year } },
          create: {
            userId,
            year,
            score,
            merit,
            penalty,
            cumulative: cumulativeAtYear,
            isMet,
          },
          update: {
            score,
            merit,
            penalty,
            cumulative: cumulativeAtYear,
            isMet,
          },
        });
      }

      // 평가등급 저장 (선택적)
      if (yearGrades && yearGrades.length > 0) {
        for (const { year, grade } of yearGrades) {
          if (!grade) continue;
          await tx.performanceGrade.upsert({
            where: { userId_year: { userId, year } },
            create: { userId, year, grade },
            update: { grade },
          });
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: `저장 실패: ${msg}` }, { status: 500 });
  }

  // 저장 후 window 합산 cumulative 재계산 (GET과 동일 로직)
  const [savedGrades, savedGradeCriteria, savedLevelCriteria, bpSum] = await Promise.all([
    prisma.performanceGrade.findMany({
      where: { userId, year: { in: [2021, 2022, 2023, 2024, 2025] } },
      select: { year: true, grade: true },
    }),
    prisma.gradeCriteria.findMany(),
    prisma.levelCriteria.findMany({
      select: { level: true, requiredPoints: true, year: true },
      orderBy: { year: "desc" },
    }),
    prisma.bonusPenalty.findMany({
      where: { userId },
      select: { points: true },
    }),
  ]);

  function findGradePointsPost(grade: string, yr: number): number {
    if (!grade) return 2;
    for (const gc of savedGradeCriteria) {
      if (gc.grade !== grade) continue;
      const range = gc.yearRange;
      if (range === String(yr)) return gc.points;
      const parts = range.split("-");
      if (parts.length === 2) {
        const from = Number(parts[0]);
        const to = Number(parts[1]);
        if (!isNaN(from) && !isNaN(to) && yr >= from && yr <= to) return gc.points;
      }
    }
    return 2;
  }

  const savedLcMap = new Map<string, { requiredPoints: number | null }>();
  for (const c of savedLevelCriteria) {
    if (!savedLcMap.has(c.level as string)) {
      savedLcMap.set(c.level as string, { requiredPoints: c.requiredPoints });
    }
  }

  const savedUserLc = user.level ? savedLcMap.get(user.level as string) : null;
  const savedYearsOfService = (await prisma.user.findUnique({ where: { id: userId }, select: { yearsOfService: true } }))?.yearsOfService ?? 0;
  const savedGradeMap = new Map(savedGrades.map((g) => [g.year, g.grade]));
  const savedTenureRange = Math.min(savedYearsOfService, 5);

  let savedWindowSum = 0;
  for (let i = 0; i < savedTenureRange; i++) {
    const yr = 2025 - i;
    if (yr < 2021) break;
    savedWindowSum += findGradePointsPost(savedGradeMap.get(yr) ?? "", yr);
  }

  const savedAdjustment = bpSum.reduce((s, b) => s + b.points, 0);
  // GET과 동일하게: grade window 합 + 상점/벌점(Point) + 가감점(BonusPenalty)
  const savedCumulative = savedWindowSum + totalMerit - totalPenalty + savedAdjustment;
  const savedTotalPoints = savedCumulative;
  const savedIsMet = savedUserLc?.requiredPoints != null
    ? savedTotalPoints >= savedUserLc.requiredPoints
    : false;

  return NextResponse.json({
    success: true,
    userId,
    totalMerit,
    totalPenalty,
    cumulative: savedCumulative,
    totalPoints: savedTotalPoints,
    adjustment: savedAdjustment,
    isMet: savedIsMet,
  });
}

// ── DELETE /api/points?userId=xxx&year=2023 (SYSTEM_ADMIN only) ──
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "시스템 관리자만 삭제할 수 있습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const yearStr = searchParams.get("year");

  if (!userId || !yearStr) {
    return NextResponse.json({ error: "userId와 year가 필요합니다." }, { status: 400 });
  }

  const year = Number(yearStr);
  if (isNaN(year)) {
    return NextResponse.json({ error: "유효하지 않은 연도입니다." }, { status: 400 });
  }

  await prisma.point.deleteMany({ where: { userId, year } });

  return NextResponse.json({ success: true });
}
