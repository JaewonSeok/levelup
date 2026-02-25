import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// ── PATCH /api/candidates/[id] ──────────────────────────────────
// Body: { isReviewTarget: boolean }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀만 접근할 수 있습니다." }, { status: 403 });
  }

  const { id } = params;

  let body: { isReviewTarget: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  if (typeof body.isReviewTarget !== "boolean") {
    return NextResponse.json({ error: "isReviewTarget 값이 필요합니다." }, { status: 400 });
  }

  const existing = await prisma.candidate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "대상자 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  const updated = await prisma.candidate.update({
    where: { id },
    data: {
      isReviewTarget: body.isReviewTarget,
      savedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    candidateId: updated.id,
    isReviewTarget: updated.isReviewTarget,
    savedAt: updated.savedAt?.toISOString() ?? null,
  });
}

// ── DELETE /api/candidates/[id] (SYSTEM_ADMIN only) ──────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "시스템 관리자만 삭제할 수 있습니다." }, { status: 403 });
  }

  const { id } = params;

  const existing = await prisma.candidate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "대상자 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.candidate.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
