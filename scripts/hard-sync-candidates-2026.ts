/**
 * 2026년 대상자 강제 동기화 — DIRECT_URL 사용 (pgbouncer 우회)
 * STEP 1: 현재 DB 전체 조회
 * STEP 2: 명단 외 삭제
 * STEP 3: 22명 upsert
 * STEP 4: 최종 확인
 *
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/hard-sync-candidates-2026.ts
 */
import * as dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";

// DIRECT_URL 우선 (pgbouncer 우회) — 없으면 DATABASE_URL 폴백
const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } },
});

const YEAR = 2026;

// ── 명단 (정확히 이 22명만) ───────────────────────────────────────
const TARGET_LIST = [
  { name: "정우승",  promotionType: "special" as const, dept: "경영지원본부",  team: "정보보안팀" },
  { name: "최승훈B", promotionType: "special" as const, dept: "연구개발본부",  team: "웹개발1팀"  },
  { name: "서현덕",  promotionType: "normal"  as const, dept: "경영지원본부",  team: "총무팀"    },
  { name: "조현철",  promotionType: "normal"  as const },
  { name: "조성훈",  promotionType: "normal"  as const },
  { name: "서원영",  promotionType: "normal"  as const },
  { name: "강성원",  promotionType: "normal"  as const },
  { name: "신진수",  promotionType: "normal"  as const },
  { name: "이수빈",  promotionType: "normal"  as const },
  { name: "박다빈",  promotionType: "normal"  as const },
  { name: "하승준",  promotionType: "normal"  as const },
  { name: "이석현",  promotionType: "normal"  as const },
  { name: "최성윤",  promotionType: "normal"  as const },
  { name: "이건준",  promotionType: "normal"  as const },
  { name: "민경환",  promotionType: "normal"  as const },
  { name: "문겸",    promotionType: "normal"  as const },
  { name: "용현준",  promotionType: "normal"  as const },
  { name: "이소윤",  promotionType: "normal"  as const },
  { name: "이한결",  promotionType: "normal"  as const },
  { name: "김가영",  promotionType: "normal"  as const },
  { name: "유주형",  promotionType: "normal"  as const },
  { name: "조영태",  promotionType: "normal"  as const },
] as const;

const LINE = "─".repeat(70);

