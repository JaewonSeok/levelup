import { defineConfig } from "@playwright/test";

export default defineConfig({
  // 각 spec 파일을 순차 실행 (동시성은 코드 내부 Promise.all로 제어)
  workers: 1,

  // 전체 타임아웃 (Phase 1~4 모두 포함)
  timeout: 120_000,

  // 재시도 없음 (QA 결과는 첫 실행 그대로)
  retries: 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "reports/html", open: "never" }],
  ],

  use: {
    headless: true,
    // Vercel 배포 환경 — HTTPS 인증서 오류 무시
    ignoreHTTPSErrors: true,
    // 액션 타임아웃
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    // 스크린샷: 실패 시 자동 저장
    screenshot: "only-on-failure",
    // 비디오: 필요 시 "on-first-retry"로 변경
    video: "off",
  },

  // Chromium만 사용
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],

  // 리포트 출력 디렉터리
  outputDir: "reports/test-results",
});
