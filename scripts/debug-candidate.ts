/**
 * 조현철 대상자 누락 원인 진단 스크립트
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/debug-candidate.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TARGET_NAME = "조현철";
const CURRENT_YEAR = new Date().getFullYear(); // 2026
const GRADE_CALC_BASE = CURRENT_YEAR - 1;      // 2025

function getNextLevel(level: string | null): string | null {
  if (!level) return null;
  const order = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const idx = order.indexOf(level);
  if (idx === -1 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

async function main() {
  console.log("=".repeat(60));
  console.log(`🔍 '${TARGET_NAME}' 대상자 누락 원인 진단`);
  console.log(`   심사연도: ${CURRENT_YEAR} / 학점기준연도: ${GRADE_CALC_BASE}`);
  console.log("=".repeat(60));

  // ── 1. User 레코드 조회 ──────────────────────────────────────
  const users = await prisma.user.findMany({
    where: { name: { contains: TARGET_NAME } },
    select: {
      id: true, name: true, role: true, level: true, isActive: true,
      department: true, team: true, position: true, employmentType: true,
      hireDate: true, yearsOfService: true, levelUpYear: true,
      levelStartDate: true, competencyLevel: true,
    },
  });

  if (users.length === 0) {
    console.log(`\n❌ DB에 '${TARGET_NAME}' 사용자가 없습니다!`);
    console.log("   → users 테이블 자체에 레코드 없음");
    return;
  }

  for (const user of users) {
    console.log(`\n[User] id=${user.id}`);
    console.log(`  name        : ${user.name}`);
    console.log(`  role        : ${user.role}   ← DEPT_HEAD이면 대상자 쿼리에서 제외됨`);
    console.log(`  level       : ${user.level}   ← null 또는 L5이면 제외됨`);
    console.log(`  isActive    : ${user.isActive}   ← false이면 쿼리에서 제외됨`);
    console.log(`  department  : ${user.department}`);
    console.log(`  team        : ${user.team}`);
    console.log(`  yearsOfService: ${user.yearsOfService}`);
    console.log(`  levelUpYear : ${user.levelUpYear}`);
    console.log(`  hireDate    : ${user.hireDate?.toISOString().split("T")[0]}`);
    console.log(`  levelStartDate: ${user.levelStartDate?.toISOString().split("T")[0] ?? "null"}`);

    const uid = user.id;

    // ── 2. Point 레코드 ──────────────────────────────────────
    const points = await prisma.point.findMany({
      where: { userId: uid },
      orderBy: { year: "asc" },
    });
    console.log(`\n[Points] ${points.length}건`);
    if (points.length === 0) {
      console.log("  ⚠️  포인트 레코드 없음 → OR 조건 { points: { some: {} } } 불만족");
    } else {
      for (const p of points) {
        console.log(`  year=${p.year}  score=${p.score}  cumulative=${p.cumulative}  merit=${p.merit}  penalty=${p.penalty}  isMet=${p.isMet}`);
      }
    }

    // ── 3. Credit 레코드 ─────────────────────────────────────
    const credits = await prisma.credit.findMany({
      where: { userId: uid },
      orderBy: { year: "asc" },
    });
    console.log(`\n[Credits] ${credits.length}건`);
    if (credits.length === 0) {
      console.log("  ⚠️  학점 레코드 없음 → OR 조건 { credits: { some: {} } } 불만족");
    } else {
      for (const c of credits) {
        const mark = c.year === GRADE_CALC_BASE ? "← 기준연도" : c.year <= GRADE_CALC_BASE ? "← 폴백대상" : "(미래)";
        console.log(`  year=${c.year}  score=${c.score}  cumulative=${c.cumulative}  isMet=${c.isMet}  ${mark}`);
      }
    }

    // ── 4. PerformanceGrade 레코드 ──────────────────────────
    const grades = await prisma.performanceGrade.findMany({
      where: { userId: uid },
      orderBy: { year: "asc" },
    });
    console.log(`\n[PerformanceGrades] ${grades.length}건`);
    for (const g of grades) console.log(`  year=${g.year}  grade=${g.grade}`);

    // ── 5. Candidate 레코드 ──────────────────────────────────
    const candidates = await prisma.candidate.findMany({
      where: { userId: uid },
      orderBy: { year: "desc" },
    });
    console.log(`\n[Candidates] ${candidates.length}건`);
    if (candidates.length === 0) {
      console.log("  ⚠️  Candidate 레코드 없음 → OR 조건 { candidates: { some: { year } } } 불만족");
    } else {
      for (const c of candidates) {
        const mark = c.source === "excluded" ? "❌ EXCLUDED" : c.year === CURRENT_YEAR ? "← 현재연도" : "";
        console.log(`  year=${c.year}  pointMet=${c.pointMet}  creditMet=${c.creditMet}  source=${c.source}  promotionType=${c.promotionType}  isReviewTarget=${c.isReviewTarget}  ${mark}`);
      }
    }

    // ── 6. BonusPenalty 레코드 ──────────────────────────────
    const bps = await prisma.bonusPenalty.findMany({ where: { userId: uid } });
    const adjustment = bps.reduce((s, b) => s + b.points, 0);
    console.log(`\n[BonusPenalty] ${bps.length}건  adjustment=${adjustment}`);

    // ── 7. LevelCriteria 조회 ────────────────────────────────
    const nextLevel = getNextLevel(user.level);
    console.log(`\n[LevelCriteria] nextLevel=${nextLevel}`);
    if (!nextLevel) {
      console.log("  ❌ 다음 레벨 없음 → candidates 루프에서 return null (표시 안 됨)");
    } else {
      let criteria = await prisma.levelCriteria.findFirst({ where: { level: nextLevel as any, year: CURRENT_YEAR } });
      if (!criteria) {
        const latest = await prisma.levelCriteria.findFirst({ where: { level: nextLevel as any }, orderBy: { year: "desc" } });
        criteria = latest;
        console.log(`  ⚠️  year=${CURRENT_YEAR} 기준 없음, 폴백: year=${criteria?.year ?? "없음"}`);
      }
      if (!criteria) {
        console.log(`  ❌ ${nextLevel} 기준값 없음 → criteria=undefined → reqPts=0, reqCredits=0`);
      } else {
        console.log(`  year=${criteria.year}  requiredPoints=${criteria.requiredPoints}  requiredCredits=${criteria.requiredCredits}  minTenure=${criteria.minTenure}`);
      }

      // ── 8. GradeCriteria ────────────────────────────────────
      const gradeCriteriaAll = await prisma.gradeCriteria.findMany();
      console.log(`\n[GradeCriteria] ${gradeCriteriaAll.length}건 설정됨`);

      // ── 9. 판정 시뮬레이션 ──────────────────────────────────
      console.log("\n[판정 시뮬레이션]");

      const reqPts = criteria?.requiredPoints ?? 0;
      const reqCredits = criteria?.requiredCredits ?? 0;
      const minTenure = criteria?.minTenure ?? 0;

      // 포인트 계산
      let pointCumulative: number;
      if (gradeCriteriaAll.length > 0) {
        const gradeMap = new Map(grades.map((g) => [g.year, g.grade]));
        const yearsOfService = user.yearsOfService ?? 0;
        const tenureRange = Math.min(yearsOfService, 5);

        const gradeToPoints = (grade: string, yr: number): number => {
          if (!grade || grade === "-" || grade.trim() === "") return 2;
          const g = grade.trim().toUpperCase();
          for (const gc of gradeCriteriaAll) {
            if (gc.grade !== g) continue;
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
        };

        let windowSum = 0;
        for (let i = 0; i < tenureRange; i++) {
          const yr = GRADE_CALC_BASE - i;
          if (yr < 2021) break;
          const grade = gradeMap.get(yr) ?? "";
          const pts = gradeToPoints(grade, yr);
          console.log(`  grade window  year=${yr}  grade='${grade || "(없음)"}'  → ${pts}점`);
          windowSum += pts;
        }
        const totalMerit = points.reduce((s, p) => s + p.merit, 0);
        const totalPenalty = points.reduce((s, p) => s + p.penalty, 0);
        pointCumulative = windowSum + totalMerit - totalPenalty + adjustment;
        console.log(`  windowSum=${windowSum}  merit=${totalMerit}  penalty=${totalPenalty}  adjustment=${adjustment}`);
      } else {
        const latestPoint = points[points.length - 1];
        pointCumulative = (latestPoint?.cumulative ?? 0) + adjustment;
        console.log(`  GradeCriteria 미설정 → DB cumulative 사용: ${latestPoint?.cumulative ?? 0} + ${adjustment}`);
      }

      // 학점 계산 (폴백 로직 적용)
      const creditRecord = credits
        .filter((c) => c.year <= GRADE_CALC_BASE)
        .sort((a, b) => b.year - a.year)[0] ?? null;
      const creditCumulative = creditRecord?.score ?? 0;

      // 체류 연수
      const tenure = user.levelStartDate
        ? CURRENT_YEAR - new Date(user.levelStartDate).getFullYear()
        : user.yearsOfService != null
          ? user.yearsOfService
          : user.hireDate
            ? CURRENT_YEAR - new Date(user.hireDate).getFullYear()
            : 0;

      const pointMet = reqPts <= 0 ? true : pointCumulative >= reqPts;
      const creditMet = reqCredits <= 0 ? true : creditCumulative >= reqCredits;
      const tenureMet = minTenure > 0 ? tenure >= minTenure : true;
      const isSpecialPromotion = !!criteria && pointMet && creditMet && !tenureMet;
      const promotionType = isSpecialPromotion ? "special" : "normal";
      const isQualified = pointMet && creditMet;

      // OR 조건 충족 여부
      const hasPoints = points.length > 0;
      const hasCredits = credits.length > 0;
      const hasCandidateForYear = candidates.some((c) => c.year === CURRENT_YEAR);
      const passesOrCondition = hasPoints || hasCredits || hasCandidateForYear;

      // source=excluded 체크
      const currentYearCandidate = candidates.find((c) => c.year === CURRENT_YEAR);
      const isExcluded = currentYearCandidate?.source === "excluded";

      console.log("\n  ──────── 트레이싱 결과 ────────");
      console.log(`  isActive     : ${user.isActive}   ${!user.isActive ? "❌ 비활성 → 쿼리 제외" : "✅"}`);
      console.log(`  role         : ${user.role}   ${user.role === "DEPT_HEAD" ? "❌ 본부장 → 쿼리 제외" : "✅"}`);
      console.log(`  nextLevel    : ${nextLevel ?? "없음"}   ${!nextLevel ? "❌ 다음 레벨 없음 → return null" : "✅"}`);
      console.log(`  OR 조건      : hasPoints=${hasPoints} | hasCredits=${hasCredits} | hasCandidate=${hasCandidateForYear}  → ${passesOrCondition ? "✅ 통과" : "❌ 실패 (쿼리 결과에서 제외)"}`);
      console.log(`  isExcluded   : ${isExcluded}   ${isExcluded ? "❌ source=excluded → return null" : "✅"}`);
      console.log(`  pointCumulative : ${pointCumulative}   (기준: ${reqPts})`);
      console.log(`  creditCumulative: ${creditCumulative}   (기준: ${reqCredits}, 조회연도: ${creditRecord?.year ?? "없음"})`);
      console.log(`  tenure          : ${tenure}년   (minTenure: ${minTenure})`);
      console.log(`  pointMet     : ${pointMet}   ${!pointMet ? "❌" : "✅"}`);
      console.log(`  creditMet    : ${creditMet}   ${!creditMet ? "❌" : "✅"}`);
      console.log(`  tenureMet    : ${tenureMet}   (promotionType=${promotionType})`);
      console.log(`  isQualified  : ${isQualified}   ${!isQualified ? "❌ isQualified=false → filteredEmployees에서 제외" : "✅"}`);
      console.log(`\n  📋 최종 판정: ${!user.isActive ? "비활성(쿼리제외)" : user.role === "DEPT_HEAD" ? "본부장(쿼리제외)" : !nextLevel ? "L5(return null)" : !passesOrCondition ? "데이터없음(쿼리제외)" : isExcluded ? "excluded(return null)" : !isQualified ? "미충족(필터제외)" : "✅ 표시되어야 함"}`);
    }
  }

  // ── 10. 비교: 정상 대상자 1명 ─────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("📊 비교: 정상 포함된 대상자 샘플");
  const normalCandidates = await prisma.candidate.findMany({
    where: { year: CURRENT_YEAR, source: { not: "excluded" }, pointMet: true, creditMet: true },
    include: { user: { select: { name: true, level: true, role: true, isActive: true, yearsOfService: true } } },
    take: 3,
  });
  for (const c of normalCandidates) {
    console.log(`  ${c.user.name} (${c.user.level}) pointMet=${c.pointMet} creditMet=${c.creditMet} source=${c.source}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
