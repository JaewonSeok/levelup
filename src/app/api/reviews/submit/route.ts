import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendSubmissionEmail } from "@/lib/email";

const SUBMIT_ROLES: Role[] = [Role.DEPT_HEAD, Role.SYSTEM_ADMIN];

// ── GET /api/reviews/submit?year=YYYY ───────────────────────────
// 제출 현황 조회. DEPT_HEAD → 본인 부서 isSubmitted / SYSTEM_ADMIN → 전체 제출 목록
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  const submissions = await prisma.submission.findMany({
    where: { year },
    orderBy: { submittedAt: "desc" },
  });

  const submittedDepts = new Set(submissions.map((s) => s.department));

  const isSubmitted =
    session.user.role === Role.DEPT_HEAD
      ? submittedDepts.has(session.user.department ?? "")
      : false;

  return NextResponse.json({
    isSubmitted,
    submittedDepartments: submissions.map((s) => ({
      department: s.department,
      submittedAt: s.submittedAt.toISOString(),
    })),
  });
}

// ── POST /api/reviews/submit ─────────────────────────────────────
// Body: { year: number }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!SUBMIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "본부장 또는 관리자만 제출할 수 있습니다." }, { status: 403 });
  }

  let body: { year: number; department?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { year } = body;
  if (!year) return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });

  const department =
    session.user.role === Role.SYSTEM_ADMIN && body.department
      ? body.department
      : (session.user.department ?? "");

  if (!department) {
    return NextResponse.json({ error: "부서 정보가 없습니다." }, { status: 400 });
  }

  const submission = await prisma.submission.upsert({
    where: { department_year: { department, year } },
    create: { department, year, submittedBy: session.user.id },
    update: { submittedBy: session.user.id, submittedAt: new Date() },
  });

  // 비동기 이메일 발송 (실패해도 응답 정상 반환)
  sendSubmissionEmail({
    department,
    submittedByName: session.user.name ?? "알 수 없음",
    submittedAt: submission.submittedAt,
    year,
  }).catch((e) => console.error("[submit email]", e));

  return NextResponse.json({
    success: true,
    department,
    year,
    submittedAt: submission.submittedAt.toISOString(),
  });
}

// ── DELETE /api/reviews/submit ───────────────────────────────────
// Body: { year: number }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!SUBMIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  let body: { year: number; department?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { year } = body;
  if (!year) return NextResponse.json({ error: "year가 필요합니다." }, { status: 400 });

  const department =
    session.user.role === Role.SYSTEM_ADMIN && body.department
      ? body.department
      : (session.user.department ?? "");

  try {
    await prisma.submission.delete({
      where: { department_year: { department, year } },
    });
  } catch {
    // 이미 없으면 무시
  }

  return NextResponse.json({ success: true });
}
