import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

const MAX_DATA_YEAR = 2025;

function getNextLevel(currentLevel: string | null): string | null {
  if (!currentLevel) return null;
  const order = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const idx = order.indexOf(currentLevel);
  if (idx === -1 || idx >= order.length - 1) return null;
  return order[idx + 1];
}
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
  // 1. LevelCriteria 로드 — 요청 연도 없으면 최신 연도 폴백
  let criteriaList = await prisma.levelCriteria.findMany({ where: { year } });
  if (criteriaList.length === 0) {
    const latest = await prisma.levelCriteria.findFirst({ orderBy: { year: "desc" }, select: { year: true } });
    if (latest) criteriaList = await prisma.levelCriteria.findMany({ where: { year: latest.year } });
  }
  if (criteriaList.length === 0) return { added: 0, total: 0 };
  const criteriaMap = new Map(criteriaList.map((c) => [c.level, c]));

  const currentYear = new Date().getFullYear();

  // 2. GradeCriteria 로드 (등급→포인트 변환)
  const allGradeCriteria = await prisma.gradeCriteria.findMany();
  function gradeToPoints(grade: string, yr: number): number {
    if (!grade) return 2;
    for (const gc of allGradeCriteria) {
      if (gc.grade !== grade) continue;
      const range = gc.yearRange;
      if (range === String(yr)) return gc.points;
      const parts = range.split("-");
      if (parts.length === 2) {
        const from = Number(parts[0]);
        const to = Number(parts[1]);
        if (!isNaN(from) && !isNaN(to) && yr >= from && yr <= to) return gc.points;
      }
    }
    return 2;
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
    const nextLevelKey = getNextLevel(user.level as string);
    const criteria = nextLevelKey ? criteriaMap.get(nextLevelKey as typeof user.level) : null;
    if (!criteria) continue;
    // 특진 기준: 현재 레벨 기준표의 포인트 (일반보다 낮은 별도 기준)
    const currentLevelCriteria = criteriaMap.get(user.level as typeof user.level);

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

    // tenureRange = min(연차, 5) — 최근 N년만 합산
    const tenureRange = Math.min(yearsOfService, 5);

    // 6. 포인트 윈도우 합산 (최근 tenureRange년)
    const gradeMap = new Map(user.performanceGrades.map((pg) => [pg.year, pg.grade]));
    let windowPointSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i;
      if (yr < 2021) break;
      const grade = gradeMap.get(yr) ?? "";
      windowPointSum += gradeToPoints(grade, yr);
    }
    const adjustment = bpMap.get(user.id) ?? 0;

    // 7. 학점 = 2025년 값만 사용 (2025년 신규 도입, 이전 연도 없음)
    const creditMap = new Map(user.credits.map((c) => [c.year, c.score]));
    const windowCreditSum = creditMap.get(MAX_DATA_YEAR) ?? 0;

    // 8. 합산 판정 (포인트 + 학점 + 가감점)
    const finalPoints = windowPointSum + windowCreditSum + adjustment;
    const reqPts = criteria.requiredPoints ?? 0;

    // AQ: 연차 충족
    const tenureMet = minTenure > 0 ? tenure >= minTenure : false;

    // AR: 일반 승진 자격 (연차 충족 + 포인트 충족)
    let qualificationMet = false;
    if (tenureMet) {
      qualificationMet = reqPts <= 0 ? true : finalPoints >= reqPts; // reqPts=0 → L0 (포인트 기준 없음)
    }

    // AS: 특진 자격 (연차 미충족 + 현재 레벨 기준 포인트 충족)
    const specialReqPts = currentLevelCriteria?.requiredPoints ?? 0;
    const isSpecialPromotion = !tenureMet && specialReqPts > 0 && finalPoints >= specialReqPts;

    if (!qualificationMet && !isSpecialPromotion) continue;
    const pointMet = qualificationMet;
    const creditMet = qualificationMet;
    const promotionType = isSpecialPromotion ? "special" : "normal";

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
