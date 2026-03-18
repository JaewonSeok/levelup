import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

// ── GET /api/review-phase?year=2026 ──────────────────────────────
// 현재 Phase 정보 조회 (인증된 모든 사용자)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());

  const record = await prisma.reviewPhase.findUnique({ where: { year } });

  // 레코드가 없으면 기본값(Phase 1) 반환
  if (!record) {
    return NextResponse.json({
      year,
      currentPhase: 1,
      phase1Start: null,
      phase1End:   null,
      phase2Start: null,
      phase2End:   null,
      updatedAt:   null,
      updatedBy:   null,
    });
  }

  return NextResponse.json({
    year:         record.year,
    currentPhase: record.currentPhase,
    phase1Start:  record.phase1Start?.toISOString() ?? null,
    phase1End:    record.phase1End?.toISOString()   ?? null,
    phase2Start:  record.phase2Start?.toISOString() ?? null,
    phase2End:    record.phase2End?.toISOString()   ?? null,
    updatedAt:    record.updatedAt?.toISOString()   ?? null,
    updatedBy:    record.updatedBy,
  });
}

// ── PUT /api/review-phase ─────────────────────────────────────────
// Phase 전환 (1→2, 2→1). HR_TEAM / SYSTEM_ADMIN 전용.
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  // HR_TEAM + SYSTEM_ADMIN만 허용
  if (
    session.user.role !== Role.HR_TEAM &&
    session.user.role !== Role.SYSTEM_ADMIN
  ) {
    return NextResponse.json(
      { error: "인사팀만 심사 단계를 변경할 수 있습니다." },
      { status: 403 }
    );
  }

  let body: {
    year: number;
    phase: number;
    phase1Start?: string | null;
    phase1End?:   string | null;
    phase2Start?: string | null;
    phase2End?:   string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { year, phase, phase1Start, phase1End, phase2Start, phase2End } = body;

  if (!year || !phase || ![1, 2].includes(phase)) {
    return NextResponse.json(
      { error: "year(숫자)와 phase(1 또는 2)가 필요합니다." },
      { status: 400 }
    );
  }

  const toDate = (v?: string | null) => (v ? new Date(v) : null);

  const record = await prisma.reviewPhase.upsert({
    where: { year },
    create: {
      year,
      currentPhase: phase,
      phase1Start:  toDate(phase1Start),
      phase1End:    toDate(phase1End),
      phase2Start:  toDate(phase2Start),
      phase2End:    toDate(phase2End),
      updatedBy:    session.user.id,
    },
    update: {
      currentPhase: phase,
      // 기간 필드는 요청에 포함된 경우에만 업데이트 (undefined = 변경 없음)
      ...(phase1Start !== undefined ? { phase1Start: toDate(phase1Start) } : {}),
      ...(phase1End   !== undefined ? { phase1End:   toDate(phase1End)   } : {}),
      ...(phase2Start !== undefined ? { phase2Start: toDate(phase2Start) } : {}),
      ...(phase2End   !== undefined ? { phase2End:   toDate(phase2End)   } : {}),
      updatedBy: session.user.id,
    },
  });

  return NextResponse.json({
    success:      true,
    year:         record.year,
    currentPhase: record.currentPhase,
    phase1Start:  record.phase1Start?.toISOString() ?? null,
    phase1End:    record.phase1End?.toISOString()   ?? null,
    phase2Start:  record.phase2Start?.toISOString() ?? null,
    phase2End:    record.phase2End?.toISOString()   ?? null,
    updatedAt:    record.updatedAt?.toISOString()   ?? null,
    updatedBy:    record.updatedBy,
  });
}
