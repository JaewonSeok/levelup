import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

/**
 * 기준 설정 기반 대상자 자동 선정.
 * LevelCriteria를 조회해 포인트/학점 모두 충족한 사용자를 Candidate에 upsert.
 * 체류 연수 충족 여부에 따라 promotionType 'normal' | 'special' 구분.
 * @returns { added: number; total: number }
 */
export async function autoSelectCandidates(
  year: number
): Promise<{ added: number; total: number }> {
  // 1. 해당 연도 기준값 로드
  const criteriaList = await prisma.levelCriteria.findMany({ where: { year } });
  if (criteriaList.length === 0) {
    return { added: 0, total: 0 };
  }
  const criteriaMap = new Map(criteriaList.map((c) => [c.level, c]));

  const currentYear = new Date().getFullYear();

  // 2. 활성 비-DEPT_HEAD 사용자 조회 (level, yearsOfService, levelStartDate, hireDate 포함)
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
    },
  });

  let added = 0;
  let total = 0;

  for (const user of users) {
    if (!user.level) continue;
    const criteria = criteriaMap.get(user.level);
    if (!criteria) continue;

    // 3. 최신 포인트/학점 누적 조회
    const [latestPoint, latestCredit] = await Promise.all([
      prisma.point.findFirst({
        where: { userId: user.id },
        orderBy: { year: "desc" },
        select: { cumulative: true },
      }),
      prisma.credit.findFirst({
        where: { userId: user.id },
        orderBy: { year: "desc" },
        select: { cumulative: true },
      }),
    ]);

    // 가감점 합산
    const bpAgg = await prisma.bonusPenalty.aggregate({
      where: { userId: user.id },
      _sum: { points: true },
    });
    const adjustment = bpAgg._sum.points ?? 0;

    const pointCumulative = (latestPoint?.cumulative ?? 0) + adjustment;
    const creditCumulative = latestCredit?.cumulative ?? 0;

    // 4. 포인트/학점 충족 여부 판단
    const pointMet = pointCumulative >= criteria.requiredPoints;
    const creditMet = creditCumulative >= criteria.requiredCredits;

    // 둘 다 충족해야 대상자 (일반 또는 특진)
    if (!pointMet || !creditMet) continue;

    // 5. 체류 연수 계산
    const levelStart = user.levelStartDate ?? user.hireDate;
    const tenure = levelStart
      ? currentYear - new Date(levelStart).getFullYear()
      : (user.yearsOfService ?? 0);
    const tenureMet = tenure >= criteria.minTenure;

    // 6. 승진 유형 결정
    const promotionType = tenureMet ? "normal" : "special";

    total++;

    // 7. upsert — 기존 없으면 신규 생성, 있으면 갱신
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
