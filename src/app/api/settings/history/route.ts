import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const READ_ROLES: Role[] = [Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];

const FIELD_LABELS: Record<string, string> = {
  requiredPoints: "필요 포인트",
  requiredCredits: "필요 학점",
  minTenure: "최소 체류 연수",
};

// ── GET /api/settings/history?year= ─────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!READ_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const year = Number(
    new URL(req.url).searchParams.get("year") ?? new Date().getFullYear()
  );

  const history = await prisma.levelCriteriaHistory.findMany({
    where: { year },
    orderBy: { changedAt: "desc" },
    take: 100,
  });

  const result = history.map((h, idx) => ({
    no: idx + 1,
    id: h.id,
    level: h.level,
    year: h.year,
    field: h.field,
    fieldLabel: FIELD_LABELS[h.field] ?? h.field,
    oldValue: h.oldValue,
    newValue: h.newValue,
    changedByName: h.changedByName,
    changedAt: h.changedAt.toISOString(),
  }));

  return NextResponse.json({ history: result });
}
