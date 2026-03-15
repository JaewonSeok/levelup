/**
 * 엑셀 기준 전체 직원 2025년 학점 일괄 업데이트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/update-credits-from-excel.ts
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as path from "path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const EXCEL_PATH = path.resolve(
  __dirname,
  "../levelup_upload_template (12) - 복사본.xlsx"
);
const CREDIT_YEAR = 2025;

interface ExcelRow {
  name: string;
  department: string;
  team: string;
  credit: number;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toStr(v: unknown): string {
  return String(v ?? "").trim();
}

async function main() {
  console.log("=".repeat(70));
  console.log("엑셀 → 2025년 학점 일괄 업데이트");
  console.log("=".repeat(70));

  // ── 1. 엑셀 파싱 ──────────────────────────────────────────────
  console.log(`\n[1] 엑셀 읽기: ${EXCEL_PATH}`);

  const wb = XLSX.readFile(EXCEL_PATH);
  const sheetName = wb.SheetNames.find(s => s.includes("직원정보")) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    range: 0,        // 1행 = 헤더
    defval: "",
  });

  console.log(`  시트: "${sheetName}" / 원본 행 수: ${raw.length}`);

  // 헤더 확인 (첫 행)
  if (raw.length > 0) {
    console.log(`  헤더 컬럼: ${Object.keys(raw[0]).join(" | ")}`);
  }

  // 컬럼명 매핑 (유연하게)
  const rows: ExcelRow[] = [];
  for (const r of raw) {
    const dept   = toStr(r["본부"] ?? r["부서"]);
    const team   = toStr(r["팀"]);
    const name   = toStr(r["이름"] ?? r["성명"]);
    const credit = toNum(r["학점"] ?? r["학점(누적)"] ?? r["학점합계"]);

    if (!name) continue; // 이름 없으면 스킵
    rows.push({ name, department: dept, team, credit });
  }

  console.log(`  파싱된 직원 수: ${rows.length}명`);

  // 학점 분포 미리 보기
  const nonZero = rows.filter(r => r.credit > 0).length;
  console.log(`  학점 > 0: ${nonZero}명 / 학점 = 0: ${rows.length - nonZero}명`);

  // ── 2. DB 매칭 & upsert ────────────────────────────────────────
  console.log(`\n[2] DB 매칭 및 ${CREDIT_YEAR}년 학점 upsert`);

  let successCount = 0;
  let failCount    = 0;
  const notFound:    string[] = [];
  const multiMatch:  string[] = [];

  for (const row of rows) {
    // 이름 + 본부 + 팀 3개 조합 매칭
    const users = await prisma.user.findMany({
      where: {
        name:       row.name,
        department: row.department,
        team:       row.team,
      },
      select: { id: true, name: true, department: true, team: true },
    });

    if (users.length === 0) {
      // 이름만으로 재시도 (팀명 불일치 대비)
      const byName = await prisma.user.findMany({
        where: { name: row.name },
        select: { id: true, name: true, department: true, team: true },
      });

      if (byName.length === 0) {
        notFound.push(`${row.name} (${row.department}/${row.team})`);
        failCount++;
        continue;
      }
      if (byName.length > 1) {
        multiMatch.push(
          `${row.name} — 동명이인 ${byName.length}명: ` +
          byName.map(u => `${u.department}/${u.team}`).join(", ") +
          ` | 엑셀: ${row.department}/${row.team}`
        );
        failCount++;
        continue;
      }
      // 이름으로만 1명 찾음 — 사용
      users.push(byName[0]);
    }

    if (users.length > 1) {
      multiMatch.push(
        `${row.name} (${row.department}/${row.team}) — ${users.length}명 매칭`
      );
      failCount++;
      continue;
    }

    const user = users[0];

    // 2025년 학점 upsert (cumulative = score = 엑셀 값)
    await prisma.credit.upsert({
      where: { userId_year: { userId: user.id, year: CREDIT_YEAR } },
      create: {
        userId:     user.id,
        year:       CREDIT_YEAR,
        score:      row.credit,
        cumulative: row.credit,
      },
      update: {
        score:      row.credit,
        cumulative: row.credit,
      },
    });

    successCount++;
  }

  // ── 3. 결과 출력 ──────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[결과] 성공: ${successCount}건 / 실패: ${failCount}건`);

  if (notFound.length > 0) {
    console.log(`\n❌ DB 미발견 (${notFound.length}명):`);
    for (const s of notFound) console.log(`   ${s}`);
  }
  if (multiMatch.length > 0) {
    console.log(`\n⚠️  동명이인 충돌 (${multiMatch.length}건):`);
    for (const s of multiMatch) console.log(`   ${s}`);
  }

  // ── 4. 최종 검증 ──────────────────────────────────────────────
  console.log(`\n[검증] DB에서 ${CREDIT_YEAR}년 학점 > 0인 직원 수 확인`);
  const positiveCount = await prisma.credit.count({
    where: { year: CREDIT_YEAR, score: { gt: 0 } },
  });
  const zeroCount = await prisma.credit.count({
    where: { year: CREDIT_YEAR, score: 0 },
  });
  const totalCreditRows = await prisma.credit.count({ where: { year: CREDIT_YEAR } });

  console.log(`  학점 > 0: ${positiveCount}명`);
  console.log(`  학점 = 0: ${zeroCount}명`);
  console.log(`  합계:     ${totalCreditRows}건`);

  if (positiveCount === 234) {
    console.log(`  ✅ 목표치 234명 일치`);
  } else {
    console.log(`  ⚠️  목표치 234명 불일치 (현재 ${positiveCount}명)`);
  }

  console.log("=".repeat(70));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
