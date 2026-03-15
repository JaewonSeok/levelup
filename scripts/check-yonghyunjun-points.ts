import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "@prisma/client";
import { calculateFinalPoints } from "../src/lib/pointCalculation";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  const user = await prisma.user.findFirst({
    where: { name: "용현준", department: "연구개발본부", team: "웹개발2팀" },
    select: { id: true, name: true, level: true, yearsOfService: true, department: true, team: true },
  });
  if (!user) { console.log("용현준 없음"); return; }

  console.log(`직원: ${user.name} (${user.level}, ${user.department}/${user.team}) 연차=${user.yearsOfService}`);

  const grades = await prisma.performanceGrade.findMany({ where: { userId: user.id }, select: { year: true, grade: true } });
  const bps    = await prisma.bonusPenalty.findMany({ where: { userId: user.id }, select: { points: true } });
  const points = await prisma.point.findMany({ where: { userId: user.id }, select: { merit: true, penalty: true } });
  const criteria = await prisma.gradeCriteria.findMany();

  const gradeMap: Record<number, string> = {};
  for (const g of grades) gradeMap[g.year] = g.grade;
  const totalMerit   = points.reduce((s, p) => s + p.merit, 0);
  const totalPenalty = points.reduce((s, p) => s + p.penalty, 0);
  const adjustment   = bps.reduce((s, b) => s + b.points, 0);

  console.log(`\n등급: ${JSON.stringify(gradeMap)}`);
  console.log(`merit=${totalMerit} penalty=${totalPenalty} adjustment=${adjustment}`);

  // 구 로직 (minTenure=2 전달)
  const lcL1 = await prisma.levelCriteria.findFirst({ where: { level: "L1" }, select: { minTenure: true, requiredPoints: true } });
  const oldMinTenure = lcL1?.minTenure ?? 0;
  const oldResult = calculateFinalPoints(gradeMap, criteria, 2026, user.yearsOfService ?? 0, totalMerit, totalPenalty, adjustment, oldMinTenure);

  // 신 로직 (minTenure 미전달, 기본값 5)
  const newResult = calculateFinalPoints(gradeMap, criteria, 2026, user.yearsOfService ?? 0, totalMerit, totalPenalty, adjustment);

  console.log(`\nL1 LevelCriteria: minTenure=${lcL1?.minTenure}, requiredPoints=${lcL1?.requiredPoints}`);
  console.log(`\n구 로직 (minTenure=${oldMinTenure} 전달): ${oldResult}점`);
  console.log(`신 로직 (minTenure 기본값 5):       ${newResult}점`);
  console.log(`\n정답(8.5)과 일치: ${newResult === 8.5 ? "✅" : "❌ 불일치"}`);
}

main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
