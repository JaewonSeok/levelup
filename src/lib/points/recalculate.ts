import { prisma } from "@/lib/prisma";

const MAX_DATA_YEAR = 2025;
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025];

/**
 * 등급별 포인트 기준(GradeCriteria)에 따라 전체 직원의 포인트를 재계산.
 * - tenureRange = min(yearsOfService, minTenure) 범위의 최근 N년 합산
 * - yearRange: 2024년 이하 → "2021-2024", 2025년 → "2025"
 * - 누적(cumulative) 및 isMet 재계산
 */
export async function recalculatePointsFromGrades(
  userIds?: string[]
): Promise<{ updated: number }> {
  const CURRENT_YEAR = new Date().getFullYear();

  // 1. GradeCriteria 전체 로드
  const allGradeCriteria = await prisma.gradeCriteria.findMany();
  if (allGradeCriteria.length === 0) return { updated: 0 };

  function gradeToPoints(grade: string, year: number): number {
    if (!grade) return 2;
    for (const gc of allGradeCriteria) {
      if (gc.grade !== grade) continue;
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

  // 2. LevelCriteria 로드 — 최신 연도 폴백
  let levelCriteriaList = await prisma.levelCriteria.findMany({ where: { year: CURRENT_YEAR } });
  if (levelCriteriaList.length === 0) {
    const latest = await prisma.levelCriteria.findFirst({ orderBy: { year: "desc" }, select: { year: true } });
    if (latest) levelCriteriaList = await prisma.levelCriteria.findMany({ where: { year: latest.year } });
  }
  const criteriaMap = new Map(levelCriteriaList.map((c) => [c.level, c]));

  // 3. 대상 직원 조회
  const users = await prisma.user.findMany({
    where: userIds ? { id: { in: userIds } } : { isActive: true },
    select: {
      id: true,
      level: true,
      yearsOfService: true,
      performanceGrades: {
        where: { year: { in: GRADE_YEARS } },
        select: { year: true, grade: true },
      },
      points: {
        select: { year: true, merit: true, penalty: true },
        orderBy: { year: "asc" },
      },
    },
  });

  let updated = 0;

  for (const user of users) {
    if (user.performanceGrades.length === 0) continue;

    const criteria = user.level ? criteriaMap.get(user.level) : null;

    // tenureRange = min(연차, 5) — 최근 N년만 합산
    const tenureRange = Math.min(user.yearsOfService ?? 0, 5);

    // merit/penalty 합산
    const totalMerit = user.points.reduce((s, p) => s + p.merit, 0);
    const totalPenalty = user.points.reduce((s, p) => s + p.penalty, 0);

    // 연도별 grade map
    const gradeMap = new Map(user.performanceGrades.map((pg) => [pg.year, pg.grade]));

    // 포인트 윈도우 합산 (최근 tenureRange년: MAX_DATA_YEAR부터 역순)
    let windowSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i;
      if (yr < 2021) break;
      const grade = gradeMap.get(yr) ?? "";
      windowSum += gradeToPoints(grade, yr);
    }

    const cumulative = windowSum + totalMerit - totalPenalty;
    const isMet = criteria && criteria.requiredPoints != null && criteria.requiredPoints > 0 ? cumulative >= criteria.requiredPoints : false;

    // 연도별 Point 레코드 upsert (각 연도별 score + 공통 cumulative/isMet)
    for (const pg of user.performanceGrades) {
      const score = gradeToPoints(pg.grade, pg.year);
      const mp = user.points.find((p) => p.year === pg.year) ?? { merit: 0, penalty: 0 };

      await prisma.point.upsert({
        where: { userId_year: { userId: user.id, year: pg.year } },
        create: {
          userId: user.id,
          year: pg.year,
          score,
          merit: mp.merit,
          penalty: mp.penalty,
          cumulative,
          isMet,
        },
        update: {
          score,
          cumulative,
          isMet,
        },
      });
    }

    updated++;
  }

  return { updated };
}
