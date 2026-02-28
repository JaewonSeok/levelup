import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseExcelFile } from "@/lib/excel/parse";
import { Level, EmploymentType, Role } from "@prisma/client";
import { recalculatePointsFromGrades } from "@/lib/points/recalculate";
import { autoSelectCandidates } from "@/lib/candidates/auto-select";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

export async function POST(req: NextRequest) {
  // ── 1. 인증 / 권한 ────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "인사팀 또는 시스템 관리자만 업로드할 수 있습니다." }, { status: 403 });
  }

  // ── 2. FormData 파싱 ──────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const duplicatePolicy = (formData.get("duplicatePolicy") as string) ?? "skip";

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  // ── 3. 파일 기본 검증 ─────────────────────────────────────
  // [KISA2021-6] 확장자 + MIME 타입 이중 검증
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: ".xlsx 파일만 허용됩니다." }, { status: 400 });
  }
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (file.type && file.type !== XLSX_MIME) {
    return NextResponse.json({ error: ".xlsx 파일만 허용됩니다." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "파일 크기는 10MB 이하여야 합니다." }, { status: 400 });
  }

  // ── 4. Excel 파싱 ─────────────────────────────────────────
  const buffer = await file.arrayBuffer();
  let parsedRows;
  try {
    parsedRows = parseExcelFile(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `Excel 파싱 오류: ${msg}. 파일 형식을 확인해주세요.` },
      { status: 400 }
    );
  }

  if (parsedRows.length === 0) {
    return NextResponse.json(
      { error: "데이터가 없습니다. 파일에 내용이 있는지 확인해주세요." },
      { status: 400 }
    );
  }

  const validRows = parsedRows.filter((r) => r.errors.length === 0);
  const errorRows = parsedRows.filter((r) => r.errors.length > 0);

  // 유효한 행이 없으면 DB 저장 없이 오류 반환
  if (validRows.length === 0) {
    return NextResponse.json({
      totalCount: parsedRows.length,
      successCount: 0,
      skipCount: 0,
      errorCount: errorRows.length,
      errors: errorRows.map((r) => ({
        row: r.rowIndex,
        sheet: r.sheet,
        name: r.name || "(없음)",
        errors: r.errors,
      })),
    });
  }

  // ── 5. DB 저장 (행별 개별 저장 — Supabase PgBouncer 호환) ──
  let successCount = 0;
  let skipCount = 0;
  const saveErrors: Array<{ row: number; sheet: string; name: string; errors: string[] }> = [];

  // 포인트/학점 저장 시 사용할 기준값 맵 (level_year → criteria)
  const criteriaList = await prisma.levelCriteria.findMany();
  const criteriaMap = new Map(criteriaList.map((c) => [`${c.level}_${c.year}`, c]));
  const CURRENT_YEAR = new Date().getFullYear();

  for (const row of validRows) {
    try {
      const hireDate = row.hireDate!;

      // 중복 검사: 이름 + 입사일자 (같은 날짜)
      const dayStart = new Date(hireDate.getFullYear(), hireDate.getMonth(), hireDate.getDate());
      const dayEnd = new Date(hireDate.getFullYear(), hireDate.getMonth(), hireDate.getDate() + 1);

      const existing = await prisma.user.findFirst({
        where: {
          name: row.name,
          hireDate: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true },
      });

      const userData = {
        name: row.name,
        department: row.department,
        team: row.team,
        level: row.level as Level,
        position: row.position || null,
        employmentType: "REGULAR" as EmploymentType,
        hireDate,
        yearsOfService: row.yearsOfService,
        competencyLevel: row.competencyLevel || null,
        levelUpYear: row.levelUpYear ?? null,
        isActive: true,
      };

      let savedUserId: string | null = null;

      if (existing) {
        if (duplicatePolicy === "skip") {
          skipCount++;
        } else {
          // update: 인사 정보만 업데이트 (email/password/role 유지)
          await prisma.user.update({
            where: { id: existing.id },
            data: userData,
          });
          savedUserId = existing.id;
          successCount++;
        }
      } else {
        const created = await prisma.user.create({ data: userData });
        savedUserId = created.id;
        successCount++;
      }

      // 업데이트 모드: 기존 평가등급/학점 삭제 후 재저장
      if (savedUserId && duplicatePolicy === "update" && existing) {
        await prisma.performanceGrade.deleteMany({ where: { userId: savedUserId } });
        await prisma.credit.deleteMany({ where: { userId: savedUserId } });
      }

      // 평가등급 upsert (등급이 있는 연도만)
      if (savedUserId) {
        const gradeEntries: { year: number; grade: string }[] = [
          { year: 2021, grade: row.grade2021 ?? "" },
          { year: 2022, grade: row.grade2022 ?? "" },
          { year: 2023, grade: row.grade2023 ?? "" },
          { year: 2024, grade: row.grade2024 ?? "" },
          { year: 2025, grade: row.grade2025 ?? "" },
        ].filter((e) => e.grade !== "");

        for (const entry of gradeEntries) {
          await prisma.performanceGrade.upsert({
            where: { userId_year: { userId: savedUserId, year: entry.year } },
            create: { userId: savedUserId, year: entry.year, grade: entry.grade },
            update: { grade: entry.grade },
          });
        }

        // 포인트 upsert (최대 연도: 2025)
        if (row.pointScore != null) {
          const pointYear = Math.min(row.levelUpYear ?? CURRENT_YEAR, 2025);
          const pointCriteria = row.level ? criteriaMap.get(`${row.level}_${pointYear}`) : null;
          const isMet = pointCriteria ? row.pointScore >= pointCriteria.requiredPoints : false;
          await prisma.point.upsert({
            where: { userId_year: { userId: savedUserId, year: pointYear } },
            create: {
              userId: savedUserId,
              year: pointYear,
              score: row.pointScore,
              merit: 0,
              penalty: 0,
              cumulative: row.pointScore,
              isMet,
            },
            update: {
              score: row.pointScore,
              cumulative: row.pointScore,
              isMet,
            },
          });
        }

        // 학점 upsert (최대 연도: 2025, 크레딧 화면 MAX_CREDIT_YEAR=2025 기준)
        if (row.creditScore != null) {
          const creditYear = Math.min(row.levelUpYear ?? CURRENT_YEAR, 2025);
          const creditCriteria = row.level ? criteriaMap.get(`${row.level}_${creditYear}`) : null;
          const isMet = creditCriteria ? row.creditScore >= creditCriteria.requiredCredits : false;
          await prisma.credit.upsert({
            where: { userId_year: { userId: savedUserId, year: creditYear } },
            create: {
              userId: savedUserId,
              year: creditYear,
              score: row.creditScore,
              cumulative: row.creditScore,
              isMet,
            },
            update: {
              score: row.creditScore,
              cumulative: row.creditScore,
              isMet,
            },
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[upload] 행 저장 오류 (${row.name}, 행 ${row.rowIndex}):`, msg);
      saveErrors.push({
        row: row.rowIndex,
        sheet: row.sheet,
        name: row.name || "(없음)",
        errors: [msg],
      });
    }
  }

  // ── 6. 업로드 이력 기록 ───────────────────────────────────
  const allErrors = [...errorRows.map((r) => ({ row: r.rowIndex, sheet: r.sheet, name: r.name || "(없음)", errors: r.errors })), ...saveErrors];
  const overallStatus =
    allErrors.length === 0 && skipCount === 0
      ? "success"
      : successCount === 0 && skipCount === 0
        ? "failed"
        : "partial";

  await prisma.uploadHistory.create({
    data: {
      filename: file.name,
      uploadedBy: session.user.id,
      recordCount: parsedRows.length,
      successCount,
      skipCount,
      status: overallStatus,
      errorLog: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
    },
  });

  // ── 7. 포인트 재계산 → 자동 선정 (비동기) ────────────────
  const currentYear = new Date().getFullYear();
  prisma.gradeCriteria.count().then((cnt) => {
    if (cnt > 0) {
      recalculatePointsFromGrades()
        .then(() => autoSelectCandidates(currentYear))
        .catch((e) => console.error("[upload] recalculate error:", e));
    }
  }).catch(() => {});

  // ── 8. 응답 ───────────────────────────────────────────────
  return NextResponse.json({
    totalCount: parsedRows.length,
    successCount,
    skipCount,
    errorCount: allErrors.length,
    errors: allErrors.map((r) => ({
      row: r.row,
      sheet: r.sheet,
      name: r.name,
      errors: r.errors,
    })),
  });
}
