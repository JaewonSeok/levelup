/**
 * 이수빈·하승준 포인트 계산 트레이싱 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/debug-points.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CURRENT_YEAR = 2026;
const MAX_DATA_YEAR = 2025;
const TARGETS = ["이수빈", "하승준"];
const SAMPLE_OK = "신진수"; // 정상 비교 대상

function gradeToPoints(grade: string, year: number, gradeCriteria: { grade: string; yearRange: string; points: number }[]): number {
  if (!grade || grade === "-" || grade.trim() === "" || grade.trim().toUpperCase() === "NI") return 2;
  const g = grade.trim().toUpperCase();
  for (const gc of gradeCriteria) {
    if (gc.grade !== g) continue;
    const range = gc.yearRange;
    if (range === String(year)) return gc.points;
    const parts = range.split("-");
    if (parts.length === 2) {
      const from = Number(parts[0]);
      const to = Number(parts[1]);
      if (!isNaN(from) && !isNaN(to) && year >= from && year <= to) return gc.points;
    }
  }
  return 2;
}

async function traceUser(name: string, gradeCriteria: { grade: string; yearRange: string; points: number }[], levelCriteriaMap: Map<string, { minTenure: number | null }>) {
  console.log("\n" + "=".repeat(60));
  console.log(`=== ${name} 포인트 트레이싱 ===`);
  console.log("=".repeat(60));

  const users = await prisma.user.findMany({
    where: { name: { contains: name } },
    select: {
      id: true, name: true, level: true, isActive: true,
      department: true, team: true, yearsOfService: true,
      hireDate: true, levelStartDate: true, levelUpYear: true,
    },
  });

  if (users.length === 0) { console.log("  ❌ DB에 없음"); return; }

  for (const user of users) {
    console.log(`\n[User] ${user.name} (${user.level}) dept=${user.department} team=${user.team}`);
    console.log(`  isActive=${user.isActive}  yearsOfService=${user.yearsOfService}`);
    console.log(`  hireDate=${user.hireDate?.toISOString().split("T")[0] ?? "null"}`);
    console.log(`  levelStartDate=${user.levelStartDate?.toISOString().split("T")[0] ?? "null"}`);

    // PerformanceGrade
    const grades = await prisma.performanceGrade.findMany({
      where: { userId: user.id },
      orderBy: { year: "asc" },
    });
    console.log(`\n[PerformanceGrades] ${grades.length}건`);
    const gradeMap: Record<number, string> = {};
    for (const g of grades) {
      gradeMap[g.year] = g.grade;
      console.log(`  year=${g.year}  grade=${g.grade}  → ${gradeToPoints(g.grade, g.year, gradeCriteria)}점`);
    }

    // Points
    const points = await prisma.point.findMany({
      where: { userId: user.id },
      orderBy: { year: "asc" },
    });
    console.log(`\n[Points] ${points.length}건`);
    const totalMerit = points.reduce((s, p) => s + p.merit, 0);
    const totalPenalty = points.reduce((s, p) => s + p.penalty, 0);
    for (const p of points) {
      console.log(`  year=${p.year}  score=${p.score}  merit=${p.merit}  penalty=${p.penalty}  cumulative=${p.cumulative}  isMet=${p.isMet}`);
    }
    console.log(`  totalMerit=${totalMerit}  totalPenalty=${totalPenalty}`);

    // BonusPenalty
    const bps = await prisma.bonusPenalty.findMany({ where: { userId: user.id } });
    const adjustment = bps.reduce((s, b) => s + b.points, 0);
    console.log(`\n[BonusPenalty] ${bps.length}건  adjustment=${adjustment}`);
    for (const bp of bps) {
      console.log(`  type=${bp.type}  category=${bp.category}  points=${bp.points}  note=${bp.note}`);
    }

    // 포인트 윈도우 계산 시뮬레이션
    const yearsOfService = user.yearsOfService ?? 0;
    // 다음 레벨 minTenure 적용 (auto-select/calculatePointSum과 동일 로직)
    const nextLvl = user.level === "L0" ? "L1" : user.level === "L1" ? "L2" : user.level === "L2" ? "L3" : user.level === "L3" ? "L4" : user.level === "L4" ? "L5" : null;
    const lc = nextLvl ? levelCriteriaMap.get(nextLvl) : null;
    const critMinTenure = lc?.minTenure ?? 0;
    const tenureRange = Math.min(yearsOfService, critMinTenure > 0 ? critMinTenure : 5);
    console.log(`\n[포인트 윈도우 시뮬레이션]`);
    console.log(`  nextLevel=${nextLvl}  critMinTenure=${critMinTenure}`);
    console.log(`  tenureRange = min(yearsOfService=${yearsOfService}, minTenure=${critMinTenure > 0 ? critMinTenure : 5}) = ${tenureRange}`);
    let windowSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i; // 2025, 2024, ...
      if (yr < 2021) break;
      const grade = gradeMap[yr] ?? "";
      const pts = gradeToPoints(grade, yr, gradeCriteria);
      console.log(`  i=${i}  year=${yr}  grade='${grade || "(없음)"}'  → ${pts}점`);
      windowSum += pts;
    }
    console.log(`  windowSum=${windowSum}`);

    // calculateFinalPoints (API 로직 동일)
    const finalPoints = windowSum + totalMerit - totalPenalty + adjustment;
    console.log(`\n[최종 계산]`);
    console.log(`  windowSum=${windowSum} + merit=${totalMerit} - penalty=${totalPenalty} + adjustment=${adjustment}`);
    console.log(`  = ${finalPoints}`);

    // Credits
    const credits = await prisma.credit.findMany({ where: { userId: user.id }, orderBy: { year: "asc" } });
    console.log(`\n[Credits] ${credits.length}건`);
    for (const c of credits) console.log(`  year=${c.year}  score=${c.score}  cumulative=${c.cumulative}`);
  }
}

async function main() {
  // GradeCriteria 로드
  const gradeCriteria = await prisma.gradeCriteria.findMany();
  console.log(`\n[GradeCriteria] ${gradeCriteria.length}건`);
  for (const gc of gradeCriteria) {
    console.log(`  grade=${gc.grade}  yearRange=${gc.yearRange}  points=${gc.points}`);
  }

  // LevelCriteria 로드
  const levelCriteriaRaw = await prisma.levelCriteria.findMany({ orderBy: [{ year: "desc" }, { level: "asc" }] });
  const lcMap = new Map<string, { minTenure: number | null }>();
  for (const c of levelCriteriaRaw) {
    if (!lcMap.has(c.level as string)) lcMap.set(c.level as string, { minTenure: c.minTenure });
  }
  console.log(`\n[LevelCriteria minTenure]`);
  Array.from(lcMap.entries()).forEach(([lv, v]) => console.log(`  level=${lv}  minTenure=${v.minTenure}`));

  for (const name of TARGETS) {
    await traceUser(name, gradeCriteria, lcMap);
  }

  console.log("\n" + "=".repeat(60));
  console.log("=== 비교: 정상 대상자 샘플 ===");
  await traceUser(SAMPLE_OK, gradeCriteria, lcMap);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
