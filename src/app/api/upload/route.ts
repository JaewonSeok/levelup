import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseExcelFile } from "@/lib/excel/parse";
import { Level, EmploymentType, Role } from "@prisma/client";

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
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
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

  // ── 5. DB 저장 (트랜잭션) ─────────────────────────────────
  let successCount = 0;
  let skipCount = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of validRows) {
        const hireDate = row.hireDate!;

        // 중복 검사: 이름 + 입사일자 (같은 날짜)
        const dayStart = new Date(hireDate.getFullYear(), hireDate.getMonth(), hireDate.getDate());
        const dayEnd = new Date(hireDate.getFullYear(), hireDate.getMonth(), hireDate.getDate() + 1);

        const existing = await tx.user.findFirst({
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
          employmentType: row.employmentType as EmploymentType,
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
            await tx.user.update({
              where: { id: existing.id },
              data: userData,
            });
            savedUserId = existing.id;
            successCount++;
          }
        } else {
          const created = await tx.user.create({ data: userData });
          savedUserId = created.id;
          successCount++;
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
            await tx.performanceGrade.upsert({
              where: { userId_year: { userId: savedUserId, year: entry.year } },
              create: { userId: savedUserId, year: entry.year, grade: entry.grade },
              update: { grade: entry.grade },
            });
          }
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ error: `DB 저장 오류: ${msg}` }, { status: 500 });
  }

  // ── 6. 업로드 이력 기록 ───────────────────────────────────
  const overallStatus =
    errorRows.length === 0 && skipCount === 0
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
      errorLog:
        errorRows.length > 0
          ? JSON.stringify(
              errorRows.map((r) => ({
                sheet: r.sheet,
                row: r.rowIndex,
                name: r.name || "(없음)",
                errors: r.errors,
              }))
            )
          : null,
    },
  });

  // ── 7. 응답 ───────────────────────────────────────────────
  return NextResponse.json({
    totalCount: parsedRows.length,
    successCount,
    skipCount,
    errorCount: errorRows.length,
    errors: errorRows.map((r) => ({
      row: r.rowIndex,
      sheet: r.sheet,
      name: r.name || "(없음)",
      errors: r.errors,
    })),
  });
}
