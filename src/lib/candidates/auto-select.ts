import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const MAX_DATA_YEAR = 2025;
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025];

/**
 * 기준 설정 기반 대상자 자동 선정.
 * - tenureRange = min(yearsOfService, minTenure) 범위의 최근 N년 포인트/학점 합산
 * - 포인트와 학점은 완전히 별개로 판정
 * - 둘 다 충족해야 대상자 선정 (일반 또는 특진)
 */
export async function autoSelectCandidates(
  year: number
): Promise<{ added: number; total: number }> {
  // 1. LevelCriteria 로드
  const criteriaList = await prisma.levelCriteria.findMany({ where: { year } });
  if (criteriaList.length === 0) return { added: 0, total: 0 };
  const criteriaMap = new Map(criteriaList.map((c) => [c.level, c]));

  const currentYear = new Date().getFullYear();

  // 2. GradeCriteria 로드 (등급→포인트 변환)
  const allGradeCriteria = await prisma.gradeCriteria.findMany();
  const gradePointsMap = new Map<string, number>();
  for (const gc of allGradeCriteria) {
    gradePointsMap.set(`${gc.grade}:${gc.yearRange}`, gc.points);
  }

  function getYearRange(yr: number): string {
    return yr <= 2024 ? "2021-2024" : "2025";
  }

  function gradeToPoints(grade: string, yr: number): number {
    if (!grade) return 0;
    return gradePointsMap.get(`${grade}:${getYearRange(yr)}`) ?? 0;
  }

  // 3. 활성 비-DEPT_HEAD 직원 조회 (grades + credits 포함)
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: Role.DEPT_HEAD },
      level: { not: null },
    },
    select: {
      id: true,
      level: true,
      yearsOfService: true,
      levelStartDate: true,
      hireDate: true,
      performanceGrades: {
        where: { year: { in: GRADE_YEARS } },
        select: { year: true, grade: true },
      },
      credits: {
        where: { year: { lte: MAX_DATA_YEAR } },
        select: { year: true, score: true },
      },
    },
  });

  // 4. BonusPenalty 전체 합산 (한 번에 조회)
  const bpRecords = await prisma.bonusPenalty.findMany({
    select: { userId: true, points: true },
  });
  const bpMap = new Map<string, number>();
  for (const bp of bpRecords) {
    bpMap.set(bp.userId, (bpMap.get(bp.userId) ?? 0) + bp.points);
  }

  let added = 0;
  let total = 0;

  for (const user of users) {
    if (!user.level) continue;
    const criteria = criteriaMap.get(user.level);
    if (!criteria) continue;

    // 5. 연차 계산 (yearsOfService 우선 — 날짜 빼기는 월 미반영으로 부정확)
    const tenure = user.levelStartDate
      ? currentYear - new Date(user.levelStartDate).getFullYear()
      : user.yearsOfService != null
        ? user.yearsOfService
        : user.hireDate
          ? currentYear - new Date(user.hireDate).getFullYear()
          : 0;

    const minTenure = criteria.minTenure ?? 0;
    const yearsOfService = user.yearsOfService ?? tenure;

    // tenureRange = min(연차, 기준연한)
    const tenureRange =
      minTenure > 0 && yearsOfService > 0
        ? Math.min(yearsOfService, minTenure)
        : yearsOfService > 0
          ? yearsOfService
          : 0;

    // 6. 포인트 윈도우 합산 (최근 tenureRange년, 포인트만)
    const gradeMap = new Map(user.performanceGrades.map((pg) => [pg.year, pg.grade]));
    let windowPointSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i;
      if (yr < 2021) break;
      const grade = gradeMap.get(yr) ?? "";
      windowPointSum += gradeToPoints(grade, yr);
    }
    const adjustment = bpMap.get(user.id) ?? 0;
    const totalPoints = windowPointSum + adjustment;

    // 7. 학점 윈도우 합산 (최근 tenureRange년, 학점만 — 포인트와 완전히 별개)
    const creditMap = new Map(user.credits.map((c) => [c.year, c.score]));
    let windowCreditSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i;
      if (yr < 2021) break;
      windowCreditSum += creditMap.get(yr) ?? 0;
    }

    // 8. 각각 별도 판정
    const pointMet =
      criteria.requiredPoints > 0 ? totalPoints >= criteria.requiredPoints : true;
    const creditMet =
      (criteria.requiredCredits ?? 0) > 0
        ? windowCreditSum >= criteria.requiredCredits
        : true;

    // 포인트 AND 학점 둘 다 충족해야 대상자
    if (!pointMet || !creditMet) continue;

    // 연차 충족 여부 → 승진 유형
    const tenureMet = tenure >= minTenure;
    const promotionType = tenureMet ? "normal" : "special";

    total++;

    // 9. Candidate upsert
    const existing = await prisma.candidate.findUnique({
      where: { userId_year: { userId: user.id, year } },
      select: { id: true },
    });

    if (existing) {
      await prisma.candidate.update({
        where: { id: existing.id },
        data: { pointMet, creditMet, promotionType },
      });
    } else {
      await prisma.candidate.create({
        data: {
          userId: user.id,
          year,
          pointMet,
          creditMet,
          isReviewTarget: false,
          source: "auto",
          promotionType,
        },
      });
      added++;
    }
  }

  return { added, total };
}
