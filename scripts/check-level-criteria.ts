import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.levelCriteria.findMany({ orderBy: [{ year: "asc" }, { level: "asc" }] });
  console.log("[LevelCriteria]");
  for (const r of rows) {
    console.log(`  level=${r.level}  year=${r.year}  requiredPoints=${r.requiredPoints}  requiredCredits=${r.requiredCredits}  minTenure=${r.minTenure}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
