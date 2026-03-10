import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const RESET_ROLES: Role[] = [Role.DEPT_HEAD, Role.SYSTEM_ADMIN];

// ── PUT /api/reviews/[id]/reset ──────────────────────────────────
// 개별 대상자 심사 편집 잠금 해제 (본부 제출 상태 유지, 해당 대상자만 수정 가능하게)
// Body: 없음
export async function PUT(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!RESET_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = params;

  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      candidate: {
        include: { user: { select: { department: true } } },
      },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "심사 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  // DEPT_HEAD는 본인 부서 대상자만 초기화 가능
  if (session.user.role === Role.DEPT_HEAD) {
    const candidateDept = review.candidate.user.department;
    if (candidateDept !== session.user.department) {
      return NextResponse.json({ error: "본인 부서의 심사만 초기화할 수 있습니다." }, { status: 403 });
    }
  }

  await prisma.review.update({
    where: { id },
    data: { editUnlocked: true },
  });

  return NextResponse.json({ success: true, editUnlocked: true });
}
