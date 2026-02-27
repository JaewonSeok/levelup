import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [Role.CEO, Role.HR_TEAM, Role.SYSTEM_ADMIN];

// GET /api/dashboard?year=2026
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const currentYear = new Date().getFullYear();
  const year = Number(searchParams.get("year") ?? currentYear);

  // ── 조회 가능한 연도 목록 ─────────────────────────────────
  const yearRows = await prisma.candidate.findMany({
    distinct: ["year"],
    select: { year: true },
    orderBy: { year: "desc" },
  });
  const availableYears = yearRows.map((r) => r.year);
  if (!availableYears.includes(year)) availableYears.unshift(year);

  // ── 심사대상 Candidate 전체 조회 ─────────────────────────
  const candidates = await prisma.candidate.findMany({
    where: { year, isReviewTarget: true },
    include: {
      user: { select: { level: true, department: true } },
      confirmation: { select: { status: true } },
    },
  });

  // ── 전체 Candidate 중 포인트/학점 충족 현황 ──────────────
  // (isReviewTarget 여부와 무관하게 해당 연도 전체 대상)
  const allCandidates = await prisma.candidate.findMany({
    where: { year },
    select: { pointMet: true, creditMet: true },
  });

  // ── 집계 ─────────────────────────────────────────────────
  type ConfStatus = "CONFIRMED" | "DEFERRED" | "PENDING";

  const getStatus = (status: string | null | undefined): ConfStatus =>
    (status as ConfStatus) ?? "PENDING";

  // 요약
  const summary = {
    totalCandidates: candidates.length,
    confirmed: 0,
    deferred: 0,
    pending: 0,
  };
  for (const c of candidates) {
    const s = getStatus(c.confirmation?.status);
    if (s === "CONFIRMED") summary.confirmed++;
    else if (s === "DEFERRED") summary.deferred++;
    else summary.pending++;
  }

  // 레벨별
  const levelMap = new Map<
    string,
    { total: number; confirmed: number; deferred: number; pending: number; normal: number; special: number }
  >();
  for (const c of candidates) {
    const lv = c.user?.level ?? "미설정";
    if (!levelMap.has(lv)) {
      levelMap.set(lv, { total: 0, confirmed: 0, deferred: 0, pending: 0, normal: 0, special: 0 });
    }
    const row = levelMap.get(lv)!;
    row.total++;
    const s = getStatus(c.confirmation?.status);
    if (s === "CONFIRMED") row.confirmed++;
    else if (s === "DEFERRED") row.deferred++;
    else row.pending++;
    if (c.promotionType === "special") row.special++;
    else row.normal++;
  }
  const byLevel = Array.from(levelMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([level, data]) => ({ level, ...data }));

  // 본부별
  const deptMap = new Map<
    string,
    { total: number; confirmed: number; deferred: number; pending: number }
  >();
  for (const c of candidates) {
    const dept = c.user?.department || "미설정";
    if (!deptMap.has(dept)) {
      deptMap.set(dept, { total: 0, confirmed: 0, deferred: 0, pending: 0 });
    }
    const row = deptMap.get(dept)!;
    row.total++;
    const s = getStatus(c.confirmation?.status);
    if (s === "CONFIRMED") row.confirmed++;
    else if (s === "DEFERRED") row.deferred++;
    else row.pending++;
  }
  const byDepartment = Array.from(deptMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([department, data]) => ({ department, ...data }));

  // 승진 유형
  const promotionType = {
    normal: candidates.filter((c) => c.promotionType !== "special").length,
    special: candidates.filter((c) => c.promotionType === "special").length,
  };

  // 포인트/학점 충족 현황 (전체 Candidate 기준)
  const metSummary = {
    bothMet: allCandidates.filter((c) => c.pointMet && c.creditMet).length,
    pointOnly: allCandidates.filter((c) => c.pointMet && !c.creditMet).length,
    creditOnly: allCandidates.filter((c) => !c.pointMet && c.creditMet).length,
    neitherMet: allCandidates.filter((c) => !c.pointMet && !c.creditMet).length,
    total: allCandidates.length,
  };

  return NextResponse.json({
    year,
    availableYears,
    summary,
    byLevel,
    byDepartment,
    promotionType,
    metSummary,
  });
}
