import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  // 1. 김채린 SELECT
  const users = await prisma.user.findMany({
    where: { name: "김채린" },
    select: { id: true, name: true, department: true, team: true, level: true },
  });

  console.log("=== 김채린 User 레코드 ===");
  for (const u of users) {
    console.log(`  id=${u.id}  dept=${u.department}/${u.team}  level=${u.level}`);
    const cand = await prisma.candidate.findUnique({
      where: { userId_year: { userId: u.id, year: 2026 } },
      select: { id: true, source: true, promotionType: true },
    });
    console.log(`  candidate: ${JSON.stringify(cand)}`);

    if (cand) {
      // 2. DELETE
      await prisma.candidate.delete({
        where: { userId_year: { userId: u.id, year: 2026 } },
      });
      console.log(`  ✅ 삭제 완료 (candidate.id=${cand.id})`);
    } else {
      console.log(`  ℹ️  year=2026 candidate 없음`);
    }
  }

  if (users.length === 0) {
    console.log("  ⚠️ 김채린 user 없음");
  }

  // 3. COUNT 확인
  const total = await prisma.candidate.count({ where: { year: 2026 } });
  const list  = await prisma.candidate.findMany({
    where: { year: 2026 },
    orderBy: { user: { name: "asc" } },
    select: { source: true, user: { select: { name: true } } },
  });
  console.log(`\n=== year=2026 candidates COUNT: ${total} ===`);
  for (const c of list) {
    console.log(`  ${c.user.name}  src=${c.source}`);
  }
}

main()
  .catch(e => { console.error("❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
