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

  // Level criteria + cumulative values (순차 조회)
  const criteria = candidateLevel
    ? await prisma.levelCriteria.findFirst({ where: { level: candidateLevel, year } })
    : null;
  const latestPoint = await prisma.point.findFirst({ where: { userId }, orderBy: { year: "desc" } });
  const latestCredit = await prisma.credit.findFirst({ where: { userId }, orderBy: { year: "desc" } });

  // All dept heads + HR team users (순차 조회)
  // isActive 필터 없이 조회 — 비활성 본부장이 저장한 의견도 표시되어야 하므로
  const deptHeads = await prisma.user.findMany({
    where: { role: Role.DEPT_HEAD },
    select: { id: true, name: true, department: true },
    orderBy: { department: "asc" },
  });
  const hrTeam = await prisma.user.findMany({
    where: { role: Role.HR_TEAM, isActive: true },
    select: { id: true, name: true, department: true },
    orderBy: { name: "asc" },
  });

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
      noOpinion: op?.noOpinion ?? false,
      recommendationReason: op?.recommendationReason ?? null,
      savedAt: op?.savedAt?.toISOString() ?? null,
      modifiedBy: op?.modifiedBy ?? null,
      modifiedAt: op?.modifiedAt?.toISOString() ?? null,
    };
  };

  // 부서당 의견 있는 본부장을 우선 선택, 없으면 첫 번째 — 부서당 1행만 표시
  const pickHead = (heads: { id: string; name: string; department: string }[]) =>
    heads.find((u) => opinionMap.has(u.id)) ?? heads[0];

  const ownDeptHeads = deptHeads.filter((u) => u.department === candidateDept);
  const ownDeptHead = pickHead(ownDeptHeads);

  // 타본부장: 부서별로 그룹화 후 의견 있는 사람 우선 선택 (부서당 1명)
  const otherDeptGroupMap = new Map<string, { id: string; name: string; department: string }[]>();
  for (const u of deptHeads.filter((u) => u.department !== candidateDept)) {
    const dept = u.department ?? "";
    if (!otherDeptGroupMap.has(dept)) otherDeptGroupMap.set(dept, []);
    otherDeptGroupMap.get(dept)!.push(u);
  }
  const otherDeptHeads = Array.from(otherDeptGroupMap.values()).map(pickHead).filter((u): u is NonNullable<typeof u> => !!u);

  const reviewers = [
    ...(ownDeptHead ? [makeReviewer(ownDeptHead, "소속본부장", `${candidateDept}장`)] : []),
    ...otherDeptHeads.map((u) => makeReviewer(u, "타본부장", `${u.department}장`)),
    // SYSTEM_ADMIN이 로그인하면 admin 본인만 인사팀장으로 추가 (중복 방지)
    ...(session.user.role !== Role.SYSTEM_ADMIN
      ? hrTeam.map((u) => makeReviewer(u, "인사팀장", "인사팀장"))
      : []),
  ];

  // ── 안전망: opinion이 저장되었지만 reviewer 목록에 없는 경우 보완 ──
  // deptHeads 조회에서 누락된 reviewer(예: 비활성 본부장)의 의견도 반드시 표시
  for (const [reviewerId, op] of Array.from(opinionMap.entries())) {
    if (reviewers.some((r) => r.userId === reviewerId)) continue;
    reviewers.push({
      userId: reviewerId,
      reviewerName: op.reviewerName,
      reviewerRole: op.reviewerRole,
      isCurrentUser: reviewerId === session.user.id,
      opinionId: op.id,
      opinionText: op.opinionText ?? null,
      recommendation: op.recommendation ?? null,
      noOpinion: op.noOpinion ?? false,
      recommendationReason: op.recommendationReason ?? null,
      savedAt: op.savedAt?.toISOString() ?? null,
      modifiedBy: op.modifiedBy ?? null,
      modifiedAt: op.modifiedAt?.toISOString() ?? null,
    });
  }

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
      noOpinion: adminOp?.noOpinion ?? false,
      recommendationReason: adminOp?.recommendationReason ?? null,
      savedAt: adminOp?.savedAt?.toISOString() ?? null,
      modifiedBy: adminOp?.modifiedBy ?? null,
      modifiedAt: adminOp?.modifiedAt?.toISOString() ?? null,
    });
  }

  // ── 안전망: 로그인한 DEPT_HEAD가 reviewers에 없으면 직접 삽입 ──
  // deptHeads 조회에서 누락되었거나 세션/DB 불일치 상황 대비
  if (
    session.user.role === Role.DEPT_HEAD &&
    !reviewers.some((r) => r.userId === session.user.id)
  ) {
    const dept = session.user.department ?? "";
    const existingOp = opinionMap.get(session.user.id);
    reviewers.unshift({
      userId: session.user.id,
      reviewerName: dept ? `${dept}장` : "본부장",
      reviewerRole: dept && dept === candidateDept ? "소속본부장" : "타본부장",
      isCurrentUser: true,
      opinionId: existingOp?.id ?? null,
      opinionText: existingOp?.opinionText ?? null,
      recommendation: existingOp?.recommendation ?? null,
      noOpinion: existingOp?.noOpinion ?? false,
      recommendationReason: existingOp?.recommendationReason ?? null,
      savedAt: existingOp?.savedAt?.toISOString() ?? null,
      modifiedBy: existingOp?.modifiedBy ?? null,
      modifiedAt: existingOp?.modifiedAt?.toISOString() ?? null,
    });
  }

  // 수정 3: DEPT_HEAD는 자기 의견 행만 반환 (타 본부장 의견 비공개)
  const filteredReviewers = session.user.role === Role.DEPT_HEAD
    ? reviewers.filter((r) => r.isCurrentUser)
    : reviewers;

  return NextResponse.json({
    review: {
      id: review.id,
      competencyScore: review.competencyScore,
      competencyEval: review.competencyEval,
      editUnlocked: review.editUnlocked,
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
    reviewers: filteredReviewers,
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
    noOpinion?: boolean;
    recommendationReason?: string | null;
    reviewerId?: string; // SYSTEM_ADMIN만 사용 가능 — 지정된 reviewer 대신 저장
    phase?: number;      // 저장 당시 심사 단계 (1 또는 2)
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

  // ── Phase 검증 (DEPT_HEAD 전용) ──────────────────────────────────
  // HR_TEAM / SYSTEM_ADMIN은 Phase 제한 없음
  if (session.user.role === Role.DEPT_HEAD) {
    const candidateYear = review.candidate.year;
    const reviewPhaseRecord = await prisma.reviewPhase
      .findUnique({ where: { year: candidateYear } })
      .catch(() => null);
    const currentPhase = reviewPhaseRecord?.currentPhase ?? 1;

    // body.phase가 명시된 경우 현재 Phase와 일치하는지 확인
    if (body.phase !== undefined && body.phase !== currentPhase) {
      return NextResponse.json(
        { error: `현재 ${currentPhase}차 심사 단계입니다. 요청한 phase(${body.phase})와 다릅니다.` },
        { status: 400 }
      );
    }

    // Phase 1: 소속 본부 대상자에 대해서만 저장 가능
    if (currentPhase === 1 && targetDept !== candidateDept) {
      return NextResponse.json(
        { error: "1차 심사에서는 소속 본부 직원에 대해서만 의견을 저장할 수 있습니다." },
        { status: 403 }
      );
    }
    // Phase 2: 타 본부 대상자에 대해서만 저장 가능
    if (currentPhase === 2 && targetDept === candidateDept) {
      return NextResponse.json(
        { error: "2차 심사에서는 타 본부 직원에 대해서만 의견을 저장할 수 있습니다. (소속 본부는 1차 완료)" },
        { status: 403 }
      );
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

  // 인사팀장은 추천여부 없음. 타본부장이 "의견없음" 선택 시 recommendation=null + noOpinion=true
  const noOpinion = reviewerRole !== "인사팀장" && body.noOpinion === true;
  const recommendation = (reviewerRole === "인사팀장" || noOpinion) ? null : (body.recommendation ?? null);
  const recommendationReason = (noOpinion || recommendation === null) ? null : (body.recommendationReason ?? null);

  const isAdminSave = session.user.role === Role.SYSTEM_ADMIN;
  const now = new Date();

  // 저장할 Phase 결정 — body.phase 미지정 시 DB에서 현재 phase 사용
  // (이미 DEPT_HEAD 검증에서 일치 여부 확인됨; HR_TEAM/SYSTEM_ADMIN은 임의 지정 가능)
  let savePhase = body.phase ?? 1;
  if (body.phase === undefined) {
    const yr = review.candidate.year;
    const phRecord = await prisma.reviewPhase.findUnique({ where: { year: yr } }).catch(() => null);
    savePhase = phRecord?.currentPhase ?? 1;
  }

  // Opinion 저장 + Review.recommendation 업데이트 — 트랜잭션
  // 규칙: 소속본부장 → Review.recommendation 업데이트
  //       타본부장  → Opinion만 저장 (Review.recommendation 변경 없음)
  //       인사팀장  → Opinion만 저장 (Review.recommendation 변경 없음)
  let reviewUpdated = false;

  const opinion = await prisma.$transaction(async (tx) => {
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
        noOpinion,
        recommendationReason,
        phase: savePhase,
        savedAt: now,
        modifiedBy: isAdminSave ? session.user.id : null,
        modifiedAt: isAdminSave ? now : null,
      },
      update: {
        opinionText: body.opinionText ?? null,
        recommendation,
        noOpinion,
        recommendationReason,
        savedAt: now,
        ...(isAdminSave ? { modifiedBy: session.user.id, modifiedAt: now } : {}),
      },
    });

    // Review.recommendation 업데이트 여부 결정
    // 소속본부장만 Review.recommendation 반영 — 타본부장은 참고 의견에 불과
    const shouldUpdateReview = reviewerRole === "소속본부장";

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
    noOpinion: opinion.noOpinion,
    recommendationReason: opinion.recommendationReason,
    savedAt: opinion.savedAt?.toISOString() ?? null,
    reviewUpdated,
  });
}
