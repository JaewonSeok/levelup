/**
 * 2026년 대상자 목록을 정확히 22명으로 동기화
 * - 명단 외 레코드 삭제 (excluded 포함)
 * - 누락 레코드 신규 등록
 * - promotionType 보정
 *
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/sync-candidates-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const YEAR = 2026;

// 정확한 대상자 명단
const TARGET_LIST: Array<{
  name: string;
  promotionType: "normal" | "special";
  department?: string; // 동명이인 구분용
  team?: string;
}> = [
  // 특진
  { name: "정우승",  promotionType: "special" },
  { name: "최승훈B", promotionType: "special", department: "연구개발본부", team: "웹개발1팀" },
  // 일반
  { name: "서현덕",  promotionType: "normal" },
  { name: "조현철",  promotionType: "normal" },
  { name: "조성훈",  promotionType: "normal" },
  { name: "서원영",  promotionType: "normal" },
  { name: "강성원",  promotionType: "normal" },
  { name: "신진수",  promotionType: "normal" },
  { name: "이수빈",  promotionType: "normal" },
  { name: "박다빈",  promotionType: "normal" },
  { name: "하승준",  promotionType: "normal" },
  { name: "이석현",  promotionType: "normal" },
  { name: "최성윤",  promotionType: "normal" },
  { name: "이건준",  promotionType: "normal" },
  { name: "민경환",  promotionType: "normal" },
  { name: "문겸",    promotionType: "normal" },
  { name: "용현준",  promotionType: "normal" },
  { name: "이소윤",  promotionType: "normal" },
  { name: "이한결",  promotionType: "normal" },
  { name: "김가영",  promotionType: "normal" },
  { name: "유주형",  promotionType: "normal" },
  { name: "조영태",  promotionType: "normal" },
];

function sep(char = "─", len = 65) { return char.repeat(len); }

async function main() {
  console.log(sep("="));
  console.log(`2026년 대상자 동기화 (목표: ${TARGET_LIST.length}명)`);
  console.log(sep("="));

  // ── STEP 1: 현재 DB 전체 조회 ────────────────────────────────
  console.log("\n[STEP 1] 현재 year=2026 candidate 레코드 전체");

  const current = await prisma.candidate.findMany({
    where: { year: YEAR },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      id: true,
      source: true,
      promotionType: true,
      isReviewTarget: true,
      user: { select: { id: true, name: true, department: true, team: true, level: true } },
    },
  });

  console.log(`현재 ${current.length}건:`);
  for (const c of current) {
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    const src   = c.source === "excluded" ? "🚫excl" : c.source;
    console.log(`  ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(3)} ${c.user.department}/${c.user.team} [${badge}] src=${src}`);
  }

  // ── STEP 2: 명단에서 userId 확정 ─────────────────────────────
  console.log("\n[STEP 2] 명단 22명 userId 확정");

  const targetUserIds: string[] = [];
  const notFound: string[] = [];

  for (const t of TARGET_LIST) {
    const whereClause: { name: string; department?: string; team?: string } = { name: t.name };
    if (t.department) whereClause.department = t.department;
    if (t.team)       whereClause.team       = t.team;

    const users = await prisma.user.findMany({
      where: whereClause,
      select: { id: true, name: true, department: true, team: true, level: true, isActive: true },
    });

    const active = users.filter(u => u.isActive);

    if (active.length === 0) {
      console.log(`  ❌ '${t.name}' — 없음 (isActive users 0명)`);
      notFound.push(t.name);
    } else if (active.length > 1) {
      // 동명이인: department/team 조건으로 1명이어야 하는데 여전히 여러 명
      console.log(`  ⚠️  '${t.name}' — 동명이인 ${active.length}명:`);
      for (const u of active) {
        console.log(`       id=${u.id.slice(-8)} ${u.level} ${u.department}/${u.team}`);
      }
      // 첫 번째만 사용
      targetUserIds.push(active[0].id);
    } else {
      const u = active[0];
      const badge = t.promotionType === "special" ? "⚡특진" : "일반";
      console.log(`  ✅ ${u.name.padEnd(8)} (${u.level ?? "-"}, ${u.department}/${u.team}) [${badge}]`);
      targetUserIds.push(u.id);
    }
  }

  if (notFound.length > 0) {
    console.log(`\n  ❗ 미발견 ${notFound.length}명: ${notFound.join(", ")}`);
    console.log("  → 해당 직원이 DB에 없으면 엑셀 업로드 후 재실행하세요.");
  }

  // ── STEP 3: 명단 외 레코드 삭제 ──────────────────────────────
  console.log("\n[STEP 3] 명단 외 레코드 삭제");

  let deleted = 0;
  for (const c of current) {
    if (!targetUserIds.includes(c.user.id)) {
      await prisma.candidate.delete({
        where: { userId_year: { userId: c.user.id, year: YEAR } },
      });
      console.log(`  🗑️  삭제: ${c.user.name} (${c.user.department}/${c.user.team}) src=${c.source}`);
      deleted++;
    }
  }
  if (deleted === 0) console.log("  (삭제할 레코드 없음)");

  // ── STEP 4: 누락/불일치 레코드 upsert ────────────────────────
  console.log("\n[STEP 4] 누락 or 불일치 레코드 upsert");

  let upserted = 0;
  const currentUserIds = new Set(current.map(c => c.user.id));

  for (let i = 0; i < TARGET_LIST.length; i++) {
    const t = TARGET_LIST[i];
    const userId = targetUserIds[i];
    if (!userId) continue; // 미발견

    const existing = current.find(c => c.user.id === userId);
    const needsUpdate = existing && (
      existing.promotionType !== t.promotionType ||
      existing.source === "excluded"
    );

    if (!existing || needsUpdate) {
      await prisma.candidate.upsert({
        where: { userId_year: { userId, year: YEAR } },
        create: {
          userId,
          year:           YEAR,
          pointMet:       true,
          creditMet:      true,
          isReviewTarget: true,
          source:         "auto",
          promotionType:  t.promotionType,
        },
        update: {
          source:         "auto",
          isReviewTarget: true,
          promotionType:  t.promotionType,
          pointMet:       true,
          creditMet:      true,
        },
      });
      const label = needsUpdate ? "갱신" : "신규";
      console.log(`  ${needsUpdate ? "🔄" : "✅"} ${label}: ${t.name} [${t.promotionType === "special" ? "특진" : "일반"}]`);
      upserted++;
    } else {
      // 이미 있고 promotionType도 맞음 — source가 "auto" 아닌 경우만 보정
      if (existing.source !== "auto" || !existing.isReviewTarget) {
        await prisma.candidate.update({
          where: { userId_year: { userId, year: YEAR } },
          data: { source: "auto", isReviewTarget: true },
        });
        console.log(`  🔄 보정: ${t.name} (source→auto, isReviewTarget→true)`);
        upserted++;
      }
    }
  }
  if (upserted === 0) console.log("  (변경 없음 — 모두 정상)");

  // ── STEP 5: 최종 확인 ─────────────────────────────────────────
  console.log("\n" + sep("="));
  console.log("[최종] year=2026 대상자 확인");
  console.log(sep("="));

  const finalList = await prisma.candidate.findMany({
    where: { year: YEAR },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      source: true,
      promotionType: true,
      isReviewTarget: true,
      user: { select: { name: true, department: true, team: true, level: true } },
    },
  });

  const active22 = finalList.filter(c => c.source !== "excluded");
  const excl     = finalList.filter(c => c.source === "excluded");

  console.log(`등록된 대상자: ${active22.length}명 / 제외(excluded): ${excl.length}건\n`);
  console.log(`${"No.".padEnd(4)} ${"이름".padEnd(8)} ${"레벨".padEnd(4)} ${"본부/팀".padEnd(28)} ${"구분".padEnd(6)} ${"심사대상"}`);
  console.log(sep("-", 70));

  for (let i = 0; i < active22.length; i++) {
    const c = active22[i];
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    const loc   = `${c.user.department}/${c.user.team}`;
    console.log(
      `${String(i + 1).padEnd(4)} ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(4)} ${loc.padEnd(28)} ${badge} ${c.isReviewTarget ? "✅" : "❌"}`
    );
  }

  if (excl.length > 0) {
    console.log(`\n제외 목록: ${excl.map(e => e.user.name).join(", ")}`);
  }

  console.log(`\n${active22.length === 22 ? "✅ 22명 정확히 일치" : `❗ ${active22.length}명 — 확인 필요`}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
