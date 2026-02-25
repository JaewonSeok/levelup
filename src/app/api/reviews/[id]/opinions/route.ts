import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const REVIEW_ROLES: Role[] = [Role.DEPT_HEAD, Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];
const SAVE_ROLES: Role[] = [Role.DEPT_HEAD, Role.HR_TEAM, Role.SYSTEM_ADMIN];

// ── GET /api/reviews/[id]/opinions ──────────────────────────────
// 의견 팝업용: 대상자 요약 + 전체 검토자 목록 + 의견 현황
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!REVIEW_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const review = await prisma.review.findUnique({
    where: { id: params.id },
    include: {
      opinions: true,
      candidate: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              department: true,
              team: true,
              level: true,
              competencyLevel: true,
            },
          },
        },
      },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "심사 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  const candidateDept = review.candidate.user.department;
  const candidateLevel = review.candidate.user.level;
  const year = review.candidate.year;
  const userId = review.candidate.userId;

  // Level criteria + cumulative values
  const [criteria, latestPoint, latestCredit] = await Promise.all([
    candidateLevel
      ? prisma.levelCriteria.findFirst({ where: { level: candidateLevel, year } })
      : null,
    prisma.point.findFirst({ where: { userId }, orderBy: { year: "desc" } }),
    prisma.credit.findFirst({ where: { userId }, orderBy: { year: "desc" } }),
  ]);

  // All dept heads + HR team users (potential reviewers)
  const [deptHeads, hrTeam] = await Promise.all([
    prisma.user.findMany({
      where: { role: Role.DEPT_HEAD, isActive: true },
      select: { id: true, name: true, department: true },
      orderBy: { department: "asc" },
    }),
    prisma.user.findMany({
      where: { role: Role.HR_TEAM, isActive: true },
      select: { id: true, name: true, department: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const opinionMap = new Map(review.opinions.map((o) => [o.reviewerId, o]));

  const makeReviewer = (
    user: { id: string; name: string; department: string },
    reviewerRole: string,
    reviewerName: string
  ) => {
    const op = opinionMap.get(user.id);
    return {
      userId: user.id,
      reviewerName,
      reviewerRole,
      isCurrentUser: user.id === session.user.id,
      opinionId: op?.id ?? null,
      opinionText: op?.opinionText ?? null,
      recommendation: op?.recommendation ?? null,
      savedAt: op?.savedAt?.toISOString() ?? null,
      modifiedBy: op?.modifiedBy ?? null,
      modifiedAt: op?.modifiedAt?.toISOString() ?? null,
    };
  };

  const ownDeptHead = deptHeads.find((u) => u.department === candidateDept);
  const otherDeptHeads = deptHeads.filter((u) => u.department !== candidateDept);

  const reviewers = [
    ...(ownDeptHead
      ? [makeReviewer(ownDeptHead, "소속본부장", `${candidateDept}장`)]
      : []),
    ...otherDeptHeads.map((u) => makeReviewer(u, "타본부장", `${u.department}장`)),
    // SYSTEM_ADMIN이 로그인하면 admin 본인만 인사팀장으로 추가 (중복 방지)
    ...(session.user.role !== Role.SYSTEM_ADMIN
      ? hrTeam.map((u) => makeReviewer(u, "인사팀장", "인사팀장"))
      : []),
  ];

  // SYSTEM_ADMIN은 인사팀장 역할로 reviewer 목록에 추가 (본인의 의견 편집 가능)
  if (session.user.role === Role.SYSTEM_ADMIN) {
    const adminOp = opinionMap.get(session.user.id);
    reviewers.push({
      userId: session.user.id,
      reviewerName: "인사팀장",
      reviewerRole: "인사팀장",
      isCurrentUser: true,
      opinionId: adminOp?.id ?? null,
      opinionText: adminOp?.opinionText ?? null,
      recommendation: adminOp?.recommendation ?? null,
      savedAt: adminOp?.savedAt?.toISOString() ?? null,
      modifiedBy: adminOp?.modifiedBy ?? null,
      modifiedAt: adminOp?.modifiedAt?.toISOString() ?? null,
    });
  }

  return NextResponse.json({
    review: {
      id: review.id,
      competencyScore: review.competencyScore,
      competencyEval: review.competencyEval,
    },
    candidate: {
      id: review.candidate.id,
      year,
      user: {
        name: review.candidate.user.name,
        department: candidateDept,
        team: review.candidate.user.team,
        level: candidateLevel as string | null,
        competencyLevel: review.candidate.user.competencyLevel,
      },
    },
    pointCumulative: latestPoint?.cumulative ?? 0,
    creditCumulative: latestCredit?.cumulative ?? 0,
    requiredPoints: criteria?.requiredPoints ?? null,
    requiredCredits: criteria?.requiredCredits ?? null,
    reviewers,
    currentUser: {
      id: session.user.id,
      role: session.user.role,
      department: session.user.department ?? "",
    },
  });
}

// ── POST /api/reviews/[id]/opinions ─────────────────────────────
// 현재 로그인 사용자의 의견 저장 (upsert)
// Body: { opinionText?: string; recommendation?: boolean | null }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!SAVE_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const review = await prisma.review.findUnique({
    where: { id: params.id },
    include: {
      candidate: {
        include: {
          user: { select: { department: true } },
        },
      },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "심사 레코드를 찾을 수 없습니다." }, { status: 404 });
  }

  let body: {
    opinionText?: string;
    recommendation?: boolean | null;
    reviewerId?: string; // SYSTEM_ADMIN만 사용 가능 — 지정된 reviewer 대신 저장
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const candidateDept = review.candidate.user.department;

  // SYSTEM_ADMIN이 reviewerId를 지정하면 해당 사용자로 저장
  let targetReviewerId = session.user.id;
  let targetDept = session.user.department ?? "";
  let targetRole: Role = session.user.role;

  if (body.reviewerId && session.user.role === Role.SYSTEM_ADMIN) {
    const targetUser = await prisma.user.findUnique({
      where: { id: body.reviewerId },
      select: { id: true, department: true, role: true },
    });
    if (targetUser) {
      targetReviewerId = targetUser.id;
      targetDept = targetUser.department ?? "";
      targetRole = targetUser.role;
    }
  } else {
    // JWT는 로그인 시점에 고정되어 있으므로 항상 DB에서 최신 department 조회
    const currentUserDb = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { department: true },
    });
    if (currentUserDb) {
      targetDept = currentUserDb.department ?? "";
    }
  }

  // Determine reviewer role and name
  let reviewerRole: string;
  let reviewerName: string;

  if (targetRole === Role.HR_TEAM || (session.user.role === Role.SYSTEM_ADMIN && targetRole !== Role.DEPT_HEAD)) {
    reviewerRole = "인사팀장";
    reviewerName = "인사팀장";
  } else if (targetDept === candidateDept) {
    reviewerRole = "소속본부장";
    reviewerName = `${candidateDept}장`;
  } else {
    reviewerRole = "타본부장";
    reviewerName = `${targetDept}장`;
  }

  // 인사팀장은 추천여부 없음
  const recommendation = reviewerRole === "인사팀장" ? null : (body.recommendation ?? null);

  const isAdminSave = session.user.role === Role.SYSTEM_ADMIN;
  const now = new Date();

  // Opinion 저장 + Review.recommendation 업데이트 — 트랜잭션
  // 규칙: 소속본부장 → 항상 업데이트 (최우선)
  //       타본부장  → 소속본부장이 아직 추천/미추천 미저장인 경우에만 업데이트
  //       인사팀장  → 업데이트 없음
  let reviewUpdated = false;

  const opinion = await prisma.$transaction(async (tx) => {
    // 소속본부장이 이미 추천/미추천을 저장했는지 확인 (타본부장 저장 시 우선순위 판별용)
    const ownerOpinion =
      reviewerRole === "타본부장"
        ? await tx.opinion.findFirst({
            where: {
              reviewId: params.id,
              reviewerRole: "소속본부장",
              recommendation: { not: null },
            },
          })
        : null;

    const saved = await tx.opinion.upsert({
      where: {
        reviewId_reviewerId: { reviewId: params.id, reviewerId: targetReviewerId },
      },
      create: {
        reviewId: params.id,
        reviewerId: targetReviewerId,
        reviewerName,
        reviewerRole,
        opinionText: body.opinionText ?? null,
        recommendation,
        savedAt: now,
        modifiedBy: isAdminSave ? session.user.id : null,
        modifiedAt: isAdminSave ? now : null,
      },
      update: {
        opinionText: body.opinionText ?? null,
        recommendation,
        savedAt: now,
        ...(isAdminSave ? { modifiedBy: session.user.id, modifiedAt: now } : {}),
      },
    });

    // Review.recommendation 업데이트 여부 결정
    const shouldUpdateReview =
      reviewerRole === "소속본부장" ||
      (reviewerRole === "타본부장" && !ownerOpinion);

    if (shouldUpdateReview) {
      await tx.review.update({
        where: { id: params.id },
        data: { recommendation },
      });
      reviewUpdated = true;
    }

    return saved;
  });

  return NextResponse.json({
    success: true,
    opinionId: opinion.id,
    reviewerRole,
    reviewerName,
    recommendation: opinion.recommendation,
    savedAt: opinion.savedAt?.toISOString() ?? null,
    reviewUpdated,
  });
}
