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

// 날짜 비교 키 (로컬 시간 기준 — 원본 findFirst 로직과 동일)
function hireDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

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

  // ── 5. DB 저장 (배치 처리 — 순차 쿼리 대신 일괄/병렬) ────
  let successCount = 0;
  let skipCount = 0;
  const saveErrors: Array<{ row: number; sheet: string; name: string; errors: string[] }> = [];
  const CURRENT_YEAR = new Date().getFullYear();

  // 포인트/학점 저장 시 사용할 기준값 맵
  const criteriaList = await prisma.levelCriteria.findMany();
  const criteriaMap = new Map(criteriaList.map((c) => [`${c.level}_${c.year}`, c]));

  // 5-1. 기존 사용자 일괄 조회 (275번 findFirst → 1번 findMany)
  const uploadedNames = [...new Set(validRows.map((r) => r.name))];
  const existingUsersList = await prisma.user.findMany({
    where: { name: { in: uploadedNames } },
    select: { id: true, name: true, hireDate: true },
  });
  const existingMap = new Map<string, string>(); // "name_dateKey" → userId
  for (const u of existingUsersList) {
    existingMap.set(`${u.name}_${hireDateKey(u.hireDate)}`, u.id);
  }

  // 5-2. 행 분류: 신규 생성 / 업데이트 / 스킵
  type ParsedRow = (typeof validRows)[0];
  const toCreate: ParsedRow[] = [];
  const toUpdate: { row: ParsedRow; existingId: string }[] = [];

  for (const row of validRows) {
    const key = `${row.name}_${hireDateKey(row.hireDate!)}`;
    const existingId = existingMap.get(key);
    if (existingId) {
      if (duplicatePolicy === "skip") {
        skipCount++;
      } else {
        toUpdate.push({ row, existingId });
      }
    } else {
      toCreate.push(row);
    }
  }

  // savedRows: grade/point/credit 저장 대상 (신규 + 업데이트)
  const savedRows: { row: ParsedRow; userId: string }[] = [];

  // 5-3. 신규 사용자 일괄 생성 (createMany → ID 재조회)
  if (toCreate.length > 0) {
    try {
      await prisma.user.createMany({
        data: toCreate.map((row) => ({
          name: row.name,
          department: row.department,
          team: row.team,
          level: row.level as Level,
          position: row.position || null,
          employmentType: "REGULAR" as EmploymentType,
          hireDate: row.hireDate!,
          yearsOfService: row.yearsOfService,
          competencyLevel: row.competencyLevel || null,
          levelUpYear: row.levelUpYear ?? null,
          isActive: true,
        })),
        skipDuplicates: true,
      });

      // 생성된 ID 재조회 (createMany는 ID를 반환하지 않으므로)
      const createdUsers = await prisma.user.findMany({
        where: { name: { in: toCreate.map((r) => r.name) } },
        select: { id: true, name: true, hireDate: true },
      });
      const createdMap = new Map<string, string>();
      for (const u of createdUsers) {
        createdMap.set(`${u.name}_${hireDateKey(u.hireDate)}`, u.id);
      }

      for (const row of toCreate) {
        const userId = createdMap.get(`${row.name}_${hireDateKey(row.hireDate!)}`);
        if (userId) {
          savedRows.push({ row, userId });
          successCount++;
        } else {
          saveErrors.push({
            row: row.rowIndex,
            sheet: row.sheet,
            name: row.name || "(없음)",
            errors: ["생성 후 ID 조회 실패"],
          });
        }
      }
    } catch (e) {
      // createMany 실패 시 개별 생성으로 폴백
      for (const row of toCreate) {
        try {
          const created = await prisma.user.create({
            data: {
              name: row.name,
              department: row.department,
              team: row.team,
              level: row.level as Level,
              position: row.position || null,
              employmentType: "REGULAR" as EmploymentType,
              hireDate: row.hireDate!,
              yearsOfService: row.yearsOfService,
              competencyLevel: row.competencyLevel || null,
              levelUpYear: row.levelUpYear ?? null,
              isActive: true,
            },
          });
          savedRows.push({ row, userId: created.id });
          successCount++;
        } catch (createErr) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          console.error(`[upload] 신규 생성 오류 (${row.name}, 행 ${row.rowIndex}):`, msg);
          saveErrors.push({
            row: row.rowIndex,
            sheet: row.sheet,
            name: row.name || "(없음)",
            errors: [msg],
          });
        }
      }
    }
  }

  // 5-4. 기존 사용자 병렬 업데이트
  if (toUpdate.length > 0) {
    const updateResults = await Promise.allSettled(
      toUpdate.map(({ row, existingId }) =>
        prisma.user.update({
          where: { id: existingId },
          data: {
            name: row.name,
            department: row.department,
            team: row.team,
            level: row.level as Level,
            position: row.position || null,
            employmentType: "REGULAR" as EmploymentType,
            hireDate: row.hireDate!,
            yearsOfService: row.yearsOfService,
            competencyLevel: row.competencyLevel || null,
            levelUpYear: row.levelUpYear ?? null,
            isActive: true,
          },
        })
      )
    );

    for (let i = 0; i < toUpdate.length; i++) {
      const result = updateResults[i];
      const { row, existingId } = toUpdate[i];
      if (result.status === "fulfilled") {
        savedRows.push({ row, userId: existingId });
        successCount++;
      } else {
        const msg =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[upload] 업데이트 오류 (${row.name}, 행 ${row.rowIndex}):`, msg);
        saveErrors.push({
          row: row.rowIndex,
          sheet: row.sheet,
          name: row.name || "(없음)",
          errors: [msg],
        });
      }
    }
  }

  // 5-5. 업데이트 모드: 기존 평가등급 + 학점 일괄 삭제
  if (duplicatePolicy === "update" && toUpdate.length > 0) {
    const updatedIds = toUpdate.map(({ existingId }) => existingId);
    await Promise.all([
      prisma.performanceGrade.deleteMany({ where: { userId: { in: updatedIds } } }),
      prisma.credit.deleteMany({ where: { userId: { in: updatedIds } } }),
    ]);
  }

  // 5-6. 평가등급 일괄 저장 (N×5 upsert → 1 createMany)
  const gradeData: { userId: string; year: number; grade: string }[] = [];
  for (const { row, userId } of savedRows) {
    const entries = [
      { year: 2021, grade: row.grade2021 ?? "" },
      { year: 2022, grade: row.grade2022 ?? "" },
      { year: 2023, grade: row.grade2023 ?? "" },
      { year: 2024, grade: row.grade2024 ?? "" },
      { year: 2025, grade: row.grade2025 ?? "" },
    ].filter((e) => e.grade !== "");
    for (const e of entries) {
      gradeData.push({ userId, year: e.year, grade: e.grade });
    }
  }
  if (gradeData.length > 0) {
    await prisma.performanceGrade.createMany({
      data: gradeData,
      skipDuplicates: true,
    });
  }

  // 5-7. 포인트 병렬 upsert
  const pointOps = savedRows
    .filter(({ row }) => row.pointScore != null)
    .map(({ row, userId }) => {
      const pointYear = Math.min(row.levelUpYear ?? CURRENT_YEAR, 2025);
      const pointCriteria = row.level ? criteriaMap.get(`${row.level}_${pointYear}`) : null;
      const isMet = pointCriteria ? row.pointScore! >= pointCriteria.requiredPoints : false;
      return prisma.point.upsert({
        where: { userId_year: { userId, year: pointYear } },
        create: { userId, year: pointYear, score: row.pointScore!, merit: 0, penalty: 0, cumulative: row.pointScore!, isMet },
        update: { score: row.pointScore!, cumulative: row.pointScore!, isMet },
      });
    });
  if (pointOps.length > 0) {
    await Promise.all(pointOps);
  }

  // 5-8. 학점 병렬 upsert
  const creditOps = savedRows
    .filter(({ row }) => row.creditScore != null)
    .map(({ row, userId }) => {
      const creditYear = Math.min(row.levelUpYear ?? CURRENT_YEAR, 2025);
      const creditCriteria = row.level ? criteriaMap.get(`${row.level}_${creditYear}`) : null;
      const isMet = creditCriteria ? row.creditScore! >= creditCriteria.requiredCredits : false;
      return prisma.credit.upsert({
        where: { userId_year: { userId, year: creditYear } },
        create: { userId, year: creditYear, score: row.creditScore!, cumulative: row.creditScore!, isMet },
        update: { score: row.creditScore!, cumulative: row.creditScore!, isMet },
      });
    });
  if (creditOps.length > 0) {
    await Promise.all(creditOps);
  }

  // ── 6. 업로드 이력 기록 ───────────────────────────────────
  const allErrors = [
    ...errorRows.map((r) => ({ row: r.rowIndex, sheet: r.sheet, name: r.name || "(없음)", errors: r.errors })),
    ...saveErrors,
  ];
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
