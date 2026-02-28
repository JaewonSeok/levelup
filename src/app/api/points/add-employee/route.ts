import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// POST /api/points/add-employee
// Body: { name, department, team, level?, yearsOfService?, grade2021?, grade2022?, grade2023?, grade2024?, grade2025?, pointScore? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const CURRENT_YEAR = new Date().getFullYear();

  let body: {
    name: string;
    department: string;
    team: string;
    level?: string | null;
    yearsOfService?: number | null;
    grade2021?: string | null;
    grade2022?: string | null;
    grade2023?: string | null;
    grade2024?: string | null;
    grade2025?: string | null;
    pointScore?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { name, department, team, level, yearsOfService, grade2021, grade2022, grade2023, grade2024, grade2025, pointScore } = body;

  if (!name || !department || !team) {
    return NextResponse.json({ error: "이름, 본부, 팀은 필수입니다." }, { status: 400 });
  }

  // 동명이인 체크
  const existing = await prisma.user.findFirst({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: `동일한 이름의 직원이 이미 존재합니다. (${name})` }, { status: 400 });
  }

  const validLevel = level && Object.values(Level).includes(level as Level) ? (level as Level) : null;

  // 직원 생성
  const user = await prisma.user.create({
    data: {
      name,
      department,
      team,
      level: validLevel,
      employmentType: EmploymentType.REGULAR,
      yearsOfService: yearsOfService ?? null,
      isActive: true,
    },
  });

  // 평가등급 저장
  const gradeEntries: { userId: string; year: number; grade: string }[] = [];
  if (grade2021) gradeEntries.push({ userId: user.id, year: 2021, grade: grade2021 });
  if (grade2022) gradeEntries.push({ userId: user.id, year: 2022, grade: grade2022 });
  if (grade2023) gradeEntries.push({ userId: user.id, year: 2023, grade: grade2023 });
  if (grade2024) gradeEntries.push({ userId: user.id, year: 2024, grade: grade2024 });
  if (grade2025) gradeEntries.push({ userId: user.id, year: 2025, grade: grade2025 });

  if (gradeEntries.length > 0) {
    await prisma.performanceGrade.createMany({ data: gradeEntries });
  }

  // 포인트 저장 (현재 연도)
  if (pointScore != null) {
    const criteria = validLevel
      ? await prisma.levelCriteria.findFirst({ where: { level: validLevel, year: CURRENT_YEAR } })
      : null;
    const isMet = criteria && criteria.requiredPoints != null && criteria.requiredPoints > 0 ? pointScore >= criteria.requiredPoints : false;

    await prisma.point.create({
      data: {
        userId: user.id,
        year: CURRENT_YEAR,
        score: pointScore,
        merit: 0,
        penalty: 0,
        cumulative: pointScore,
        isMet,
      },
    });
  }

  return NextResponse.json({ success: true, userId: user.id }, { status: 201 });
}
