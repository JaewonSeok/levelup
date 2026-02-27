import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// ── GET /api/bonus-penalty?userId=&year= ──────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") ?? "";
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  if (!userId) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }

  const items = await prisma.bonusPenalty.findMany({
    where: { userId, year },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ items });
}

// ── POST /api/bonus-penalty ───────────────────────────────────────
// Body: { userId, year, items: [{type, category, points}], note? }
// 해당 userId+year의 기존 레코드 전체 삭제 후 새로 저장
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  let body: {
    userId: string;
    year: number;
    items: { type: string; category: string; points: number }[];
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { userId, year, items = [], note } = body;

  if (!userId || !year) {
    return NextResponse.json({ error: "userId와 year가 필요합니다." }, { status: 400 });
  }

  // 기존 레코드 삭제 후 새로 저장 (트랜잭션)
  await prisma.$transaction(async (tx) => {
    await tx.bonusPenalty.deleteMany({ where: { userId, year } });

    if (items.length > 0) {
      await tx.bonusPenalty.createMany({
        data: items.map((item) => ({
          userId,
          year,
          type: item.type,
          category: item.category,
          points: item.points,
          note: note ?? null,
        })),
      });
    }
  });

  // 저장 후 최신 목록 반환
  const saved = await prisma.bonusPenalty.findMany({
    where: { userId, year },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ success: true, items: saved });
}
