import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

/**
 * 기준 설정 기반 대상자 자동 선정.
 * LevelCriteria를 조회해 포인트/학점 모두 충족한 사용자를 Candidate에 upsert.
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

  // 2. 활성 비-DEPT_HEAD 사용자 조회 (level 포함)
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { not: Role.DEPT_HEAD },
      level: { not: null },
    },
    select: {
      id: true,
      level: true,
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

    const pointCumulative = latestPoint?.cumulative ?? 0;
    const creditCumulative = latestCredit?.cumulative ?? 0;

    // 4. 충족 여부 판단
    const pointMet = pointCumulative >= criteria.requiredPoints;
    const creditMet = creditCumulative >= criteria.requiredCredits;

    if (!pointMet && !creditMet) continue;

    total++;

    // 5. upsert — 기존 없으면 신규 생성, 있으면 pointMet/creditMet만 갱신
    const existing = await prisma.candidate.findUnique({
      where: { userId_year: { userId: user.id, year } },
      select: { id: true },
    });

    if (existing) {
      await prisma.candidate.update({
        where: { id: existing.id },
        data: { pointMet, creditMet },
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
        },
      });
      added++;
    }
  }

  return { added, total };
}
