import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level } from "@prisma/client";
import { autoSelectCandidates } from "@/lib/candidates/auto-select";
import { recalculatePointsFromGrades } from "@/lib/points/recalculate";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];
const READ_ROLES: Role[] = [
  Role.DEPT_HEAD,
  Role.HR_TEAM,
  Role.CEO,
  Role.SYSTEM_ADMIN,
];

const ALL_LEVELS: Level[] = [Level.L0, Level.L1, Level.L2, Level.L3, Level.L4, Level.L5];

function getCurrentYear() {
  return new Date().getFullYear();
}

// ── GET /api/settings?year= ──────────────────────────────────────
// 연도별 레벨 기준값 조회 (레벨 미설정 시 null 반환)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!READ_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const year = Number(
    new URL(req.url).searchParams.get("year") ?? getCurrentYear()
  );

  const criteria = await prisma.levelCriteria.findMany({
    where: { year },
    orderBy: { level: "asc" },
  });

  const criteriaMap = new Map(criteria.map((c) => [c.level, c]));

  // Return entry for every level (null if not set for this year)
  const result = ALL_LEVELS.map((level) => {
    const c = criteriaMap.get(level);
    return {
      level,
      year,
      id: c?.id ?? null,
      requiredPoints: c?.requiredPoints ?? null,
      specialRequiredPoints: c?.specialRequiredPoints ?? null,
      requiredCredits: c?.requiredCredits ?? null,
      minTenure: c?.minTenure ?? null,
      updatedAt: c?.updatedAt?.toISOString() ?? null,
    };
  });

  // Available years (years that have at least one criteria set)
  const yearsWithData = await prisma.levelCriteria.findMany({
    distinct: ["year"],
    select: { year: true },
    orderBy: { year: "desc" },
  });

  return NextResponse.json({
    criteria: result,
    year,
    availableYears: yearsWithData.map((y) => y.year),
  });
}

// ── POST /api/settings ───────────────────────────────────────────
// Body: { year: number; criteria: { level, requiredPoints, requiredCredits, minTenure }[] }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 수정할 수 있습니다." }, { status: 403 });
  }

  let body: {
    year: number;
    criteria: {
      level: Level;
      requiredPoints: number;
      specialRequiredPoints?: number | null;
      requiredCredits: number;
      minTenure: number;
    }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  if (!body.year || !Array.isArray(body.criteria) || body.criteria.length === 0) {
    return NextResponse.json({ error: "필수 값이 없습니다." }, { status: 400 });
  }

  const { year, criteria } = body;
  const changedById = session.user.id;
  const changedByName = session.user.name ?? "Unknown";

  // Fetch existing criteria for comparison
  const existing = await prisma.levelCriteria.findMany({ where: { year } });
  const existingMap = new Map(existing.map((c) => [c.level, c]));

  await prisma.$transaction(async (tx) => {
    for (const item of criteria) {
      const prev = existingMap.get(item.level);

      // Upsert criteria
      await tx.levelCriteria.upsert({
        where: { level_year: { level: item.level, year } },
        create: {
          level: item.level,
          year,
          requiredPoints: item.requiredPoints,
          specialRequiredPoints: item.specialRequiredPoints ?? null,
          requiredCredits: item.requiredCredits,
          minTenure: item.minTenure,
        },
        update: {
          requiredPoints: item.requiredPoints,
          specialRequiredPoints: item.specialRequiredPoints ?? null,
          requiredCredits: item.requiredCredits,
          minTenure: item.minTenure,
        },
      });

      // Record history for changed fields
      const fields: Array<{
        field: string;
        oldValue: string | null;
        newValue: string;
      }> = [];

      if (prev == null) {
        // New entry — record all as initial set
        fields.push(
          { field: "requiredPoints", oldValue: null, newValue: String(item.requiredPoints) },
          { field: "requiredCredits", oldValue: null, newValue: String(item.requiredCredits) },
          { field: "minTenure", oldValue: null, newValue: String(item.minTenure) }
        );
      } else {
        if (prev.requiredPoints !== item.requiredPoints)
          fields.push({ field: "requiredPoints", oldValue: String(prev.requiredPoints), newValue: String(item.requiredPoints) });
        if (prev.requiredCredits !== item.requiredCredits)
          fields.push({ field: "requiredCredits", oldValue: String(prev.requiredCredits), newValue: String(item.requiredCredits) });
        if (prev.minTenure !== item.minTenure)
          fields.push({ field: "minTenure", oldValue: String(prev.minTenure), newValue: String(item.minTenure) });
      }

      if (fields.length > 0) {
        await tx.levelCriteriaHistory.createMany({
          data: fields.map((f) => ({
            level: item.level,
            year,
            changedById,
            changedByName,
            field: f.field,
            oldValue: f.oldValue,
            newValue: f.newValue,
          })),
        });
      }
    }
  });

  // 기준 저장 후 포인트 재계산 → 자동 선정 실행 (에러 발생해도 저장은 성공)
  recalculatePointsFromGrades()
    .then(() => autoSelectCandidates(year))
    .catch((e) => console.error("[settings] recalculate error:", e));

  return NextResponse.json({ success: true });
}
