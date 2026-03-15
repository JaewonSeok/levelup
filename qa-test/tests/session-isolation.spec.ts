/**
 * Phase 3 — 세션 격리 검증
 *
 * - 각 사용자가 자신의 세션 토큰만 보유하는지 확인
 * - A 유저가 로그아웃해도 B 유저 세션에는 영향 없음
 * - /api/auth/session 응답에서 이메일 불일치 여부 확인
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS, BASE_URL } from "../utils/test-users";
import {
  makeResult,
  newIsolatedPage,
  loginUser,
  captureError,
  buildReport,
  saveReport,
} from "../utils/helpers";

test("세션 격리 검증 (Phase 3)", async () => {
  const browser = await chromium.launch({ headless: true });

  console.log("\n=== Phase 3: 세션 격리 검증 시작 ===");

  // Step 1: 모든 사용자 동시 로그인
  const sessions = await Promise.all(
    TEST_USERS.map(async (user) => {
      const result = makeResult(user);
      const { ctx, page } = await newIsolatedPage(browser);
      const loggedIn = await loginUser(page, user, result);
      return { user, result, ctx, page, loggedIn };
    })
  );

  // Step 2: 각 세션이 올바른 사용자 정보를 반환하는지 동시 확인
  console.log("\n[Step 2] 세션 이메일 일치 확인...");
  await Promise.all(
    sessions.map(async ({ user, result, page, loggedIn }) => {
      if (!loggedIn) {
        result.session_isolation["session_email_match"] = false;
        result.errors.push("isolation: 로그인 실패로 검증 불가");
        return;
      }
      try {
        const resp = await page.request.get(`${BASE_URL}/api/auth/session`);
        const json = await resp.json() as { user?: { email?: string } };
        const sessionEmail = json?.user?.email ?? "";
        const match = sessionEmail.toLowerCase() === user.email.toLowerCase();
        result.session_isolation["session_email_match"] = match;
        const icon = match ? "✅" : "❌";
        console.log(`  [${user.description}] ${icon} 세션 이메일: ${sessionEmail} (기대: ${user.email})`);
        if (!match) {
          result.errors.push(`isolation: 세션 이메일 불일치 — 기대=${user.email}, 실제=${sessionEmail}`);
          result.screenshots.push(await captureError(page, "session_mismatch", user.email));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.session_isolation["session_email_match"] = false;
        result.errors.push(`isolation: /api/auth/session 호출 실패 — ${msg}`);
      }
    })
  );

  // Step 3: 첫 번째 사용자(sessions[0])를 로그아웃시킨 후 나머지 세션 유효성 확인
  console.log("\n[Step 3] user01 로그아웃 후 타 세션 유효성 확인...");
  if (sessions[0].loggedIn) {
    await sessions[0].page.goto(`${BASE_URL}/api/auth/signout`, { waitUntil: "domcontentloaded" });
    const confirmBtn = sessions[0].page.locator('button[type="submit"]');
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await sessions[0].page.waitForTimeout(1_000);
  }

  await Promise.all(
    sessions.slice(1).map(async ({ user, result, page, loggedIn }) => {
      if (!loggedIn) return;
      try {
        const resp = await page.request.get(`${BASE_URL}/api/auth/session`);
        const json = await resp.json() as { user?: { email?: string } };
        const stillLoggedIn = !!json?.user?.email;
        result.session_isolation["unaffected_by_other_logout"] = stillLoggedIn;
        const icon = stillLoggedIn ? "✅" : "❌";
        console.log(`  [${user.description}] ${icon} user01 로그아웃 후 세션 유지: ${stillLoggedIn}`);
        if (!stillLoggedIn) {
          result.errors.push("isolation: 다른 사용자 로그아웃으로 자신의 세션이 만료됨");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.session_isolation["unaffected_by_other_logout"] = false;
        result.errors.push(`isolation: 세션 유지 확인 실패 — ${msg}`);
      }
    })
  );

  // Step 4: 정리
  await Promise.all(sessions.map(({ ctx }) => ctx.close()));
  await browser.close();

  // ── 집계 ────────────────────────────────────────────────────────────────
  const results = sessions.map(s => s.result);
  const emailMatchOk = results.filter(r => r.session_isolation["session_email_match"] === true).length;
  const isolationOk  = results.filter(r => r.session_isolation["unaffected_by_other_logout"] !== false).length;

  console.log(`\n── 세션 격리 결과:`);
  console.log(`  이메일 일치: ${emailMatchOk} / ${results.length}`);
  console.log(`  타 로그아웃 영향 없음: ${isolationOk} / ${results.length}`);

  const report = buildReport(results);
  const filepath = saveReport(report);
  console.log(`리포트 저장: ${filepath}`);

  expect(emailMatchOk, "세션 이메일 불일치가 발생한 계정이 있습니다.").toBe(
    results.filter(r => r.login_success).length
  );
});
