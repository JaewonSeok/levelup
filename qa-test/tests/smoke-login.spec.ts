/**
 * 단일 계정 스모크 테스트 — 계정 생성 후 로그인 동작 확인용
 *
 * 실행: npx playwright test tests/smoke-login.spec.ts --workers=1
 */

import { test, expect, chromium } from "@playwright/test";
import { BASE_URL } from "../utils/test-users";

const SMOKE_ACCOUNT = {
  email:    "qa-hr01@rsupport.com",
  password: "QAtest1234!",
};

test("스모크: qa-hr01 로그인 → /level-management 진입 확인", async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  try {
    // 1. /login 접속
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();

    // 2. 자격증명 입력
    await page.fill('input[type="email"]',    SMOKE_ACCOUNT.email);
    await page.fill('input[type="password"]', SMOKE_ACCOUNT.password);

    // 3. 로그인 버튼 클릭
    const t0 = performance.now();
    await page.click('button[type="submit"]');

    // 4. /level-management 로 이동하는지 확인
    await page.waitForURL(`${BASE_URL}/level-management`, { timeout: 30_000 });
    const elapsed = Math.round(performance.now() - t0);

    console.log(`\n✅ 로그인 성공: ${SMOKE_ACCOUNT.email}`);
    console.log(`   소요 시간: ${elapsed} ms`);
    console.log(`   현재 URL : ${page.url()}`);

    // 5. 오류 배너가 없는지 확인
    const errorBanner = page.locator('div[style*="fef2f2"]');
    await expect(errorBanner).not.toBeVisible();

  } finally {
    await ctx.close();
    await browser.close();
  }
});
