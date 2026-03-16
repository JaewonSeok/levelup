import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendSubmissionEmail, sendPhase2CompletionEmail } from "@/lib/email";

const SUBMIT_ROLES: Role[] = [Role.DEPT_HEAD, Role.SYSTEM_ADMIN];
const VIEW_ROLES: Role[] = [Role.DEPT_HEAD, Role.HR_TEAM, Role.CEO, Role.SYSTEM_ADMIN];

// ── GET /api/reviews/submit?year=YYYY ───────────────────────────
// 제출 현황 조회. phase별로 분리 반환.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!VIEW_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  const [submissions, deptHeads] = await Promise.all([
    prisma.submission.findMany({ where: { year }, orderBy: { submittedAt: "desc" } }),
    prisma.user.findMany({ where: { role: Role.DEPT_HEAD, isActive: true }, select: { department: true } }),
  ]);

  const allDepartments = Array.from(new Set(deptHeads.map((u) => u.department).filter(Boolean))).sort();

  const phase1Subs = submissions.filter((s) => s.phase === 1);
  const phase2Subs = submissions.filter((s) => s.phase === 2);

  // DEPT_HEAD: 본인 부서 제출 여부 확인 (DB에서 최신 department 조회)
  let isSubmitted = false;
  let isPhase2Submitted = false;
  if (session.user.role === Role.DEPT_HEAD) {
    const userDb = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { department: true },
    });
    const dept = userDb?.department ?? "";
    isSubmitted = phase1Subs.some((s) => s.department === dept);
    isPhase2Submitted = phase2Subs.some((s) => s.department === dept);
  }

  return NextResponse.json({
    isSubmitted,
    isPhase2Submitted,
    allDepartments,
    submittedDepartments: phase1Subs.map((s) => ({
      department: s.department,
      submittedAt: s.submittedAt.toISOString(),
    })),
    phase2SubmittedDepts: phase2Subs.map((s) => ({
      department: s.department,
      submittedAt: s.submittedAt.toISOString(),
    })),
  });
}

// ── POST /api/reviews/submit ─────────────────────────────────────
// Body: { year: number; phase?: number }
// phase 미지정 시 현재 ReviewPhase 기준으로 결정
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!SUBMIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "본부장 또는 관리자만 제출할 수 있습니다." }, { status: 403 });
  }

  let body: { year: number; department?: string; phase?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { year } = body;
  if (!year) return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });

  // [Bug 1 Fix] 세션 JWT가 아닌 DB에서 최신 department 조회
  let department: string;
  if (session.user.role === Role.SYSTEM_ADMIN && body.department) {
    department = body.department;
  } else {
    const userDb = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { department: true },
    });
    department = userDb?.department ?? (session.user.department ?? "");
  }

  if (!department) {
    return NextResponse.json({ error: "부서 정보가 없습니다." }, { status: 400 });
  }

  // phase 결정: body에 명시되면 사용, 아니면 현재 ReviewPhase에서 결정
  let phase = body.phase;
  if (phase === undefined) {
    const reviewPhaseRecord = await prisma.reviewPhase
      .findUnique({ where: { year } })
      .catch(() => null);
    phase = reviewPhaseRecord?.currentPhase ?? 1;
  }

  const submission = await prisma.submission.upsert({
    where: { department_year_phase: { department, year, phase } },
    create: { department, year, phase, submittedBy: session.user.id },
    update: { submittedBy: session.user.id, submittedAt: new Date() },
  });

  if (phase === 1) {
    // 재제출 시 해당 부서 모든 대상자의 editUnlocked 초기화
    await prisma.review.updateMany({
      where: {
        candidate: { year, user: { department } },
        editUnlocked: true,
      },
      data: { editUnlocked: false },
    });

    // Phase 1 이메일 (기존)
    prisma.candidate.findMany({
      where: { year, isReviewTarget: true, user: { department } },
      include: { review: { select: { recommendation: true } } },
    }).then((candidates) => {
      const stats = {
        total: candidates.length,
        recommended: candidates.filter((c) => c.review?.recommendation === true).length,
        notRecommended: candidates.filter((c) => c.review?.recommendation === false).length,
      };
      return sendSubmissionEmail({
        department,
        submittedByName: session.user.name ?? "알 수 없음",
        submittedAt: submission.submittedAt,
        year,
        stats,
      });
    }).catch((e) => console.error("[submit email phase1]", e));
  } else {
    // Phase 2: 전체 본부장 제출 완료 여부 확인 → 이메일 트리거
    const allDeptHeads = await prisma.user.findMany({
      where: { role: Role.DEPT_HEAD, isActive: true },
      select: { department: true },
    });
    // 부서별 중복 제거
    const uniqueDepts = Array.from(new Set(allDeptHeads.map((u) => u.department).filter(Boolean)));

    const phase2Subs = await prisma.submission.findMany({
      where: { year, phase: 2 },
      select: { department: true },
    });
    const submittedDepts = new Set(phase2Subs.map((s) => s.department));
    const allSubmitted = uniqueDepts.every((d) => submittedDepts.has(d));

    if (allSubmitted && uniqueDepts.length > 0) {
      // 모든 본부장 2차 제출 완료 → 이메일 발송
      const allPhase2Subs = await prisma.submission.findMany({
        where: { year, phase: 2 },
        orderBy: { department: "asc" },
      });
      sendPhase2CompletionEmail({ year, submissions: allPhase2Subs }).catch((e) =>
        console.error("[submit email phase2]", e)
      );
    }
  }

  return NextResponse.json({
    success: true,
    department,
    year,
    phase,
    submittedAt: submission.submittedAt.toISOString(),
  });
}

// ── DELETE /api/reviews/submit ───────────────────────────────────
// Body: { year: number; department?: string; phase?: number }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!SUBMIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  let body: { year: number; department?: string; phase?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { year } = body;
  if (!year) return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });

  // [Bug 1 Fix] DB에서 최신 department 조회
  let department: string;
  if (session.user.role === Role.SYSTEM_ADMIN && body.department) {
    department = body.department;
  } else {
    const userDb = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { department: true },
    });
    department = userDb?.department ?? (session.user.department ?? "");
  }

  const phase = body.phase ?? 1;

  try {
    await prisma.submission.delete({
      where: { department_year_phase: { department, year, phase } },
    });
  } catch {
    // 이미 없으면 무시
  }

  return NextResponse.json({ success: true });
}