async function main() {
  console.log("=".repeat(70));
  console.log(`2026년 대상자 강제 동기화  (DIRECT_URL: ${dbUrl.includes("pooler") ? "pooler" : "direct"})`);
  console.log("=".repeat(70));

  // ── STEP 1: 현재 상태 ────────────────────────────────────────────
  console.log("\n[STEP 1] 현재 candidates 테이블 year=2026 전체");

  const current = await prisma.candidate.findMany({
    where: { year: YEAR },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      id: true, source: true, promotionType: true, isReviewTarget: true,
      user: { select: { id: true, name: true, department: true, team: true, level: true } },
    },
  });

  console.log(`현재 ${current.length}건:`);
  for (const c of current) {
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    const src   = c.source === "excluded" ? "🚫excl" : c.source;
    console.log(
      `  ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(3)} ` +
      `${c.user.department}/${c.user.team}  [${badge}] src=${src}  rt=${c.isReviewTarget}`
    );
  }

  // ── STEP 2: 명단 22명 userId 확정 ───────────────────────────────
  console.log(`\n[STEP 2] 명단 ${TARGET_LIST.length}명 userId 확정`);

  const resolvedTargets: Array<{ userId: string; name: string; promotionType: "normal" | "special" }> = [];
  const notFound: string[] = [];

  for (const t of TARGET_LIST) {
    const where: { name: string; department?: string; team?: string; isActive?: boolean } = {
      name: t.name,
      isActive: true,
    };
    if ("dept" in t && t.dept) where.department = t.dept;
    if ("team" in t && t.team) where.team       = t.team;

    const found = await prisma.user.findMany({
      where,
      select: { id: true, name: true, department: true, team: true, level: true },
    });

    if (found.length === 0) {
      // dept/team 없이 이름만으로 재시도
      const fallback = await prisma.user.findMany({
        where: { name: t.name, isActive: true },
        select: { id: true, name: true, department: true, team: true, level: true },
      });
      if (fallback.length === 0) {
        console.log(`  ❌ '${t.name}' — DB에 없음`);
        notFound.push(t.name);
        continue;
      }
      if (fallback.length > 1) {
        console.log(`  ⚠️  '${t.name}' — 동명이인 ${fallback.length}명 (부서 지정 필요):`);
        for (const u of fallback) console.log(`       ${u.level} ${u.department}/${u.team}`);
        continue;
      }
      const u = fallback[0];
      console.log(`  ✅ ${u.name.padEnd(8)} (${u.level ?? "-"}, ${u.department}/${u.team}) [${t.promotionType}]`);
      resolvedTargets.push({ userId: u.id, name: u.name, promotionType: t.promotionType });
    } else if (found.length > 1) {
      console.log(`  ⚠️  '${t.name}' — 동명이인 ${found.length}명:`);
      for (const u of found) console.log(`       ${u.level} ${u.department}/${u.team}`);
      // 첫 번째 사용
      const u = found[0];
      resolvedTargets.push({ userId: u.id, name: u.name, promotionType: t.promotionType });
    } else {
      const u = found[0];
      console.log(`  ✅ ${u.name.padEnd(8)} (${u.level ?? "-"}, ${u.department}/${u.team}) [${t.promotionType}]`);
      resolvedTargets.push({ userId: u.id, name: u.name, promotionType: t.promotionType });
    }
  }

  if (notFound.length > 0) {
    console.log(`\n  ❗ 미발견 ${notFound.length}명: ${notFound.join(", ")}`);
  }

  // ── STEP 3: 명단 외 레코드 삭제 ─────────────────────────────────
  console.log(`\n[STEP 3] 명단 외 레코드 삭제`);

  const targetUserIdSet = new Set(resolvedTargets.map(t => t.userId));
  let deleted = 0;
  for (const c of current) {
    if (!targetUserIdSet.has(c.user.id)) {
      await prisma.candidate.delete({
        where: { userId_year: { userId: c.user.id, year: YEAR } },
      });
      console.log(`  🗑️  삭제: ${c.user.name} (${c.user.department}/${c.user.team}) src=${c.source}`);
      deleted++;
    }
  }
  if (deleted === 0) console.log("  (삭제 없음)");

  // ── STEP 4: 22명 upsert ──────────────────────────────────────────
  console.log(`\n[STEP 4] 22명 upsert (source=auto, isReviewTarget=true)`);

  let upserted = 0;
  for (const t of resolvedTargets) {
    const existing = current.find(c => c.user.id === t.userId);
    await prisma.candidate.upsert({
      where: { userId_year: { userId: t.userId, year: YEAR } },
      create: {
        userId: t.userId,
        year: YEAR,
        pointMet: true,
        creditMet: true,
        isReviewTarget: true,
        source: "auto",
        promotionType: t.promotionType,
      },
      update: {
        source: "auto",
        isReviewTarget: true,
        promotionType: t.promotionType,
        pointMet: true,
        creditMet: true,
      },
    });
    const changed =
      !existing ||
      existing.source !== "auto" ||
      existing.promotionType !== t.promotionType ||
      !existing.isReviewTarget;
    if (changed) {
      const label = existing ? "갱신" : "신규";
      console.log(`  ${existing ? "🔄" : "✅"} ${label}: ${t.name} [${t.promotionType === "special" ? "⚡특진" : "일반"}]`);
      upserted++;
    }
  }
  if (upserted === 0) console.log("  (변경 없음 — 모두 정상)");

  // ── STEP 5: 최종 확인 ────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`[STEP 5] 최종 확인 — candidates WHERE year=${YEAR}`);
  console.log("=".repeat(70));

  const final = await prisma.candidate.findMany({
    where: { year: YEAR },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      source: true, promotionType: true, isReviewTarget: true,
      user: { select: { name: true, department: true, team: true, level: true } },
    },
  });

  const active = final.filter(c => c.source !== "excluded");
  const excl   = final.filter(c => c.source === "excluded");

  console.log(`총 ${final.length}건 (대상자: ${active.length}명 / 제외: ${excl.length}건)\n`);
  console.log(
    `${"No".padEnd(3)} ${"이름".padEnd(8)} ${"레벨".padEnd(3)} ` +
    `${"본부/팀".padEnd(30)} ${"구분".padEnd(6)} 심사대상`
  );
  console.log(LINE);

  for (let i = 0; i < active.length; i++) {
    const c = active[i];
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    const loc   = `${c.user.department}/${c.user.team}`;
    console.log(
      `${String(i + 1).padEnd(3)} ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(3)} ` +
      `${loc.padEnd(30)} ${badge} ${c.isReviewTarget ? "✅" : "❌"}`
    );
  }
  if (excl.length > 0) {
    console.log(`\n제외: ${excl.map(e => e.user.name).join(", ")}`);
  }

  const ok = active.length === 22 && excl.length === 0;
  console.log(`\n${ok ? "✅ 22명 정확히 일치" : `❗ ${active.length}명 — 확인 필요`}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
