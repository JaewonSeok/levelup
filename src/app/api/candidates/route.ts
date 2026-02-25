import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType, Prisma } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

function getCurrentYear() {
  return new Date().getFullYear();
}

// ── GET /api/candidates ──────────────────────────────────────────
// 포인트 또는 학점 충족 직원 목록 조회 + Candidate 레코드 자동 생성
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? getCurrentYear());
  const meetType = searchParams.get("meetType") ?? "all"; // all | point | credit | both
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";
  const keyword = searchParams.get("keyword") ?? "";
  const position = searchParams.get("position") ?? "";
  const employmentType = searchParams.get("employmentType") ?? "";
  const hireDateFrom = searchParams.get("hireDateFrom") ?? "";
  const hireDateTo = searchParams.get("hireDateTo") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));

  // ── 필터 조건 구성 ──────────────────────────────────────────
  const conditions: Prisma.UserWhereInput[] = [
    { role: { not: Role.DEPT_HEAD } },
  ];

  if (department) conditions.push({ department: { contains: department, mode: "insensitive" } });
  if (team) conditions.push({ team: { contains: team, mode: "insensitive" } });
  if (keyword) conditions.push({ name: { contains: keyword, mode: "insensitive" } });
  if (position) conditions.push({ position: { contains: position, mode: "insensitive" } });
  if (employmentType && Object.values(EmploymentType).includes(employmentType as EmploymentType)) {
    conditions.push({ employmentType: employmentType as EmploymentType });
  }
  if (hireDateFrom || hireDateTo) {
    const hireDateFilter: { gte?: Date; lte?: Date } = {};
    if (hireDateFrom) hireDateFilter.gte = new Date(hireDateFrom);
    if (hireDateTo) hireDateFilter.lte = new Date(hireDateTo);
    conditions.push({ hireDate: hireDateFilter });
  }

  // 충족 조건 필터
  if (meetType === "point") {
    conditions.push({
      OR: [
        { points: { some: { isMet: true } } },
        { candidates: { some: { year } } },
      ],
    });
  } else if (meetType === "credit") {
    conditions.push({
      OR: [
        { credits: { some: { isMet: true } } },
        { candidates: { some: { year } } },
      ],
    });
  } else if (meetType === "both") {
    conditions.push({ points: { some: { isMet: true } } });
    conditions.push({ credits: { some: { isMet: true } } });
  } else {
    // all: 포인트/학점 충족 또는 수동 추가된 대상자
    conditions.push({
      OR: [
        { points: { some: { isMet: true } } },
        { credits: { some: { isMet: true } } },
        { candidates: { some: { year } } },
      ],
    });
  }

  const where: Prisma.UserWhereInput = conditions.length > 0 ? { AND: conditions } : {};

  // ── 쿼리 ──────────────────────────────────────────────────
  const [total, users, metaDepts, metaTeams] = await Promise.all([
    prisma.user.count({ where }),
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
        points: { orderBy: { year: "asc" } },
        credits: { orderBy: { year: "asc" } },
        candidates: { where: { year } },
      },
      orderBy: [{ department: "asc" }, { team: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
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

  // 평가등급 일괄 조회 (2021~2025)
  const userIds = users.map((u) => u.id);
  const allGrades = await prisma.performanceGrade.findMany({
    where: { userId: { in: userIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
    select: { userId: true, year: true, grade: true },
  });
  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }

  // ── 직원별 데이터 가공 + Candidate 레코드 자동 생성 ──────
  const employeesData = await Promise.all(
    users.map(async (user) => {
      const latestPoint = user.points[user.points.length - 1];
      const latestCredit = user.credits[user.credits.length - 1];
      const pointCumulative = latestPoint?.cumulative ?? 0;
      const creditCumulative = latestCredit?.cumulative ?? 0;
      const pointMet = user.points.some((p) => p.isMet);
      const creditMet = user.credits.some((c) => c.isMet);

      // 기존 Candidate 레코드 or 자동 생성
      const existingCandidate = user.candidates[0];
      const candidate = existingCandidate
        ? await prisma.candidate.update({
            where: { id: existingCandidate.id },
            data: { pointMet, creditMet },
          })
        : await prisma.candidate.create({
            data: { userId: user.id, year, pointMet, creditMet, source: "manual" },
          });

      const userGrades = gradeMap.get(user.id) ?? {};

      return {
        candidateId: candidate.id,
        userId: user.id,
        name: user.name,
        department: user.department,
        team: user.team,
        level: user.level as string | null,
        position: user.position,
        employmentType: user.employmentType as string | null,
        hireDate: user.hireDate?.toISOString() ?? null,
        yearsOfService: user.yearsOfService,
        competencyLevel: user.competencyLevel,
        pointCumulative,
        creditCumulative,
        pointMet,
        creditMet,
        isReviewTarget: candidate.isReviewTarget,
        source: candidate.source,
        savedAt: candidate.savedAt?.toISOString() ?? null,
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

  return NextResponse.json({
    employees: employeesData,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
  });
}

// ── POST /api/candidates (SYSTEM_ADMIN only) ─────────────────────
// Body (form-based):
//   { year, name, department, team, level, employmentType, hireDate,
//     yearsOfService?, pointCumulative?, creditCumulative? }
// Body (userId-based legacy):
//   { userId, year }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json(
      { error: "시스템 관리자만 대상자를 추가할 수 있습니다." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const year = Number(body.year);
  if (!year) {
    return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });
  }

  let userId: string;

  // ── 폼 기반 추가 (직원 정보 직접 입력) ──────────────────────
  if (!body.userId && body.name) {
    const { name, department, team, level, hireDate, yearsOfService, pointCumulative, creditCumulative } = body as {
      name: string;
      department: string;
      team: string;
      level: string;
      hireDate: string;
      yearsOfService?: number;
      pointCumulative?: number;
      creditCumulative?: number;
    };

    if (!name || !department || !team || !level || !hireDate) {
      return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
    }
    if (!Object.values(Level).includes(level as Level)) {
      return NextResponse.json({ error: "유효하지 않은 레벨입니다." }, { status: 400 });
    }

    const hireDateParsed = new Date(hireDate);
    if (isNaN(hireDateParsed.getTime())) {
      return NextResponse.json({ error: "유효하지 않은 입사일입니다." }, { status: 400 });
    }

    // 동명이인 + 동일 입사일로 기존 직원 조회
    const existingUser = await prisma.user.findFirst({
      where: { name, hireDate: hireDateParsed },
    });

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const newUser = await prisma.user.create({
        data: {
          name,
          department,
          team,
          level: level as Level,
          hireDate: hireDateParsed,
          yearsOfService: yearsOfService ?? null,
          isActive: true,
        },
      });
      userId = newUser.id;
    }

    // 포인트/학점 충족 여부 판단
    const criteria = await prisma.levelCriteria.findFirst({
      where: { level: level as Level, year },
    });
    const pointMet = criteria && pointCumulative != null
      ? pointCumulative >= criteria.requiredPoints
      : false;
    const creditMet = criteria && creditCumulative != null
      ? creditCumulative >= criteria.requiredCredits
      : false;

    const candidate = await prisma.candidate.upsert({
      where: { userId_year: { userId, year } },
      create: { userId, year, pointMet, creditMet, isReviewTarget: true, source: "manual" },
      update: { isReviewTarget: true, pointMet, creditMet },
    });

    return NextResponse.json({ success: true, candidateId: candidate.id }, { status: 201 });
  }

  // ── userId 기반 추가 (레거시) ────────────────────────────────
  const legacyUserId = String(body.userId ?? "");
  if (!legacyUserId) {
    return NextResponse.json({ error: "userId 또는 직원 정보가 필요합니다." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: legacyUserId } });
  if (!user) {
    return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  const candidate = await prisma.candidate.upsert({
    where: { userId_year: { userId: legacyUserId, year } },
    create: { userId: legacyUserId, year, pointMet: false, creditMet: false, isReviewTarget: true, source: "manual" },
    update: { isReviewTarget: true },
  });

  return NextResponse.json({ success: true, candidateId: candidate.id }, { status: 201 });
}
