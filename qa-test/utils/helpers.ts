import { Page, Browser, BrowserContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { BASE_URL, TestUser } from "./test-users";

// ── 타입 ────────────────────────────────────────────────────────────────────

export interface UserResult {
  email: string;
  role?: string;
  description?: string;
  login_success: boolean;
  login_time_ms: number;
  logout_success: boolean;
  logout_time_ms: number;
  features: Record<string, FeatureResult>;
  session_isolation: Record<string, boolean>;
  errors: string[];
  screenshots: string[];
}

export interface FeatureResult {
  passed: boolean;
  duration_ms: number;
  detail?: string;
}

export interface SummaryReport {
  generated_at: string;
  base_url: string;
  summary: {
    total_users: number;
    login_success: number;
    login_fail: number;
    avg_login_time_ms: number;
    logout_success: number;
    logout_fail: number;
    feature_tests_passed: number;
    feature_tests_failed: number;
  };
  per_user: UserResult[];
}

// ── 스크린샷 캡처 ────────────────────────────────────────────────────────────

export async function captureError(
  page: Page,
  label: string,
  userEmail: string
): Promise<string> {
  const dir = path.resolve(__dirname, "../reports/screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${userEmail.replace(/@/g, "_at_")}_${label}_${Date.now()}.png`;
  const filepath = path.join(dir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`  [screenshot] ${filepath}`);
  return filepath;
}

// ── 로그인 ───────────────────────────────────────────────────────────────────

export async function loginUser(
  page: Page,
  user: TestUser,
  result: UserResult
): Promise<boolean> {
  const t0 = performance.now();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // 랜덤 딜레이 100~500 ms (rate-limit 방지)
    await page.waitForTimeout(100 + Math.floor(Math.random() * 400));

    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', user.password);
    await page.click('button[type="submit"]');

    // NextAuth credentials → window.location.href = "/level-management"
    await page.waitForURL(`${BASE_URL}/level-management`, { timeout: 30_000 });

    result.login_time_ms = Math.round(performance.now() - t0);
    result.login_success = true;
    return true;
  } catch (err: unknown) {
    result.login_time_ms = Math.round(performance.now() - t0);
    result.login_success = false;
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`login: ${msg}`);
    result.screenshots.push(await captureError(page, "login_fail", user.email));
    return false;
  }
}

// ── 로그아웃 ─────────────────────────────────────────────────────────────────

export async function logoutUser(
  page: Page,
  user: TestUser,
  result: UserResult
): Promise<boolean> {
  const t0 = performance.now();
  try {
    // NextAuth signOut endpoint
    await page.goto(`${BASE_URL}/api/auth/signout`, { waitUntil: "domcontentloaded", timeout: 15_000 });

    // 서버 렌더링 signout 확인 폼이 있을 경우 클릭
    const confirmBtn = page.locator('button[type="submit"]');
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // 로그아웃 후 /login으로 리다이렉트되는지 확인
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    result.logout_time_ms = Math.round(performance.now() - t0);
    result.logout_success = true;
    return true;
  } catch (err: unknown) {
    result.logout_time_ms = Math.round(performance.now() - t0);
    result.logout_success = false;
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`logout: ${msg}`);
    result.screenshots.push(await captureError(page, "logout_fail", user.email));
    return false;
  }
}

// ── 보호 경로 접근 차단 확인 ────────────────────────────────────────────────

export async function verifyProtectedRedirect(
  page: Page,
  user: TestUser,
  result: UserResult
): Promise<void> {
  try {
    await page.goto(`${BASE_URL}/level-management`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    const currentUrl = page.url();
    const redirected = currentUrl.includes("/login");
    result.session_isolation["protected_route_blocked_after_logout"] = redirected;
    if (!redirected) {
      result.errors.push(`logout_check: 로그아웃 후 /level-management 접근 차단 실패 (현재 URL: ${currentUrl})`);
      result.screenshots.push(await captureError(page, "session_not_cleared", user.email));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`logout_check: ${msg}`);
  }
}

// ── 리포트 저장 ──────────────────────────────────────────────────────────────

export function buildReport(results: UserResult[]): SummaryReport {
  const loginSuccess  = results.filter(r => r.login_success).length;
  const logoutSuccess = results.filter(r => r.logout_success).length;
  const loginTimes    = results.filter(r => r.login_success).map(r => r.login_time_ms);
  const avgLogin      = loginTimes.length
    ? Math.round(loginTimes.reduce((a, b) => a + b, 0) / loginTimes.length)
    : 0;

  let featurePassed = 0, featureFailed = 0;
  for (const r of results) {
    for (const f of Object.values(r.features)) {
      f.passed ? featurePassed++ : featureFailed++;
    }
  }

  return {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    summary: {
      total_users:           results.length,
      login_success:         loginSuccess,
      login_fail:            results.length - loginSuccess,
      avg_login_time_ms:     avgLogin,
      logout_success:        logoutSuccess,
      logout_fail:           results.length - logoutSuccess,
      feature_tests_passed:  featurePassed,
      feature_tests_failed:  featureFailed,
    },
    per_user: results,
  };
}

export function saveReport(report: SummaryReport): string {
  const dir = path.resolve(__dirname, "../reports");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `qa-report-${Date.now()}.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
  return filepath;
}

// ── 컨텍스트 초기화 헬퍼 ────────────────────────────────────────────────────

export function makeResult(user: TestUser): UserResult {
  return {
    email:             user.email,
    role:              user.role,
    description:       user.description,
    login_success:     false,
    login_time_ms:     0,
    logout_success:    false,
    logout_time_ms:    0,
    features:          {},
    session_isolation: {},
    errors:            [],
    screenshots:       [],
  };
}

export async function newIsolatedPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx  = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  return { ctx, page };
}

// ── 인증된 페이지 컨텍스트에서 API 호출 ─────────────────────────────────────
// page의 쿠키(세션)를 그대로 사용하므로 로그인 후 호출해야 함

export async function apiCall(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  return page.evaluate(
    async (args: { url: string; method: string; hasBody: boolean; body: string | null }) => {
      const res = await fetch(args.url, {
        method:  args.method,
        headers: args.hasBody ? { "Content-Type": "application/json" } : {},
        body:    args.hasBody && args.body ? args.body : undefined,
      });
      let data: unknown = null;
      try { data = await res.json(); } catch { data = null; }
      return { status: res.status, data };
    },
    {
      url,
      method,
      hasBody: body !== undefined,
      body:    body !== undefined ? JSON.stringify(body) : null,
    }
  );
}
