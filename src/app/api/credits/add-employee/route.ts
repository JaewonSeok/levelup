import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// POST /api/credits/add-employee
// Body: { name, department, team, level?, yearsOfService?, hireDate?, credit2022?, credit2023?, credit2024?, credit2025? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: {
    name: string;
    department: string;
    team: string;
    level?: string | null;
    yearsOfService?: number | null;
    hireDate?: string | null;
    credit2022?: number | null;
    credit2023?: number | null;
    credit2024?: number | null;
    credit2025?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { name, department, team, level, yearsOfService, hireDate, credit2022, credit2023, credit2024, credit2025 } = body;

  if (!name || !department || !team) {
    return NextResponse.json({ error: "이름, 본부, 팀은 필수입니다." }, { status: 400 });
  }

  // 동명이인 체크
  const existing = await prisma.user.findFirst({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: `동일한 이름의 직원이 이미 존재합니다. (${name})` }, { status: 400 });
  }

  const validLevel = level && Object.values(Level).includes(level as Level) ? (level as Level) : null;
  const hireDateParsed = hireDate ? new Date(hireDate) : null;

  // 직원 생성
  const user = await prisma.user.create({
    data: {
      name,
      department,
      team,
      level: validLevel,
      employmentType: EmploymentType.REGULAR,
      hireDate: hireDateParsed,
      yearsOfService: yearsOfService ?? null,
      isActive: true,
    },
  });

  // 학점 저장 (누적 계산)
  const CURRENT_YEAR = new Date().getFullYear();
  const criteria = validLevel
    ? await prisma.levelCriteria.findFirst({ where: { level: validLevel, year: CURRENT_YEAR } })
    : null;

  const creditScores: { year: number; score: number }[] = [];
  if (credit2022 != null) creditScores.push({ year: 2022, score: credit2022 });
  if (credit2023 != null) creditScores.push({ year: 2023, score: credit2023 });
  if (credit2024 != null) creditScores.push({ year: 2024, score: credit2024 });
  if (credit2025 != null) creditScores.push({ year: 2025, score: credit2025 });
  creditScores.sort((a, b) => a.year - b.year);

  if (creditScores.length > 0) {
    let running = 0;
    for (const { year, score } of creditScores) {
      running += score;
      const isMet = criteria && criteria.requiredCredits != null && criteria.requiredCredits > 0 ? running >= criteria.requiredCredits : false;
      await prisma.credit.create({
        data: { userId: user.id, year, score, cumulative: running, isMet },
      });
    }
  }

  return NextResponse.json({ success: true, userId: user.id }, { status: 201 });
}
