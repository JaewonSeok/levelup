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

    // 8. 포인트와 학점 별도 판정 (일반/특진 동일 기준)
    const gradePoints = windowPointSum + adjustment; // 포인트 = 등급 합산 + 가감점
    const creditScore = windowCreditSum;             // 학점 = 2025년 값
    const reqPts = criteria.requiredPoints ?? 0;
    const reqCredits = criteria.requiredCredits ?? 0;

    // 연차 충족 여부
    const tenureMet = minTenure > 0 ? tenure >= minTenure : false;

    // 포인트/학점 충족 (일반·특진 동일 기준)
    const pointMet = reqPts <= 0 ? true : gradePoints >= reqPts;
    const creditMet = reqCredits <= 0 ? true : creditScore >= reqCredits;

    // 포인트+학점 모두 충족해야 대상자; 체류연수로 일반/특진 구분
    if (!pointMet || !creditMet) continue;
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
