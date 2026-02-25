import { prisma } from "@/lib/prisma";

/**
 * 등급별 포인트 기준(GradeCriteria)에 따라 전체 직원의 포인트를 재계산.
 * - 직원의 2022~2025년 평가등급을 조회
 * - 각 연도의 등급에 대응하는 기준 포인트를 합산 → 연도별 Point 레코드 upsert
 * - 누적(cumulative) 및 isMet 재계산
 * @param yearFilter 특정 직원 ID 배열 (미지정 시 전체)
 */
export async function recalculatePointsFromGrades(
  userIds?: string[]
): Promise<{ updated: number }> {
  const CURRENT_YEAR = new Date().getFullYear();

  // 1. GradeCriteria 전체 로드
  const allGradeCriteria = await prisma.gradeCriteria.findMany();
  if (allGradeCriteria.length === 0) return { updated: 0 };

  // map: "grade:yearRange" → points
  const gradePointsMap = new Map<string, number>();
  for (const gc of allGradeCriteria) {
    gradePointsMap.set(`${gc.grade}:${gc.yearRange}`, gc.points);
  }

  function getYearRange(year: number): string {
    return year <= 2024 ? "2022-2024" : "2025";
  }

  // 2. 대상 직원 조회
  const users = await prisma.user.findMany({
    where: userIds ? { id: { in: userIds } } : { isActive: true },
    select: {
      id: true,
      level: true,
      performanceGrades: {
        where: { year: { in: [2022, 2023, 2024, 2025] } },
        select: { year: true, grade: true },
      },
      points: {
        select: { year: true, merit: true, penalty: true },
        orderBy: { year: "asc" },
      },
    },
  });

  // 3. LevelCriteria 로드 (현재 연도 기준 isMet 판정)
  const levelCriteriaList = await prisma.levelCriteria.findMany({
    where: { year: CURRENT_YEAR },
  });
  const criteriaMap = new Map(levelCriteriaList.map((c) => [c.level, c]));

  let updated = 0;

  for (const user of users) {
    if (user.performanceGrades.length === 0) continue;

    // 연도별 grade → points 계산
    const gradeYearScores: { year: number; score: number }[] = [];
    for (const pg of user.performanceGrades) {
      const yearRange = getYearRange(pg.year);
      const score = gradePointsMap.get(`${pg.grade}:${yearRange}`);
      if (score !== undefined) {
        gradeYearScores.push({ year: pg.year, score });
      }
    }

    if (gradeYearScores.length === 0) continue;

    // 기존 merit/penalty 맵
    const meritPenaltyMap = new Map(user.points.map((p) => [p.year, { merit: p.merit, penalty: p.penalty }]));

    // 총 merit, penalty (전체 연도 합산)
    const totalMerit = user.points.reduce((s, p) => s + p.merit, 0);
    const totalPenalty = user.points.reduce((s, p) => s + p.penalty, 0);

    // 누적 계산 (연도 오름차순)
    gradeYearScores.sort((a, b) => a.year - b.year);
    const scoreSum = gradeYearScores.reduce((s, ys) => s + ys.score, 0);
    const cumulative = scoreSum + totalMerit - totalPenalty;

    const criteria = user.level ? criteriaMap.get(user.level) : null;
    const isMet = criteria ? cumulative >= criteria.requiredPoints : false;

    // Upsert Point records
    for (const { year, score } of gradeYearScores) {
      const mp = meritPenaltyMap.get(year) ?? { merit: 0, penalty: 0 };
      await prisma.point.upsert({
        where: { userId_year: { userId: user.id, year } },
        create: {
          userId: user.id,
          year,
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

    // Update latest point's cumulative/isMet
    const latestYear = gradeYearScores[gradeYearScores.length - 1].year;
    await prisma.point.updateMany({
      where: { userId: user.id, year: { gte: latestYear } },
      data: { cumulative, isMet },
    });

    updated++;
  }

  return { updated };
}
