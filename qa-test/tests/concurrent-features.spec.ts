/**
 * Phase 2 — 동시 기능 사용 테스트
 *
 * 로그인 후 각 사용자가 동시에 주요 페이지를 탐색하고
 * 응답 시간을 측정합니다.
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
  FeatureResult,
} from "../utils/helpers";
import { Page } from "@playwright/test";

// 각 역할에 따라 접근 가능한 페이지 목록 (역할 구분 없이 전체 시도 후 응답 코드로 판정)
const PAGES_TO_CHECK = [
  { path: "/level-management", label: "레벨 관리" },
  { path: "/candidates",       label: "대상자 관리" },
  { path: "/review",            label: "심사" },
  { path: "/confirmation",     label: "확정" },
  { path: "/points",           label: "포인트 관리" },
  { path: "/credits",          label: "학점 관리" },
];

async function measurePageLoad(
  page: Page,
  targetPath: string,
  label: string,
  email: string
): Promise<FeatureResult> {
  const t0 = performance.now();
  try {
    const response = await page.goto(`${BASE_URL}${targetPath}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const duration = Math.round(performance.now() - t0);

    // 권한 없음 → /login 리다이렉트 → passed=true (정상 동작)
    const url = page.url();
    const redirectedToLogin = url.includes("/login");

    if (redirectedToLogin) {
      return { passed: true, duration_ms: duration, detail: "권한 없음 → /login 리다이렉트 (정상)" };
    }

    // 페이지에 오류 메시지가 없는지 확인
    const hasError = await page.locator("text=500, text=Error, text=오류").count() > 0;
    if (hasError) {
      await captureError(page, `page_error_${label}`, email);
      return { passed: false, duration_ms: duration, detail: "페이지 오류 감지" };
    }

    return { passed: true, duration_ms: duration, detail: `HTTP ${response?.status() ?? "?"} (${duration} ms)` };
  } catch (err: unknown) {
    const duration = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    return { passed: false, duration_ms: duration, detail: msg };
  }
}

test("동시 10명 기능 사용 테스트 (Phase 2)", async () => {
  const browser = await chromium.launch({ headless: true });

  console.log("\n=== Phase 2: 동시 기능 사용 시작 ===");

  const results = await Promise.all(
    TEST_USERS.map(async (user) => {
      const result = makeResult(user);
      const { ctx, page } = await newIsolatedPage(browser);
      try {
        // 1. 로그인
        const loggedIn = await loginUser(page, user, result);
        if (!loggedIn) {
          console.log(`  [${user.description}] 로그인 실패 → 기능 테스트 스킵`);
          return result;
        }

        // 2. 각 페이지 순차 방문 (동시성은 사용자 단위로 이미 적용됨)
        for (const { path, label } of PAGES_TO_CHECK) {
          const featureResult = await measurePageLoad(page, path, label, user.email);
          result.features[label] = featureResult;
          const icon = featureResult.passed ? "✅" : "❌";
          console.log(`  [${user.description}] ${icon} ${label}: ${featureResult.duration_ms} ms — ${featureResult.detail}`);
        }

        // 3. 데이터 목록이 실제로 렌더링되는지 확인 (level-management)
        // networkidle 대기: API 요청이 완전히 끝난 뒤 테이블 상태 확인
        await page.goto(`${BASE_URL}/level-management`, { waitUntil: "networkidle", timeout: 40_000 });
        if (!page.url().includes("/login")) {
          const t0 = performance.now();
          try {
            // networkidle 이후에도 혹시 남은 렌더링 대기 (최대 10s)
            await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 10_000 });
            const rowCount = await page.locator("table tbody tr").count();
            result.features["레벨 관리 테이블 렌더링"] = {
              passed: rowCount >= 1,
              duration_ms: Math.round(performance.now() - t0),
              detail: `${rowCount}개 행 렌더링`,
            };
          } catch {
            result.features["레벨 관리 테이블 렌더링"] = {
              passed: false,
              duration_ms: Math.round(performance.now() - t0),
              detail: "테이블 렌더링 타임아웃",
            };
            result.screenshots.push(await captureError(page, "table_render", user.email));
          }
        }

        // 4. 심사 페이지 Phase 배너 렌더링 확인 (본부장 이상 역할만)
        const reviewRoles = ["HR_TEAM", "DEPT_HEAD", "CEO", "SYSTEM_ADMIN"];
        if (reviewRoles.includes(user.role ?? "")) {
          await page.goto(`${BASE_URL}/review`, { waitUntil: "networkidle", timeout: 40_000 });
          if (!page.url().includes("/login")) {
            const t0 = performance.now();
            try {
              // "1차 심사 진행 중" 또는 "2차 심사 진행 중" 둘 중 하나가 보여야 함
              await page.locator("text=차 심사 진행 중").first().waitFor({ state: "visible", timeout: 8_000 });
              const bannerText = await page.locator("text=차 심사 진행 중").first().textContent();
              result.features["심사 Phase 배너 렌더링"] = {
                passed: true,
                duration_ms: Math.round(performance.now() - t0),
                detail: `배너: "${(bannerText ?? "").trim().slice(0, 40)}"`,
              };
            } catch {
              result.features["심사 Phase 배너 렌더링"] = {
                passed: false,
                duration_ms: Math.round(performance.now() - t0),
                detail: "Phase 배너 미표시 (심사 UI 오류 가능성)",
              };
              result.screenshots.push(await captureError(page, "phase_banner", user.email));
            }
          }
        }
      } finally {
        await ctx.close();
      }
      return result;
    })
  );

  await browser.close();

  // ── 집계 ────────────────────────────────────────────────────────────────
  let passed = 0, failed = 0;
  for (const r of results) {
    for (const f of Object.values(r.features)) {
      f.passed ? passed++ : failed++;
    }
  }
  console.log(`\n── 기능 테스트 결과: 통과 ${passed} / 실패 ${failed}`);

  const report = buildReport(results);
  const filepath = saveReport(report);
  console.log(`리포트 저장: ${filepath}`);

  expect(failed, `기능 테스트 실패 항목이 있습니다.`).toBe(0);
});
