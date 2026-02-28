import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType, Prisma } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

function getCurrentYear() {
  return new Date().getFullYear();
}

function getNextLevel(currentLevel: string | null): string | null {
  if (!currentLevel) return null;
  const order = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const idx = order.indexOf(currentLevel);
  if (idx === -1 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

// ── GET /api/credits ───────────────────────────────────────────
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
  const MAX_CREDIT_YEAR = 2025; // 학점 표시 최대 연도 (2026년 컬럼 없음)

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
  const [users, metaDepts, metaTeams, levelCriteriaList] = await Promise.all([
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
        credits: { orderBy: { year: "asc" } },
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
    prisma.levelCriteria.findMany({
      where: { year: CURRENT_YEAR },
      select: { level: true, minTenure: true, requiredCredits: true, requiredPoints: true },
    }),
  ]);

  const levelCriteriaMap = new Map(
    levelCriteriaList.map((c) => [c.level as string, c])
  );

  // ── 학점 데이터 가공 ───────────────────────────────────────
  const allYearsSet = new Set<number>();

  const employeesData = users.map((user) => {
    const years = user.yearsOfService ?? 0;
    const startYear = Math.max(years > 0 ? CURRENT_YEAR - years + 1 : CURRENT_YEAR, 2021);


    const creditsByYear = new Map(user.credits.map((c) => [c.year, c]));

    // 연도별 데이터 구성 (최대 MAX_CREDIT_YEAR까지, 2026년 미표시)
    const yearData: Record<number, { score: number | null; isAutoFill: boolean; isRetroactive: boolean }> = {};

    for (let yr = startYear; yr <= Math.min(CURRENT_YEAR, MAX_CREDIT_YEAR); yr++) {
      allYearsSet.add(yr);
      const credit = creditsByYear.get(yr);

      // 2025년 이전 연도 소급 적용 여부 (2025년부터 도입된 제도)
      const isRetroactive = yr < 2025 && !!credit;

      yearData[yr] = {
        score: credit ? credit.score : null,
        isAutoFill: false,
        isRetroactive,
      };
    }

    // 소급 학점: startYear 이전에 실제 Credit 레코드가 있으면 yearData에 포함 (소급 적용 케이스)
    for (const credit of user.credits) {
      if (credit.year < startYear && credit.year <= MAX_CREDIT_YEAR && !(credit.year in yearData)) {
        allYearsSet.add(credit.year);
        yearData[credit.year] = { score: credit.score, isAutoFill: false, isRetroactive: true };
      }
    }

    const userLevelCriteria = user.level
      ? levelCriteriaMap.get(getNextLevel(user.level as string) ?? "")
      : null;

    // 누적 학점 = 2025년 학점만 (2025년 신규 도입, 이전 연도 없음)
    const credit2025Entry = user.credits.find((c) => c.year === 2025);
    const cumulative = credit2025Entry?.score ?? 0;

    // 학점 충족 판정 = 2025년 학점 >= 다음 레벨의 requiredCredits
    let isMet = false;
    if (userLevelCriteria) {
      const reqCredits = userLevelCriteria.requiredCredits;
      isMet = reqCredits != null && reqCredits > 0 ? cumulative >= reqCredits : false;
    }

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
      cumulative,
      isMet,
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

// ── POST /api/credits ──────────────────────────────────────────
// Body: { userId, yearScores: { year: number; score: number }[] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const CURRENT_YEAR = getCurrentYear();

  let body: { userId: string; yearScores: { year: number; score: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { userId, yearScores } = body;

  if (!userId || !Array.isArray(yearScores) || yearScores.length === 0) {
    return NextResponse.json({ error: "필수 값이 없습니다." }, { status: 400 });
  }

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

  const sortedYears = [...yearScores]
    .filter((ys) => !isNaN(ys.score))
    .sort((a, b) => a.year - b.year);

  try {
    await prisma.$transaction(async (tx) => {
      let running = 0;

      for (const { year, score } of sortedYears) {
        running += score;
        // 충족: 누적 학점 >= 기준 학점
        const isMet = criteria && criteria.requiredCredits != null && criteria.requiredCredits > 0 ? running >= criteria.requiredCredits : false;

        await tx.credit.upsert({
          where: { userId_year: { userId, year } },
          create: { userId, year, score, cumulative: running, isMet },
          update: { score, cumulative: running, isMet },
        });
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: `저장 실패: ${msg}` }, { status: 500 });
  }

  const updatedCredits = await prisma.credit.findMany({
    where: { userId },
    orderBy: { year: "asc" },
  });

  const latestCredit = updatedCredits[updatedCredits.length - 1];

  return NextResponse.json({
    success: true,
    userId,
    cumulative: latestCredit?.cumulative ?? 0,
    isMet: updatedCredits.some((c) => c.isMet),
    credits: updatedCredits,
  });
}

// ── DELETE /api/credits?userId=xxx&year=2023 (SYSTEM_ADMIN only) ──
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

  await prisma.credit.deleteMany({ where: { userId, year } });

  return NextResponse.json({ success: true });
}
