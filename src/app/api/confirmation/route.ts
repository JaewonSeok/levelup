import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, ConfirmationStatus, Prisma } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.CEO, Role.HR_TEAM, Role.SYSTEM_ADMIN];

function getCurrentYear() {
  return new Date().getFullYear();
}

// ── GET /api/confirmation ──────────────────────────────────────────
// 쿼리: year, department?, team?, showAll?
// isReviewTarget=true인 Candidate 조회 + Review join + Confirmation 자동 upsert
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? getCurrentYear());
  const department = searchParams.get("department") ?? "";
  const team = searchParams.get("team") ?? "";
  const showAll = searchParams.get("showAll") === "true";

  // 제출된 본부 목록 조회
  const submissions = await prisma.submission.findMany({ where: { year } });
  const submittedDepts = new Set(submissions.map((s) => s.department));
  const submittedDeptMap = new Map(submissions.map((s) => [s.department, s.submittedAt.toISOString()]));

  // 제출된 본부가 없고 showAll=false이면 빈 목록 반환
  if (!showAll && submittedDepts.size === 0 && !department) {
    const metaDepts = await prisma.user.findMany({ distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } });
    const metaTeams = await prisma.user.findMany({ distinct: ["team"], select: { team: true }, orderBy: { team: "asc" } });
    return NextResponse.json({
      employees: [],
      total: 0,
      summary: { pending: 0, confirmed: 0, deferred: 0, submittedDeptCount: 0, confirmedNormal: 0, confirmedSpecial: 0, totalNormal: 0, totalSpecial: 0 },
      submittedDepartments: [],
      meta: { departments: metaDepts.map((d) => d.department).filter(Boolean), teams: metaTeams.map((t) => t.team).filter(Boolean) },
    });
  }

  // 부서 필터 구성
  const userWhere: Prisma.UserWhereInput = {
    role: { not: Role.DEPT_HEAD },
    isActive: true,
  };
  if (department) {
    userWhere.department = { contains: department, mode: "insensitive" };
  } else if (!showAll && submittedDepts.size > 0) {
    // 기본(showAll=false): 제출된 본부만 표시
    userWhere.department = { in: Array.from(submittedDepts) };
  }
  if (team) {
    userWhere.team = { contains: team, mode: "insensitive" };
  }

  // isReviewTarget=true AND review.recommendation=true인 Candidate 조회
  const candidates = await prisma.candidate.findMany({
    where: {
      year,
      isReviewTarget: true,
      review: { recommendation: true },
      user: userWhere,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          department: true,
          team: true,
          level: true,
          competencyLevel: true,
          yearsOfService: true,
          hireDate: true,
        },
      },
      review: {
        select: {
          id: true,
          competencyScore: true,
          competencyEval: true,
          recommendation: true,
        },
      },
      confirmation: true,
      note: true,
    },
    orderBy: [
      { user: { department: "asc" } },
      { user: { team: "asc" } },
      { user: { name: "asc" } },
    ],
  });

  // PgBouncer 안전: 모든 보조 데이터를 배치 쿼리로 한 번에 가져온 뒤 순차 루프로 처리
  const candidateUserIds = candidates.map((c) => c.userId);

  // 배치 조회 (평가등급, 가감점, 포인트, 학점, 기준) — Promise.all 없이 순차로
  const allGrades = await prisma.performanceGrade.findMany({
    where: { userId: { in: candidateUserIds }, year: { in: [2021, 2022, 2023, 2024, 2025] } },
    select: { userId: true, year: true, grade: true },
  });
  const bonusPenaltyRecords = await prisma.bonusPenalty.findMany({
    where: { userId: { in: candidateUserIds } },
    select: { userId: true, type: true, points: true },
  });
  // 포인트: 연도 desc → userId당 첫 번째가 최신
  const allPoints = await prisma.point.findMany({
    where: { userId: { in: candidateUserIds } },
    select: { userId: true, cumulative: true, year: true },
    orderBy: { year: "desc" },
  });
  const allCredits = await prisma.credit.findMany({
    where: { userId: { in: candidateUserIds } },
    select: { userId: true, cumulative: true, year: true },
    orderBy: { year: "desc" },
  });
  const levelSet = Array.from(
    new Set(candidates.map((c) => c.user.level).filter((l): l is NonNullable<typeof l> => l != null))
  );
  const allCriteria = levelSet.length > 0
    ? await prisma.levelCriteria.findMany({ where: { level: { in: levelSet }, year } })
    : [];

  // 메모리 맵 구성
  const gradeMap = new Map<string, Record<number, string>>();
  for (const g of allGrades) {
    if (!gradeMap.has(g.userId)) gradeMap.set(g.userId, {});
    gradeMap.get(g.userId)![g.year] = g.grade;
  }
  const bpMap = new Map<string, { bonusTotal: number; penaltyTotal: number }>();
  for (const bp of bonusPenaltyRecords) {
    if (!bpMap.has(bp.userId)) bpMap.set(bp.userId, { bonusTotal: 0, penaltyTotal: 0 });
    const entry = bpMap.get(bp.userId)!;
    if (bp.points > 0) entry.bonusTotal += bp.points;
    else entry.penaltyTotal += Math.abs(bp.points);
  }
  const latestPointMap = new Map<string, number>();
  for (const p of allPoints) {
    if (!latestPointMap.has(p.userId)) latestPointMap.set(p.userId, p.cumulative);
  }
  const latestCreditMap = new Map<string, number>();
  for (const cr of allCredits) {
    if (!latestCreditMap.has(cr.userId)) latestCreditMap.set(cr.userId, cr.cumulative);
  }
  const criteriaMap = new Map(allCriteria.map((c) => [c.level as string, c]));

  // Confirmation upsert + 행 구성: 순차 루프 (PgBouncer 커넥션 동시 과부하 방지)
  const rows = [];
  for (const c of candidates) {
    let confirmation = c.confirmation;
    if (!confirmation) {
      confirmation = await prisma.confirmation.upsert({
        where: { candidateId: c.id },
        create: { candidateId: c.id, status: ConfirmationStatus.PENDING },
        update: {},
      });
    }

    const { bonusTotal = 0, penaltyTotal = 0 } = bpMap.get(c.userId) ?? {};
    const adjustment = bonusTotal - penaltyTotal;
    const criteria = c.user.level ? (criteriaMap.get(c.user.level as string) ?? null) : null;
    const userGrades = gradeMap.get(c.userId) ?? {};
    const deptSubmitted = submittedDepts.has(c.user.department ?? "");

    rows.push({
      candidateId: c.id,
      confirmationId: confirmation.id,
      userId: c.userId,
      name: c.user.name,
      department: c.user.department,
      team: c.user.team,
      level: c.user.level as string | null,
      competencyLevel: c.user.competencyLevel,
      yearsOfService: c.user.yearsOfService,
      hireDate: c.user.hireDate?.toISOString() ?? null,
      pointCumulative: (latestPointMap.get(c.userId) ?? 0) + adjustment,
      creditCumulative: latestCreditMap.get(c.userId) ?? 0,
      bonusTotal,
      penaltyTotal,
      requiredPoints: criteria?.requiredPoints ?? null,
      requiredCredits: criteria?.requiredCredits ?? null,
      competencyScore: c.review?.competencyScore ?? null,
      competencyEval: c.review?.competencyEval ?? null,
      reviewRecommendation: c.review?.recommendation ?? null,
      promotionType: c.promotionType ?? "normal",
      status: confirmation.status,
      confirmedAt: confirmation.confirmedAt?.toISOString() ?? null,
      isSubmitted: deptSubmitted,
      grades: {
        2021: userGrades[2021] ?? null,
        2022: userGrades[2022] ?? null,
        2023: userGrades[2023] ?? null,
        2024: userGrades[2024] ?? null,
        2025: userGrades[2025] ?? null,
      },
      note: c.note ? { noteText: c.note.noteText ?? null, fileUrl: c.note.fileUrl ?? null, fileName: c.note.fileName ?? null } : null,
    });
  }

  // 요약 통계
  const confirmedRows = rows.filter((r) => r.status === ConfirmationStatus.CONFIRMED);
  const summary = {
    pending: rows.filter((r) => r.status === ConfirmationStatus.PENDING).length,
    confirmed: confirmedRows.length,
    deferred: rows.filter((r) => r.status === ConfirmationStatus.DEFERRED).length,
    submittedDeptCount: submittedDepts.size,
    confirmedNormal: confirmedRows.filter((r) => r.promotionType === "normal").length,
    confirmedSpecial: confirmedRows.filter((r) => r.promotionType === "special").length,
    totalNormal: rows.filter((r) => r.promotionType === "normal").length,
    totalSpecial: rows.filter((r) => r.promotionType === "special").length,
  };

  // 드롭다운용 메타데이터
  const metaDepts = await prisma.user.findMany({
    distinct: ["department"],
    select: { department: true },
    orderBy: { department: "asc" },
  });
  const metaTeams = await prisma.user.findMany({
    distinct: ["team"],
    select: { team: true },
    orderBy: { team: "asc" },
  });

  return NextResponse.json({
    employees: rows,
    total: rows.length,
    summary,
    submittedDepartments: Array.from(submittedDeptMap.entries()).map(([dept, at]) => ({ department: dept, submittedAt: at })),
    meta: {
      departments: metaDepts.map((d) => d.department).filter(Boolean),
      teams: metaTeams.map((t) => t.team).filter(Boolean),
    },
  });
}
