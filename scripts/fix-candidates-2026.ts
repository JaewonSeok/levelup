/**
 * 대상자 관리 3가지 수정 스크립트
 * 1. 김채린 자동 등록 레코드 삭제 (User는 유지)
 * 2. source="manual" → "auto" 일괄 변경 (year=2026)
 * 3. 최승훈(연구개발본부/응용개발팀) name → "최승훈B"
 *
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/fix-candidates-2026.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const YEAR = 2026;

async function main() {
  console.log("=".repeat(65));
  console.log("대상자 관리 수정 스크립트");
  console.log("=".repeat(65));

  // ── 1. 김채린 대상자 레코드 삭제 ───────────────────────────────
  console.log("\n[1] 김채린 자동 레코드 삭제");

  const kcrUsers = await prisma.user.findMany({
    where: { name: "김채린" },
    select: { id: true, name: true, department: true, team: true, level: true },
  });

  if (kcrUsers.length === 0) {
    console.log("  ⚠️  '김채린' 직원이 DB에 없음 — 스킵");
  } else {
    for (const u of kcrUsers) {
      console.log(`  직원: ${u.name} (${u.level ?? "-"}, ${u.department}/${u.team}) id=${u.id.slice(-8)}`);

      const cand = await prisma.candidate.findUnique({
        where: { userId_year: { userId: u.id, year: YEAR } },
        select: { id: true, source: true, promotionType: true },
      });

      if (!cand) {
        console.log(`  ℹ️  year=${YEAR} 대상자 레코드 없음 — 스킵`);
        continue;
      }

      console.log(`  대상자 레코드: id=${cand.id.slice(-8)} source=${cand.source} promotionType=${cand.promotionType}`);

      // Review, Confirmation, CandidateNote는 Cascade Cascade로 연결됨
      await prisma.candidate.delete({
        where: { userId_year: { userId: u.id, year: YEAR } },
      });
      console.log(`  ✅ 삭제 완료 (User 레코드는 유지)`);
    }
  }

  // ── 2. source="manual" → "auto" 일괄 변경 ──────────────────────
  console.log("\n[2] source=manual → auto 일괄 변경 (year=2026)");

  const manualCands = await prisma.candidate.findMany({
    where: { year: YEAR, source: "manual" },
    select: { id: true, user: { select: { name: true, department: true } } },
  });

  if (manualCands.length === 0) {
    console.log("  ℹ️  source=manual 레코드 없음 — 이미 모두 auto");
  } else {
    const updateResult = await prisma.candidate.updateMany({
      where: { year: YEAR, source: "manual" },
      data: { source: "auto" },
    });
    console.log(`  ✅ ${updateResult.count}건 업데이트 완료`);
    for (const c of manualCands) {
      console.log(`     - ${c.user.name} (${c.user.department})`);
    }
  }

  // ── 3. 최승훈 → 최승훈B 이름 변경 ─────────────────────────────
  console.log("\n[3] 최승훈 → 최승훈B 이름 변경");

  // 동명이인 확인
  const allChoi = await prisma.user.findMany({
    where: { name: { startsWith: "최승훈" } },
    select: { id: true, name: true, department: true, team: true, level: true, isActive: true },
  });

  if (allChoi.length === 0) {
    console.log("  ⚠️  '최승훈' 직원이 DB에 없음 — 스킵");
  } else {
    console.log(`  '최승훈' 패턴 직원 목록 (${allChoi.length}명):`);
    for (const u of allChoi) {
      console.log(`    id=${u.id.slice(-8)} | ${u.name} | ${u.level ?? "-"} | ${u.department}/${u.team} | active=${u.isActive}`);
    }

    // 연구개발본부/응용개발팀의 최승훈 → 최승훈B
    const target = allChoi.find(
      u => u.department === "연구개발본부" && u.team === "응용개발팀" && u.name === "최승훈"
    );

    if (!target) {
      console.log("  ⚠️  연구개발본부/응용개발팀의 '최승훈' 없음 — 스킵");
      console.log("  ℹ️  위 목록에서 대상을 확인하고 스크립트를 수정하세요.");
    } else {
      await prisma.user.update({
        where: { id: target.id },
        data: { name: "최승훈B" },
      });
      console.log(`  ✅ id=${target.id.slice(-8)} 이름 변경: '최승훈' → '최승훈B'`);
    }
  }

  // ── 최종 결과: 2026년 대상자 전체 목록 ─────────────────────────
  console.log("\n" + "=".repeat(65));
  console.log(`[최종] ${YEAR}년 대상자 전체 목록`);
  console.log("=".repeat(65));

  const finalList = await prisma.candidate.findMany({
    where: { year: YEAR },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      id: true,
      source: true,
      promotionType: true,
      isReviewTarget: true,
      pointMet: true,
      creditMet: true,
      user: {
        select: { name: true, department: true, team: true, level: true },
      },
    },
  });

  console.log(`총 ${finalList.length}명`);
  console.log(
    `${"No.".padEnd(4)} ${"이름".padEnd(8)} ${"레벨".padEnd(4)} ${"본부".padEnd(16)} ${"팀".padEnd(12)} ${"구분".padEnd(6)} ${"source".padEnd(6)} ${"심사대상"}`
  );
  console.log("-".repeat(80));

  for (let i = 0; i < finalList.length; i++) {
    const c = finalList[i];
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    console.log(
      `${String(i + 1).padEnd(4)} ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(4)} ${c.user.department.padEnd(16)} ${c.user.team.padEnd(12)} ${badge} ${c.source.padEnd(6)} ${c.isReviewTarget ? "✅" : "-"}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
