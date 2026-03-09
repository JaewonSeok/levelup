/**
 * 5명 강제 대상자 등록 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/add-manual-candidates.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_YEAR = 2026;
const TARGET_NAMES = ["조성훈", "서원영", "신진수", "박다빈", "하승준"];

async function main() {
  console.log("=".repeat(60));
  console.log(`📋 ${TARGET_YEAR}년 대상자 강제 등록`);
  console.log(`   대상: ${TARGET_NAMES.join(", ")}`);
  console.log("=".repeat(60));

  for (const name of TARGET_NAMES) {
    const users = await prisma.user.findMany({
      where: { name },
      select: { id: true, name: true, level: true, isActive: true, department: true, team: true },
    });

    if (users.length === 0) {
      console.log(`\n  ❌ '${name}' — DB에 없음 (users 테이블에 레코드 없음)`);
      continue;
    }

    for (const user of users) {
      if (!user.isActive) {
        console.log(`\n  ⚠️  '${user.name}' (${user.level ?? "-"}, ${user.department}) — isActive=false, 스킵`);
        continue;
      }

      const existing = await prisma.candidate.findUnique({
        where: { userId_year: { userId: user.id, year: TARGET_YEAR } },
        select: { id: true, source: true, pointMet: true, creditMet: true },
      });

      const result = await prisma.candidate.upsert({
        where: { userId_year: { userId: user.id, year: TARGET_YEAR } },
        create: {
          userId: user.id,
          year: TARGET_YEAR,
          pointMet: false,
          creditMet: false,
          isReviewTarget: true,
          source: "manual",
          promotionType: "normal",
        },
        update: {
          source: "manual",
          isReviewTarget: true,
        },
      });

      if (existing) {
        console.log(`\n  🔄 '${user.name}' (${user.level ?? "-"}, ${user.department}/${user.team})`);
        console.log(`     기존 source=${existing.source} → manual  id=${result.id}`);
      } else {
        console.log(`\n  ✅ '${user.name}' (${user.level ?? "-"}, ${user.department}/${user.team})`);
        console.log(`     신규 등록  id=${result.id}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("완료. 대상자 관리 페이지를 새로고침하면 실제 포인트/학점이 반영됩니다.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
