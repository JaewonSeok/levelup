import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, ConfirmationStatus } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.CEO, Role.SYSTEM_ADMIN];

// ── PATCH /api/confirmation/[id] ──────────────────────────────────
// Body: { status: "CONFIRMED" | "DEFERRED" | "PENDING" }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "대표이사 또는 시스템 관리자만 변경할 수 있습니다." }, { status: 403 });
  }

  const { id } = params;

  let body: { status: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const validStatuses = Object.values(ConfirmationStatus);
  if (!validStatuses.includes(body.status as ConfirmationStatus)) {
    return NextResponse.json({ error: "유효하지 않은 상태입니다." }, { status: 400 });
  }

  const existing = await prisma.confirmation.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "확정 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  const updated = await prisma.confirmation.update({
    where: { id },
    data: {
      status: body.status as ConfirmationStatus,
      confirmedBy: session.user.id,
      confirmedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    confirmationId: updated.id,
    status: updated.status,
    confirmedAt: updated.confirmedAt?.toISOString() ?? null,
  });
}
