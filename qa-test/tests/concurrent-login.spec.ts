/**
 * Phase 1 — 동시 로그인 테스트
 *
 * 10개 브라우저 컨텍스트를 Promise.all로 동시에 열어
 * 각 계정의 로그인 성공 여부와 소요 시간을 측정합니다.
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS } from "../utils/test-users";
import {
  makeResult,
  newIsolatedPage,
  loginUser,
  buildReport,
  saveReport,
} from "../utils/helpers";

test("동시 10명 로그인 테스트 (Phase 1)", async () => {
  const browser = await chromium.launch({ headless: true });

  console.log("\n=== Phase 1: 동시 로그인 시작 ===");
  const overallStart = performance.now();

  // 10개 세션 동시 실행
  const results = await Promise.all(
    TEST_USERS.map(async (user) => {
      const result = makeResult(user);
      const { ctx, page } = await newIsolatedPage(browser);
      try {
        await loginUser(page, user, result);
        const status = result.login_success ? "✅ 성공" : "❌ 실패";
        console.log(`  [${user.description ?? user.email}] 로그인 ${status} (${result.login_time_ms} ms)`);
      } finally {
        await ctx.close();
      }
      return result;
    })
  );

  const totalMs = Math.round(performance.now() - overallStart);
  console.log(`\n총 소요 시간: ${totalMs} ms`);

  await browser.close();

  // ── 집계 ────────────────────────────────────────────────────────────────
  const loginOk  = results.filter(r => r.login_success).length;
  const loginFail = results.length - loginOk;
  const avgTime  = Math.round(
    results.filter(r => r.login_success).reduce((s, r) => s + r.login_time_ms, 0) / (loginOk || 1)
  );

  console.log("\n── 결과 요약 ──────────────────────────────────────");
  console.log(`  성공: ${loginOk} / ${results.length}`);
  console.log(`  실패: ${loginFail}`);
  console.log(`  평균 로그인 시간: ${avgTime} ms`);

  // ── 리포트 저장 ──────────────────────────────────────────────────────────
  const report = buildReport(results);
  const filepath = saveReport(report);
  console.log(`\n리포트 저장: ${filepath}`);

  // ── Playwright assertion ──────────────────────────────────────────────────
  expect(loginOk, `로그인 성공 계정이 0개입니다. 계정 정보를 확인하세요.\n${
    results.filter(r => !r.login_success).map(r => `  ${r.email}: ${r.errors.join(", ")}`).join("\n")
  }`).toBeGreaterThan(0);
});
