/**
 * GradeCriteria yearRange 마이그레이션
 * "2022-2024" → "2021-2024"
 * 기본값 upsert
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== GradeCriteria 마이그레이션 시작 ===");

  // 1. yearRange "2022-2024" → "2021-2024"
  const updated = await prisma.gradeCriteria.updateMany({
    where: { yearRange: "2022-2024" },
    data: { yearRange: "2021-2024" },
  });
  console.log(`yearRange 업데이트: ${updated.count}건 ("2022-2024" → "2021-2024")`);

  // 2. 기본값 upsert (없거나 값이 다르면 생성/수정)
  const defaults = [
    { grade: "S", points: 4,   yearRange: "2021-2024" },
    { grade: "A", points: 3,   yearRange: "2021-2024" },
    { grade: "B", points: 2,   yearRange: "2021-2024" },
    { grade: "C", points: 1,   yearRange: "2021-2024" },
    { grade: "S", points: 4,   yearRange: "2025" },
    { grade: "O", points: 3,   yearRange: "2025" },
    { grade: "E", points: 2.5, yearRange: "2025" },
    { grade: "G", points: 2,   yearRange: "2025" },
    { grade: "N", points: 1.5, yearRange: "2025" },
    { grade: "U", points: 1,   yearRange: "2025" },
  ];

  for (const d of defaults) {
    await prisma.gradeCriteria.upsert({
      where: { grade_yearRange: { grade: d.grade, yearRange: d.yearRange } },
      update: { points: d.points },
      create: d,
    });
  }
  console.log("기본값 upsert 완료 (10개)");

  // 3. 현재 상태 확인
  const all = await prisma.gradeCriteria.findMany({
    orderBy: [{ yearRange: "asc" }, { grade: "asc" }],
  });
  console.log("\n현재 GradeCriteria:");
  for (const c of all) {
    console.log(`  ${c.grade} (${c.yearRange}): ${c.points}점`);
  }
}

main()
  .then(() => { console.log("\n=== 완료 ==="); return prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
