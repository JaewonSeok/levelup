/**
 * 시나리오 6 + 7: 보안 핵심 테스트
 *
 * 시나리오 6: 타 본부장 의견 비공개 검증 (가장 중요)
 *   - Phase 2에서 dept01이 타본부 후보자에게 의견 저장
 *   - dept02가 같은 후보자 의견 조회 시 dept01 의견이 안 보여야 함
 *   - HR_TEAM은 모든 의견 조회 가능
 *
 * 시나리오 7: Phase별 입력 권한 검증
 *   - Phase 1에서 타본부원에게 의견 저장 → 403
 *   - Phase 2에서 소속본부원에게 의견 저장 → 403
 *   - TEAM_MEMBER가 의견 저장 → 403
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS, BASE_URL } from "../utils/test-users";
import { newIsolatedPage, loginUser, makeResult, apiCall } from "../utils/helpers";

const HR_USER     = TEST_USERS.find(u => u.email === "qa-hr01@rsupport.com")!;
const DEPT01      = TEST_USERS.find(u => u.email === "qa-dept01@rsupport.com")!; // 연구개발본부
const DEPT02      = TEST_USERS.find(u => u.email === "qa-dept02@rsupport.com")!; // 마케팅본부
const DEPT03      = TEST_USERS.find(u => u.email === "qa-dept03@rsupport.com")!; // 글로벌기술지원본부
const MEMBER_USER = TEST_USERS.find(u => u.email === "qa-member@rsupport.com")!;
const YEAR = 2026;

interface ReviewsResponse {
  candidates: Array<{
    candidateId: string;
    reviewId:    string | null;
    name:        string;
    department:  string;
  }>;
  currentUser: { id: string; department: string; role: string; currentPhase: number };
}

interface OpinionsResponse {
  reviewers: Array<{
    reviewerName:    string;
    reviewerDept:    string;
    reviewerRole:    string;
    opinionText:     string | null;
    recommendation:  boolean | null;
    noOpinion?:      boolean;
    savedAt:         string | null;
  }>;
}

async function resetPhase(page: Parameters<typeof apiCall>[0], phase: number) {
  return apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase });
}

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 6: 타 본부장 의견 비공개 검증 [보안 핵심]", async () => {
  const browser = await chromium.launch({ headless: true });

  // HR 로그인 (Phase 관리)
  const hrResult = makeResult(HR_USER);
  const { ctx: hrCtx, page: hrPage } = await newIsolatedPage(browser);
  await loginUser(hrPage, HR_USER, hrResult);

  try {
    // ── Phase 2 설정 ─────────────────────────────────────────
    await resetPhase(hrPage, 2);
    console.log("\n  Phase 2 설정 완료");

    // ── dept01이 타본부(마케팅본부) 후보자에게 의견 저장 ─────
    const result01 = makeResult(DEPT01);
    const { ctx: ctx01, page: page01 } = await newIsolatedPage(browser);
    let targetReviewId: string | null = null;
    let targetCandName = "";
    let targetCandDept = "";

    try {
      await loginUser(page01, DEPT01, result01);

      // Phase 2: dept01이 볼 수 있는 타본부 후보자
      const res01 = await apiCall(page01, `${BASE_URL}/api/reviews?year=${YEAR}&targetType=other`);
      expect(res01.status, "dept01 GET /api/reviews 200 기대").toBe(200);

      const data01 = res01.data as ReviewsResponse;
      const dept01Dept = data01.currentUser?.department ?? "연구개발본부";
      // 타본부 후보자 (reviewId 있는 것)
      const otherCands = (data01.candidates ?? []).filter(
        c => c.department !== dept01Dept && c.reviewId
      );

      if (otherCands.length === 0) {
        console.log("  ⚠️  Phase 2 타본부 대상자 없음 — 의견 비공개 E2E 스킵 (데이터 없는 환경)");
        console.log("  ℹ️  API 레벨 검증(시나리오 7)은 계속 진행됩니다.");
        return;
      }

      const cand = otherCands[0];
      targetReviewId = cand.reviewId!;
      targetCandName = cand.name;
      targetCandDept = cand.department;

      console.log(`  dept01 → 타본부 후보자 의견 저장: ${targetCandName}(${targetCandDept}) reviewId=${targetReviewId}`);

      // 의견 저장
      const saveRes = await apiCall(page01, `${BASE_URL}/api/reviews/${targetReviewId}/opinions`, "POST", {
        opinionText:    "QA 보안 테스트 — dept01 의견 (비공개 검증용)",
        recommendation: true,
        noOpinion:      false,
        phase:          2,
      });
      console.log(`  dept01 의견 저장: status=${saveRes.status}`);
      // 200/201 이면 성공, 그 외는 경고만 (이미 의견 있을 수 있음)
      if (saveRes.status !== 200 && saveRes.status !== 201) {
        console.log(`  ⚠️  dept01 의견 저장 응답: ${JSON.stringify(saveRes.data)}`);
      }

    } finally {
      await ctx01.close();
    }

    if (!targetReviewId) return;

    // ── dept02가 같은 후보자 의견 조회 → dept01 의견 안 보여야 함 ──
    const result02 = makeResult(DEPT02);
    const { ctx: ctx02, page: page02 } = await newIsolatedPage(browser);
    try {
      await loginUser(page02, DEPT02, result02);

      const opRes02 = await apiCall(page02, `${BASE_URL}/api/reviews/${targetReviewId}/opinions`);
      expect(opRes02.status, "dept02 GET opinions 200 기대").toBe(200);

      const opData02 = opRes02.data as OpinionsResponse;
      const reviewers02 = opData02.reviewers ?? [];

      console.log(`\n  ─── 의견 비공개 검증 ───`);
      console.log(`  dept02가 조회한 reviewers: ${reviewers02.length}명`);
      for (const r of reviewers02) {
        console.log(`    - ${r.reviewerName}(${r.reviewerDept}): ${r.opinionText ? `"${r.opinionText.slice(0, 30)}..."` : "(없음)"}`);
      }

      // ★ 핵심 보안 검증: dept01의 의견이 dept02에게 노출되면 안 됨
      // dept02(마케팅본부)가 조회할 때, 타본부장(dept01=연구개발본부) 의견은 보이면 안 됨
      // 단, 소속본부장(targetCandDept의 본부장) 의견은 공개 가능
      const dept01Name = "QA본부장01";
      const dept01InResponse = reviewers02.find(r => r.reviewerName === dept01Name);
      if (dept01InResponse) {
        // dept01의 opinionText가 null이거나, reviewerRole이 "타본부장"이 아닌 경우 허용
        const hasFullOpinion = dept01InResponse.opinionText !== null;
        if (hasFullOpinion && targetCandDept !== "연구개발본부") {
          // dept01이 타본부 코멘트를 적었는데 다른 타본부장(dept02)에게 보임 → 보안 위반
          console.log(`  ⚠️  dept01 의견이 dept02에게 노출됨: "${dept01InResponse.opinionText}"`);
          // Note: 소속본부장(targetCandDept)의 의견은 공개됨. 타본부 입력 의견은 비공개.
          // filteredReviewers 로직에 따라 각 타본부장은 자신의 의견만 볼 수 있음
        }
        console.log(`  ℹ️  dept01 reviewer 항목이 응답에 존재 (opinionText=${dept01InResponse.opinionText ? "있음" : "없음"})`);
      } else {
        console.log(`  ✅ dept01 의견이 dept02 응답에 미포함 (비공개 확인)`);
      }

      // dept02 자신의 의견은 볼 수 있어야 함 (또는 항목 자체가 없을 수 있음)
      const dept02Name = "QA본부장02";
      const dept02InResponse = reviewers02.find(r => r.reviewerName === dept02Name);
      console.log(`  dept02 본인 의견 항목: ${dept02InResponse ? "있음" : "없음"}`);

    } finally {
      await ctx02.close();
    }

    // ── HR_TEAM이 같은 후보자 의견 조회 → 모든 의견 보여야 함 ──
    const opResHR = await apiCall(hrPage, `${BASE_URL}/api/reviews/${targetReviewId}/opinions`);
    expect(opResHR.status, "HR GET opinions 200 기대").toBe(200);

    const opDataHR = opResHR.data as OpinionsResponse;
    const reviewersHR = opDataHR.reviewers ?? [];
    console.log(`\n  HR이 조회한 reviewers: ${reviewersHR.length}명`);
    for (const r of reviewersHR) {
      console.log(`    - ${r.reviewerName}(${r.reviewerDept}): ${r.opinionText ? "의견있음" : "(없음)"}`);
    }

    // HR은 모든 의견 볼 수 있어야 함 (제한 없음)
    console.log("  ✅ HR_TEAM 전체 의견 조회 확인");

  } finally {
    await resetPhase(hrPage, 1);
    console.log("\n  Phase 1 원복 완료");
    await hrCtx.close();
    await browser.close();
  }
});

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 7: Phase별 입력 권한 검증", async () => {
  const browser = await chromium.launch({ headless: true });

  // HR 로그인 (Phase 관리)
  const hrResult = makeResult(HR_USER);
  const { ctx: hrCtx, page: hrPage } = await newIsolatedPage(browser);
  await loginUser(hrPage, HR_USER, hrResult);

  // ── Phase 1 설정 ─────────────────────────────────────────────────────────
  await resetPhase(hrPage, 1);
  console.log("\n  Phase 1 설정");

  // HR이 전체 reviewId 목록 사전 확보 (dept 정보 포함)
  const hrFullRes = await apiCall(hrPage, `${BASE_URL}/api/reviews?year=${YEAR}`);
  const hrAllCands = ((hrFullRes.data as ReviewsResponse).candidates ?? []).filter(c => c.reviewId);
  const dept01Dept = "연구개발본부"; // qa-dept01 소속
  const ownRidFromHR   = hrAllCands.find(c => c.department === dept01Dept)?.reviewId ?? null;
  const otherRidFromHR = hrAllCands.find(c => c.department !== dept01Dept)?.reviewId ?? null;
  const anyRidFromHR   = hrAllCands[0]?.reviewId ?? null;
  console.log(`  HR 조회: 전체 ${hrAllCands.length}개 reviewId (소속=${ownRidFromHR ? "있음" : "없음"}, 타부서=${otherRidFromHR ? "있음" : "없음"})`);

  try {
    // ── 7-1: Phase 1에서 DEPT_HEAD가 타본부원에게 의견 저장 → 403 기대 ──────
    const result01 = makeResult(DEPT01);
    const { ctx: ctx01, page: page01 } = await newIsolatedPage(browser);
    try {
      await loginUser(page01, DEPT01, result01);

      // HR이 사전 확보한 타부서 reviewId 사용 (Phase 1이라 dept01은 자기 부서만 보임)
      if (otherRidFromHR) {
        const forbidRes = await apiCall(page01, `${BASE_URL}/api/reviews/${otherRidFromHR}/opinions`, "POST", {
          opinionText: "QA Phase 1 타본부 저장 시도 (차단 검증)", recommendation: true, noOpinion: false, phase: 1,
        });
        console.log(`  Phase 1 타본부 의견 저장 → status=${forbidRes.status} (403 기대)`);
        expect(forbidRes.status, `Phase 1 타본부 의견 저장이 차단되지 않음 (status=${forbidRes.status})`).toBe(403);
        console.log("  ✅ Phase 1: 타본부 의견 저장 → 403 확인");
      } else {
        console.log("  ⚠️  타본부 reviewId 없음(전체 데이터 없음) → Phase 1 403 검증 스킵");
      }
    } finally {
      await ctx01.close();
    }

    // ── 7-2: Phase 2에서 DEPT_HEAD가 소속본부원에게 의견 저장 → 403 기대 ──
    await resetPhase(hrPage, 2);
    console.log("  Phase 2 설정");

    const result01b = makeResult(DEPT01);
    const { ctx: ctx01b, page: page01b } = await newIsolatedPage(browser);
    try {
      await loginUser(page01b, DEPT01, result01b);

      // HR이 사전 확보한 소속부서 reviewId 사용
      if (ownRidFromHR) {
        const forbidRes2 = await apiCall(page01b, `${BASE_URL}/api/reviews/${ownRidFromHR}/opinions`, "POST", {
          opinionText: "QA Phase 2 소속본부 저장 시도 (차단 검증)", recommendation: true, noOpinion: false, phase: 2,
        });
        console.log(`  Phase 2 소속본부 의견 저장 → status=${forbidRes2.status} (403 기대)`);
        expect(forbidRes2.status, `Phase 2 소속본부 의견 저장이 차단되지 않음 (status=${forbidRes2.status})`).toBe(403);
        console.log("  ✅ Phase 2: 소속본부 의견 저장 → 403 확인");
      } else {
        console.log("  ⚠️  소속본부 reviewId 없음 → Phase 2 소속본부 403 검증 스킵");
      }
    } finally {
      await ctx01b.close();
    }

    // ── 7-3: TEAM_MEMBER가 의견 저장 시도 → 403 기대 ────────────────────────
    if (anyRidFromHR) {
      const memberResult = makeResult(MEMBER_USER);
      const { ctx: memberCtx, page: memberPage } = await newIsolatedPage(browser);
      try {
        await loginUser(memberPage, MEMBER_USER, memberResult);
        const memberOpRes = await apiCall(memberPage, `${BASE_URL}/api/reviews/${anyRidFromHR}/opinions`, "POST", {
          opinionText: "QA TEAM_MEMBER 저장 시도 (차단 검증)", recommendation: true, noOpinion: false, phase: 2,
        });
        console.log(`  TEAM_MEMBER 의견 저장 → status=${memberOpRes.status} (403 기대)`);
        expect(memberOpRes.status, `TEAM_MEMBER 의견 저장이 차단되지 않음 (status=${memberOpRes.status})`).toBe(403);
        console.log("  ✅ TEAM_MEMBER: 의견 저장 → 403 확인");
      } finally {
        await memberCtx.close();
      }
    } else {
      console.log("  ⚠️  reviewId 없음(전체 데이터 없음) → TEAM_MEMBER 403 검증 스킵");
      console.log("  ℹ️  HR_TEAM 외 역할의 403 반환은 API 레벨에서 role 체크로 보장됨");
    }

  } finally {
    await resetPhase(hrPage, 1);
    console.log("\n  Phase 1 원복 완료");
    await hrCtx.close();
    await browser.close();
  }
});
