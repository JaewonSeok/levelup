/**
 * Phase 4 — 동시 로그아웃 테스트
 *
 * - 10명 동시 로그아웃
 * - 로그아웃 후 보호 경로 접근 시 /login 리다이렉트 확인
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS, BASE_URL } from "../utils/test-users";
import {
  makeResult,
  newIsolatedPage,
  loginUser,
  logoutUser,
  verifyProtectedRedirect,
  buildReport,
  saveReport,
} from "../utils/helpers";

test("동시 10명 로그아웃 테스트 (Phase 4)", async () => {
  const browser = await chromium.launch({ headless: true });

  console.log("\n=== Phase 4: 동시 로그아웃 시작 ===");

  // Step 1: 10명 동시 로그인
  console.log("[Step 1] 10명 동시 로그인...");
  const sessions = await Promise.all(
    TEST_USERS.map(async (user) => {
      const result = makeResult(user);
      const { ctx, page } = await newIsolatedPage(browser);
      const loggedIn = await loginUser(page, user, result);
      return { user, result, ctx, page, loggedIn };
    })
  );

  const loginedCount = sessions.filter(s => s.loggedIn).length;
  console.log(`  로그인 성공: ${loginedCount} / ${sessions.length}`);

  // Step 2: 10명 동시 로그아웃
  console.log("\n[Step 2] 10명 동시 로그아웃...");
  await Promise.all(
    sessions.map(async ({ user, result, page, loggedIn }) => {
      if (!loggedIn) {
        console.log(`  [${user.description}] 로그인 실패로 로그아웃 스킵`);
        return;
      }
      await logoutUser(page, user, result);
      const icon = result.logout_success ? "✅" : "❌";
      console.log(`  [${user.description}] ${icon} 로그아웃 (${result.logout_time_ms} ms)`);
    })
  );

  // Step 3: 보호 경로 접근 차단 확인
  console.log("\n[Step 3] 로그아웃 후 /level-management 접근 차단 확인...");
  await Promise.all(
    sessions.map(async ({ user, result, page, loggedIn }) => {
      if (!loggedIn) return;
      await verifyProtectedRedirect(page, user, result);
      const blocked = result.session_isolation["protected_route_blocked_after_logout"];
      const icon = blocked ? "✅" : "❌";
      console.log(`  [${user.description}] ${icon} 보호 경로 차단: ${blocked}`);
    })
  );

  // Step 4: 정리
  await Promise.all(sessions.map(s => s.ctx.close()));
  await browser.close();

  // ── 집계 ────────────────────────────────────────────────────────────────
  const results = sessions.map(s => s.result);
  const logoutOk   = results.filter(r => r.logout_success).length;
  const blockedOk  = results.filter(r => r.session_isolation["protected_route_blocked_after_logout"] === true).length;
  const eligible   = results.filter(r => r.login_success).length;

  console.log(`\n── 로그아웃 결과:`);
  console.log(`  로그아웃 성공: ${logoutOk} / ${eligible}`);
  console.log(`  보호 경로 차단: ${blockedOk} / ${eligible}`);

  const report = buildReport(results);
  const filepath = saveReport(report);
  console.log(`리포트 저장: ${filepath}`);

  expect(logoutOk, "로그아웃에 실패한 계정이 있습니다.").toBe(eligible);
  expect(blockedOk, "로그아웃 후 보호 경로가 차단되지 않은 계정이 있습니다.").toBe(eligible);
});
