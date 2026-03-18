import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

function settingKey(year: number) {
  return `result_visible_${year}`;
}

// GET /api/settings/result-visibility?year=2026
// 인증된 사용자 누구나 조회 가능 (본부장도 접근)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const year = Number(new URL(req.url).searchParams.get("year") ?? new Date().getFullYear());
  const setting = await prisma.appSetting.findUnique({ where: { key: settingKey(year) } });
  const visible = setting?.value === "true";

  return NextResponse.json({ year, visible });
}

// PUT /api/settings/result-visibility
// SYSTEM_ADMIN 전용 — 공개 여부 변경
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  let body: { year?: number; visible: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const year = body.year ?? new Date().getFullYear();
  const visible = !!body.visible;

  await prisma.appSetting.upsert({
    where: { key: settingKey(year) },
    update: { value: String(visible) },
    create: { key: settingKey(year), value: String(visible) },
  });

  return NextResponse.json({ year, visible });
}
