import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { calculateFinalPoints } from "@/lib/pointCalculation";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";
  const keyword = searchParams.get("keyword") ?? "";
  const level = searchParams.get("level") ?? "";
  const position = searchParams.get("position") ?? "";
  const employmentType = searchParams.get("employmentType") ?? "";
  const isActiveParam = searchParams.get("isActive") ?? "all";
  const hireDateFrom = searchParams.get("hireDateFrom") ?? "";
  const hireDateTo = searchParams.get("hireDateTo") ?? "";
  const levelUpYear = searchParams.get("levelUpYear") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "20")));

  // ── RBAC 스코프 ────────────────────────────────────────────
  const { role, id: userId, department: userDept, team: userTeam } = session.user;

  let rbacWhere: Prisma.UserWhereInput = {};
  if (role === Role.TEAM_MEMBER) {
    rbacWhere = { id: userId };
  } else if (role === Role.TEAM_LEADER) {
    rbacWhere = {
      OR: [
        { id: userId },
        {
          department: userDept ?? "",
          team: userTeam ?? "",
          role: Role.TEAM_MEMBER,
        },
      ],
    };
  } else if (role === Role.SECTION_CHIEF) {
    rbacWhere = {
      department: userDept ?? "",
      role: { in: [Role.TEAM_MEMBER, Role.TEAM_LEADER, Role.SECTION_CHIEF] },
    };
  } else if (role === Role.DEPT_HEAD) {
    rbacWhere = { department: userDept ?? "" };
  }
  // HR_TEAM, CEO, SYSTEM_ADMIN: 전체 조회 (rbacWhere = {})

  // ── 검색 필터 ──────────────────────────────────────────────
  const filterConditions: Prisma.UserWhereInput[] = [
    { role: { not: Role.DEPT_HEAD } },
  ];

  if (department) {
    filterConditions.push({ department: { contains: department, mode: "insensitive" } });
  }
  if (team) {
    filterConditions.push({ team: { contains: team, mode: "insensitive" } });
  }
  if (keyword) {
    filterConditions.push({
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { department: { contains: keyword, mode: "insensitive" } },
        { team: { contains: keyword, mode: "insensitive" } },
      ],
    });
  }
  if (level && Object.values(Level).includes(level as Level)) {
    filterConditions.push({ level: level as Level });
  }
  if (position) {
    filterConditions.push({ position: { contains: position, mode: "insensitive" } });
  }
  if (employmentType && Object.values(EmploymentType).includes(employmentType as EmploymentType)) {
    filterConditions.push({ employmentType: employmentType as EmploymentType });
  }
  if (isActiveParam === "Y") filterConditions.push({ isActive: true });
  if (isActiveParam === "N") filterConditions.push({ isActive: false });
  if (hireDateFrom || hireDateTo) {
    const hireDateFilter: { gte?: Date; lte?: Date } = {};
    if (hireDateFrom) hireDateFilter.gte = new Date(hireDateFrom);
    if (hireDateTo) hireDateFilter.lte = new Date(hireDateTo);
    filterConditions.push({ hireDate: hireDateFilter });
  }
  if (levelUpYear) {
    const yearNum = Number(levelUpYear);
    if (!isNaN(yearNum)) filterConditions.push({ levelUpYear: yearNum });
  }

  const where: Prisma.UserWhereInput =
    filterConditions.length > 0
      ? { AND: [rbacWhere, ...filterConditions] }
      : rbacWhere;

  // ── 쿼리 ──────────────────────────────────────────────────
  try {
    const [total, rawEmployees, metaDepts, metaTeams, gradeCriteriaAll] = await Promise.all([
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
          resignDate: true,
          competencyLevel: true,
          yearsOfService: true,
          levelUpYear: true,
          isActive: true,
          role: true,
          performanceGrades: { select: { year: true, grade: true } },
          points: { select: { merit: true, penalty: true } },
          credits: { select: { cumulative: true }, orderBy: { year: "desc" }, take: 1 },
        },
        orderBy: [{ department: "asc" }, { team: "asc" }, { name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.findMany({
        where: rbacWhere,
        distinct: ["department"],
        select: { department: true },
        orderBy: { department: "asc" },
      }),
      prisma.user.findMany({
        where: rbacWhere,
        distinct: ["team"],
        select: { team: true },
        orderBy: { team: "asc" },
      }),
      prisma.gradeCriteria.findMany(),
    ]);

    // BonusPenalty (총점 계산용)
    const empIds = rawEmployees.map((e) => e.id);
    const bpRecordsEmp = await prisma.bonusPenalty.findMany({
      where: { userId: { in: empIds } },
      select: { userId: true, points: true },
    });
    const bpMapEmp = new Map<string, number>();
    for (const bp of bpRecordsEmp) {
      bpMapEmp.set(bp.userId, (bpMapEmp.get(bp.userId) ?? 0) + bp.points);
    }

    // 평가등급 맵 + 학점 누적값 + 포인트 변환 (포인트 관리 페이지와 동일한 공통 함수 사용)
    const CURRENT_YEAR = new Date().getFullYear();
    const employees = rawEmployees.map((emp) => {
      const { performanceGrades, credits, points: pointRecords, ...rest } = emp;
      const grades: Record<string, string> = {};
      const gradesNumeric: Record<number, string> = {};
      for (const g of performanceGrades) {
        grades[String(g.year)] = g.grade;
        gradesNumeric[g.year] = g.grade;
      }
      const creditTotal = credits[0]?.cumulative ?? null;

      // 포인트 계산: grade window 합 + Point.merit/penalty + BonusPenalty adjustment
      const totalMerit = pointRecords.reduce((s, p) => s + p.merit, 0);
      const totalPenalty = pointRecords.reduce((s, p) => s + p.penalty, 0);
      const adjustment = bpMapEmp.get(emp.id) ?? 0;
      const totalPoints: number | null = gradeCriteriaAll.length > 0
        ? calculateFinalPoints(gradesNumeric, gradeCriteriaAll, CURRENT_YEAR, emp.yearsOfService ?? 0, totalMerit, totalPenalty, adjustment)
        : null;

      return { ...rest, grades, creditTotal, totalPoints };
    });

    return NextResponse.json({
      employees,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      meta: {
        departments: metaDepts.map((d) => d.department).filter(Boolean),
        teams: metaTeams.map((t) => t.team).filter(Boolean),
      },
    });
  } catch (error) {
    // [TEMP DEBUG] 진단용 - 확인 후 제거 예정
    console.error("[GET /api/employees] error:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다.", _debug: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// ── POST /api/employees (SYSTEM_ADMIN only) ──────────────────────
// Body: { name, department, team, level?, position?,
//         employmentType?, hireDate?, competencyLevel?, yearsOfService?, levelUpYear?,
//         pointScore?, creditScore? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json(
      { error: "시스템 관리자만 직원을 추가할 수 있습니다." },
      { status: 403 }
    );
  }

  let body: {
    name: string;
    department: string;
    team: string;
    level?: string | null;
    position?: string | null;
    employmentType?: string | null;
    hireDate?: string | null;
    competencyLevel?: string | null;
    yearsOfService?: number | null;
    levelUpYear?: number | null;
    pointScore?: number;
    creditScore?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  if (!body.name || !body.department || !body.team) {
    return NextResponse.json(
      { error: "필수 항목이 없습니다. (이름, 본부, 팀)" },
      { status: 400 }
    );
  }

  // 이메일 자동 생성 (unique 보장)
  const placeholderEmail = `${body.name.replace(/\s/g, "").toLowerCase()}_${Date.now()}@placeholder.com`;
  // [KISA2021-23] 하드코드 비밀번호 금지 → CSPRNG 임시 비밀번호 생성
  const hashedPassword = await bcrypt.hash(randomBytes(16).toString("hex"), 12);

  const POINT_YEAR = new Date().getFullYear();
  const CREDIT_YEAR = Math.min(POINT_YEAR, 2025);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: body.name,
        email: placeholderEmail,
        password: hashedPassword,
        department: body.department,
        team: body.team,
        level:
          body.level && Object.values(Level).includes(body.level as Level)
            ? (body.level as Level)
            : null,
        position: body.position ?? null,
        employmentType:
          body.employmentType &&
          Object.values(EmploymentType).includes(body.employmentType as EmploymentType)
            ? (body.employmentType as EmploymentType)
            : null,
        hireDate: body.hireDate ? new Date(body.hireDate) : null,
        competencyLevel: body.competencyLevel ?? null,
        yearsOfService: body.yearsOfService ?? null,
        levelUpYear: body.levelUpYear ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        team: true,
        level: true,
        position: true,
        employmentType: true,
        hireDate: true,
        competencyLevel: true,
        yearsOfService: true,
        levelUpYear: true,
        isActive: true,
        role: true,
      },
    });

    const pointScore = body.pointScore ?? 0;
    const creditScore = body.creditScore ?? 0;

    // Point 레코드 생성 (포인트 관리에 표시용)
    await tx.point.create({
      data: {
        userId: created.id,
        year: POINT_YEAR,
        score: pointScore,
        merit: 0,
        penalty: 0,
        cumulative: pointScore,
        isMet: false,
      },
    });

    // Credit 레코드 생성 (학점 관리에 표시용, 최대 2025년)
    await tx.credit.create({
      data: {
        userId: created.id,
        year: CREDIT_YEAR,
        score: creditScore,
        cumulative: creditScore,
        isMet: false,
      },
    });

    return created;
  });

  return NextResponse.json({ success: true, employee: user }, { status: 201 });
}
