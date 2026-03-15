/**
 * 시나리오 1 + 2: Phase 전환 E2E + 권한 검증
 *
 * 시나리오 1: HR_TEAM이 Phase 전환 전체 흐름을 수행
 * 시나리오 2: DEPT_HEAD / TEAM_MEMBER는 전환 불가 (403 확인)
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS, BASE_URL } from "../utils/test-users";
import { newIsolatedPage, loginUser, makeResult, captureError, apiCall } from "../utils/helpers";

const HR_USER     = TEST_USERS.find(u => u.email === "qa-hr01@rsupport.com")!;
const DEPT_USER   = TEST_USERS.find(u => u.email === "qa-dept01@rsupport.com")!;
const MEMBER_USER = TEST_USERS.find(u => u.email === "qa-member@rsupport.com")!;
const YEAR = 2026;

// ────────────────────────────────────────────────────────────────────────────
// 공통: Phase 1 원복 헬퍼
// ────────────────────────────────────────────────────────────────────────────
async function resetPhase1(page: Parameters<typeof apiCall>[0]) {
  try {
    await apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase: 1 });
  } catch {
    // ignore – best effort
  }
}

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 1: Phase 전환 전체 흐름 (HR_TEAM)", async () => {
  const browser = await chromium.launch({ headless: true });
  const result  = makeResult(HR_USER);
  const { ctx, page } = await newIsolatedPage(browser);

  try {
    // ── 1. HR 로그인 ──────────────────────────────────────────
    const loggedIn = await loginUser(page, HR_USER, result);
    expect(loggedIn, "HR_TEAM 로그인 실패").toBe(true);
    console.log(`\n  [${HR_USER.description}] 로그인 성공`);

    // ── 2. 현재 Phase 확인 + 필요 시 Phase 1 초기화 ──────────
    const phaseRes = await apiCall(page, `${BASE_URL}/api/review-phase?year=${YEAR}`);
    expect(phaseRes.status, "GET /api/review-phase 200 기대").toBe(200);
    const curPhase = (phaseRes.data as { currentPhase: number }).currentPhase;
    console.log(`  현재 Phase: ${curPhase}`);

    if (curPhase !== 1) {
      const resetRes = await apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase: 1 });
      expect(resetRes.status, "Phase 1 초기화 실패").toBe(200);
      console.log("  Phase 1 초기화 완료");
    }

    // ── 3. /review 접속 → 1차 심사 배너 확인 ─────────────────
    await page.goto(`${BASE_URL}/review`, { waitUntil: "networkidle", timeout: 40_000 });
    const banner1 = page.locator("text=1차 심사 진행 중");
    await expect(banner1).toBeVisible({ timeout: 10_000 });
    console.log("  ✅ '1차 심사 진행 중' 배너 확인");

    // ── 4. '2차 심사 오픈' 버튼 클릭 → 확인 다이얼로그 표시 ──
    const openBtn = page.locator("button:has-text('2차 심사 오픈')").first();
    await expect(openBtn).toBeVisible({ timeout: 5_000 });
    await openBtn.click();
    const dialog = page.locator("[role='dialog']");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    console.log("  ✅ 확인 다이얼로그 표시");

    // ── 5. 다이얼로그 안 '2차 심사 오픈' 클릭 → Phase 2 전환 ─
    const confirmOpen = dialog.locator("button:has-text('2차 심사 오픈')");
    await confirmOpen.click();

    // ── 6. 배너 → '2차 심사 진행 중' 변경 확인 ───────────────
    await expect(page.locator("text=2차 심사 진행 중")).toBeVisible({ timeout: 15_000 });
    console.log("  ✅ '2차 심사 진행 중' 배너 확인");

    // API 응답으로도 Phase 2 확인
    const phase2Res = await apiCall(page, `${BASE_URL}/api/review-phase?year=${YEAR}`);
    expect((phase2Res.data as { currentPhase: number }).currentPhase, "API Phase != 2").toBe(2);
    console.log("  ✅ API currentPhase=2 확인");

    // ── 7. '1차 심사로 되돌리기' 버튼 → Phase 1 복귀 ─────────
    const revertBtn = page.locator("button:has-text('1차 심사로 되돌리기')").first();
    await expect(revertBtn).toBeVisible({ timeout: 5_000 });
    await revertBtn.click();
    const dialog2 = page.locator("[role='dialog']");
    await expect(dialog2).toBeVisible({ timeout: 5_000 });
    const confirmRevert = dialog2.locator("button:has-text('1차로 되돌리기')");
    await confirmRevert.click();

    await expect(page.locator("text=1차 심사 진행 중")).toBeVisible({ timeout: 15_000 });
    const phase1Back = await apiCall(page, `${BASE_URL}/api/review-phase?year=${YEAR}`);
    expect((phase1Back.data as { currentPhase: number }).currentPhase, "Phase 1 복귀 실패").toBe(1);
    console.log("  ✅ Phase 1 복귀 확인");

  } finally {
    await resetPhase1(page);
    await ctx.close();
    await browser.close();
  }
});

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 2: Phase 전환 권한 검증 (DEPT_HEAD / TEAM_MEMBER → 403)", async () => {
  const browser = await chromium.launch({ headless: true });

  // ── DEPT_HEAD 검증 ────────────────────────────────────────────────────────
  {
    const result = makeResult(DEPT_USER);
    const { ctx, page } = await newIsolatedPage(browser);
    try {
      const loggedIn = await loginUser(page, DEPT_USER, result);
      expect(loggedIn, "DEPT_HEAD 로그인 실패").toBe(true);

      await page.goto(`${BASE_URL}/review`, { waitUntil: "networkidle", timeout: 40_000 });

      // Phase 전환 버튼 없는지 확인
      const openVisible   = await page.locator("button:has-text('2차 심사 오픈')").isVisible({ timeout: 3_000 }).catch(() => false);
      const revertVisible = await page.locator("button:has-text('1차 심사로 되돌리기')").isVisible({ timeout: 3_000 }).catch(() => false);
      expect(openVisible,   "DEPT_HEAD에게 2차 오픈 버튼이 보임 (보안 위반)").toBe(false);
      expect(revertVisible, "DEPT_HEAD에게 되돌리기 버튼이 보임 (보안 위반)").toBe(false);
      console.log(`\n  ✅ DEPT_HEAD: Phase 전환 버튼 없음`);

      // API PUT → 403
      const putRes = await apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase: 2 });
      expect(putRes.status, `DEPT_HEAD PUT /api/review-phase → ${putRes.status} (403 기대)`).toBe(403);
      console.log(`  ✅ DEPT_HEAD: PUT /api/review-phase → 403`);

    } finally {
      await ctx.close();
    }
  }

  // ── TEAM_MEMBER 검증 ──────────────────────────────────────────────────────
  {
    const result = makeResult(MEMBER_USER);
    const { ctx, page } = await newIsolatedPage(browser);
    try {
      const loggedIn = await loginUser(page, MEMBER_USER, result);
      expect(loggedIn, "TEAM_MEMBER 로그인 실패").toBe(true);

      // /review 는 권한 없으면 /login 리다이렉트 — 어느 쪽이든 버튼 없어야 함
      await page.goto(`${BASE_URL}/review`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const url = page.url();
      if (!url.includes("/login")) {
        const openVisible = await page.locator("button:has-text('2차 심사 오픈')").isVisible({ timeout: 3_000 }).catch(() => false);
        expect(openVisible, "TEAM_MEMBER에게 Phase 전환 버튼이 보임 (보안 위반)").toBe(false);
      }

      // API PUT → 403
      const putRes = await apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase: 2 });
      expect(putRes.status, `TEAM_MEMBER PUT /api/review-phase → ${putRes.status} (403 기대)`).toBe(403);
      console.log(`  ✅ TEAM_MEMBER: PUT /api/review-phase → 403`);

    } finally {
      await ctx.close();
      await browser.close();
    }
  }
});
