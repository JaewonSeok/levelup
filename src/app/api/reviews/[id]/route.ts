import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

// recommendation 수정: DEPT_HEAD + SYSTEM_ADMIN
const REC_ROLES: Role[] = [Role.DEPT_HEAD, Role.SYSTEM_ADMIN];
// 역량점수/레벨평가 수정: HR_TEAM + SYSTEM_ADMIN (기존 데이터 보호용으로 유지)
const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.DEPT_HEAD, Role.SYSTEM_ADMIN];

// ── PATCH /api/reviews/[id] ──────────────────────────────────────
// Body: { recommendation?: boolean | null }
// DEPT_HEAD / SYSTEM_ADMIN: 추천여부 수정 가능
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { id } = params;

  let body: {
    competencyScore?: number | null;
    competencyEval?: number | null;
    recommendation?: boolean | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) {
    return NextResponse.json({ error: "심사 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  const updateData: {
    competencyScore?: number | null;
    competencyEval?: number | null;
    recommendation?: boolean | null;
  } = {};

  const hrAdminRoles: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];
  // 역량점수/레벨평가: HR_TEAM + SYSTEM_ADMIN (기존 데이터 보호)
  if ("competencyScore" in body && hrAdminRoles.includes(session.user.role)) {
    updateData.competencyScore = body.competencyScore;
  }
  if ("competencyEval" in body && hrAdminRoles.includes(session.user.role)) {
    updateData.competencyEval = body.competencyEval;
  }
  // 추천여부: DEPT_HEAD + SYSTEM_ADMIN
  if ("recommendation" in body && REC_ROLES.includes(session.user.role)) {
    updateData.recommendation = body.recommendation;
  }

  const updated = await prisma.review.update({
    where: { id },
    data: updateData,
  });

  // 추천여부가 변경된 경우 소속본부장 Opinion.recommendation도 동기화
  if ("recommendation" in updateData) {
    try {
      const reviewWithCandidate = await prisma.review.findUnique({
        where: { id },
        include: {
          candidate: {
            include: { user: { select: { department: true } } },
          },
        },
      });
      if (reviewWithCandidate) {
        const candidateDept = reviewWithCandidate.candidate.user.department;
        const ownDeptHead = await prisma.user.findFirst({
          where: { role: Role.DEPT_HEAD, department: candidateDept, isActive: true },
          select: { id: true },
        });
        if (ownDeptHead) {
          await prisma.opinion.updateMany({
            where: { reviewId: id, reviewerId: ownDeptHead.id },
            data: { recommendation: updateData.recommendation ?? null },
          });
        }
      }
    } catch (e) {
      // sync 실패 시에도 메인 응답은 정상 반환
      console.error("[sync opinion] 소속본부장 Opinion 동기화 실패:", e);
    }
  }

  return NextResponse.json({
    success: true,
    reviewId: updated.id,
    recommendation: updated.recommendation,
  });
}
