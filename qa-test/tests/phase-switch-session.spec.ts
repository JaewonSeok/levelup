/**
 * Phase 전환 시 본부장 세션 권한 유지 검증
 *
 * 시나리오 A: Phase 전환 후 본부장이 새로고침해도 DEPT_HEAD 필터 유지
 * 시나리오 B: API 응답에 admin 데이터가 섞이지 않는지 확인
 * 시나리오 C: 3명 본부장 동시 접속 중 Phase 전환 → 각자 자기 권한 데이터만 받는지 확인
 *
 * ⚠️ 프로덕션 테스트이므로 Phase 전환 후 반드시 원래 Phase로 복구합니다.
 */

import { test, expect, chromium, Browser, BrowserContext, Page } from "@playwright/test";
import { BASE_URL } from "../utils/test-users";
import { newIsolatedPage, loginUser, makeResult, apiCall, captureError } from "../utils/helpers";

// ── 계정 ──────────────────────────────────────────────────────────────────────

const HR_USER    = { email: "qa-hr01@rsupport.com",   password: "QAtest1234!", role: "HR_TEAM",   description: "인사팀 01" };
const DEPT_A     = { email: "qa-dept01@rsupport.com", password: "QAtest1234!", role: "DEPT_HEAD", description: "본부장 A" };
const DEPT_B     = { email: "qa-dept02@rsupport.com", password: "QAtest1234!", role: "DEPT_HEAD", description: "본부장 B" };
const DEPT_C     = { email: "qa-dept03@rsupport.com", password: "QAtest1234!", role: "DEPT_HEAD", description: "본부장 C" };

const YEAR = 2026;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

async function getCurrentPhase(page: Page): Promise<number> {
  const res = await apiCall(page, `${BASE_URL}/api/review-phase?year=${YEAR}`);
  const data = res.data as { currentPhase?: number } | null;
  return data?.currentPhase ?? 1;
}

async function switchPhase(page: Page, targetPhase: number): Promise<boolean> {
  const res = await apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase: targetPhase });
  return res.status === 200;
}

interface ReviewsApiResponse {
  candidates?: ReviewCandidate[];
  total?: number;
  currentUser?: { id: string; role: string; department: string; currentPhase: number };
}

interface ReviewCandidate {
  name: string;
  department: string;
  level: string | null;
  promotionType?: string;
}

async function fetchReviewCandidates(
  page: Page,
  targetType: "all" | "own" | "other"
): Promise<ReviewsApiResponse> {
  const url = `${BASE_URL}/api/reviews?year=${YEAR}&department=&team=&targetType=${targetType}`;
  const res = await apiCall(page, url);
  return (res.data ?? {}) as ReviewsApiResponse;
}

// ── 시나리오 A: Phase 전환 후 본부장 권한 유지 ───────────────────────────────

test("시나리오 A: Phase 전환 후 본부장 API 필터 유지", async () => {
  const browser = await chromium.launch({ headless: true });
  let originalPhase = 1;
  let hrPage: Page | null = null;
  let hrCtx: BrowserContext | null = null;
  let deptCtx: BrowserContext | null = null;

  try {
    console.log("\n=== 시나리오 A: Phase 전환 후 본부장 필터 유지 ===");

    // ── Step 1: HR 로그인으로 현재 Phase 확인 ──────────────────────────────
    const hrResult   = makeResult(HR_USER);
    const deptResult = makeResult(DEPT_A);

    const hrSession   = await newIsolatedPage(browser);
    const deptSession = await newIsolatedPage(browser);
    hrCtx   = hrSession.ctx;
    hrPage  = hrSession.page;
    deptCtx = deptSession.ctx;

    const hrLoggedIn   = await loginUser(hrSession.page, HR_USER, hrResult);
    const deptLoggedIn = await loginUser(deptSession.page, DEPT_A, deptResult);

    expect(hrLoggedIn,   "HR 로그인 실패").toBe(true);
    expect(deptLoggedIn, "본부장 A 로그인 실패").toBe(true);

    originalPhase = await getCurrentPhase(hrSession.page);
    console.log(`[A] 현재 Phase: ${originalPhase}`);

    // ── Step 2: 본부장의 소속 본부 확인 (Phase 1 own 조회) ────────────────
    const beforeData = await fetchReviewCandidates(deptSession.page, "own");
    const deptHeadDept = beforeData.currentUser?.department ?? "";
    const phaseBeforeSwitch = beforeData.currentUser?.currentPhase ?? originalPhase;

    console.log(`[A] 본부장 A 소속: "${deptHeadDept}", 초기 Phase: ${phaseBeforeSwitch}`);
    expect(beforeData.currentUser?.role, "API currentUser.role이 DEPT_HEAD여야 함").toBe("DEPT_HEAD");

    // ── Step 3: 반대 Phase로 전환 ──────────────────────────────────────────
    const targetPhase = originalPhase === 1 ? 2 : 1;
    console.log(`[A] Phase ${originalPhase} → ${targetPhase} 전환 중...`);
    const switched = await switchPhase(hrSession.page, targetPhase);
    expect(switched, `Phase ${targetPhase} 전환 실패`).toBe(true);

    await deptSession.page.waitForTimeout(500); // 전환 완료 대기

    // ── Step 4: 본부장 세션에서 새로 조회 (새로고침 시뮬레이션) ───────────
    const afterAllData  = await fetchReviewCandidates(deptSession.page, "all");
    const afterOwnData  = await fetchReviewCandidates(deptSession.page, "own");

    const currentPhaseAfter = afterAllData.currentUser?.currentPhase ?? -1;
    const roleAfter         = afterAllData.currentUser?.role ?? "";
    console.log(`[A] 전환 후 — currentPhase: ${currentPhaseAfter}, role: ${roleAfter}`);

    // ── 검증 1: currentUser.role은 항상 DEPT_HEAD ─────────────────────────
    expect(roleAfter, "Phase 전환 후 role이 DEPT_HEAD여야 함 (admin으로 변하면 ❌)").toBe("DEPT_HEAD");

    // ── 검증 2: currentPhase가 실제 전환된 Phase와 일치 ───────────────────
    expect(currentPhaseAfter, `currentPhase가 ${targetPhase}여야 함`).toBe(targetPhase);

    if (targetPhase === 2) {
      // Phase 2: "all" 조회 시 본부장 본인소속 직원이 나오면 안 됨
      const allCandidates = afterAllData.candidates ?? [];
      const ownDeptInAll  = allCandidates.filter(c => c.department === deptHeadDept);

      if (ownDeptInAll.length > 0) {
        const names = ownDeptInAll.map(c => `${c.name}(${c.department})`).join(", ");
        await captureError(deptSession.page, "phase2_own_dept_leaked", DEPT_A.email);
        console.log(`  ❌ FAIL: Phase 2 "전체" 조회에 본인소속 직원이 포함됨 — ${names}`);
      } else {
        console.log(`  ✅ PASS: Phase 2 "전체" 조회에 본인소속(${deptHeadDept}) 없음`);
      }
      expect(
        ownDeptInAll.length,
        `Phase 2 "전체" 조회에 본인소속(${deptHeadDept}) 직원이 ${ownDeptInAll.length}명 포함됨`
      ).toBe(0);

      // Phase 2: "all" 조회에 L3/L4만 있어야 함 (L0~L2, L5 제외)
      const illegalLevels = allCandidates.filter(c =>
        c.level !== null && !["L3", "L4"].includes(c.level)
      );
      if (illegalLevels.length > 0) {
        const names = illegalLevels.map(c => `${c.name}(${c.level})`).join(", ");
        console.log(`  ❌ FAIL: Phase 2 타본부에 L3/L4 외 레벨 포함 — ${names}`);
      } else {
        console.log(`  ✅ PASS: Phase 2 타본부 조회 — 전원 L3/L4 레벨`);
      }
      expect(
        illegalLevels.length,
        `Phase 2 타본부 조회에 L3/L4 외 레벨이 포함됨`
      ).toBe(0);

      // Phase 2: "own" 조회 시 본인소속 직원만 나와야 함 (읽기전용)
      const ownCandidates    = afterOwnData.candidates ?? [];
      const nonOwnInOwn      = ownCandidates.filter(c => c.department !== deptHeadDept);
      if (nonOwnInOwn.length > 0) {
        const names = nonOwnInOwn.map(c => `${c.name}(${c.department})`).join(", ");
        console.log(`  ❌ FAIL: Phase 2 "본인소속" 조회에 타본부 직원 포함 — ${names}`);
      } else {
        console.log(`  ✅ PASS: Phase 2 "본인소속" 조회 — 전원 ${deptHeadDept} 소속`);
      }
      expect(
        nonOwnInOwn.length,
        `Phase 2 "본인소속" 조회에 타본부 직원 포함됨`
      ).toBe(0);

    } else {
      // Phase 1: 모든 조회에서 본인소속만 나와야 함
      const allCandidates = afterAllData.candidates ?? [];
      const nonOwnInAll   = allCandidates.filter(c => c.department !== deptHeadDept);

      if (nonOwnInAll.length > 0) {
        const names = nonOwnInAll.map(c => `${c.name}(${c.department})`).join(", ");
        await captureError(deptSession.page, "phase1_other_dept_leaked", DEPT_A.email);
        console.log(`  ❌ FAIL: Phase 1 조회에 타본부 직원 포함 — ${names}`);
      } else {
        console.log(`  ✅ PASS: Phase 1 조회 — 전원 ${deptHeadDept} 소속 (혹은 0명)`);
      }
      expect(
        nonOwnInAll.length,
        `Phase 1에서 타본부 직원 ${nonOwnInAll.length}명이 노출됨`
      ).toBe(0);
    }

  } finally {
    // ── 반드시 원래 Phase로 복구 ───────────────────────────────────────────
    if (hrPage) {
      const restored = await switchPhase(hrPage, originalPhase);
      console.log(`[A] Phase 복구 → ${originalPhase}: ${restored ? "✅" : "❌ 실패"}`);
    }
    if (hrCtx)   await hrCtx.close();
    if (deptCtx) await deptCtx.close();
    await browser.close();
  }
});

// ── 시나리오 B: API 응답에 admin 데이터가 없는지 확인 ───────────────────────

test("시나리오 B: DEPT_HEAD API 응답에 admin 권한 데이터 미포함 확인", async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    console.log("\n=== 시나리오 B: DEPT_HEAD API 응답 검증 ===");

    const deptResult = makeResult(DEPT_A);
    const { ctx, page } = await newIsolatedPage(browser);

    const loggedIn = await loginUser(page, DEPT_A, deptResult);
    expect(loggedIn, "본부장 A 로그인 실패").toBe(true);

    const currentPhase = await getCurrentPhase(page);
    console.log(`[B] 현재 Phase: ${currentPhase}`);

    // ── 검증 1: currentUser.role이 DEPT_HEAD ─────────────────────────────
    for (const targetType of ["all", "own", "other"] as const) {
      const data = await fetchReviewCandidates(page, targetType);

      const role  = data.currentUser?.role ?? "unknown";
      const phase = data.currentUser?.currentPhase ?? -1;
      const dept  = data.currentUser?.department ?? "";

      console.log(`[B] targetType="${targetType}" → role=${role}, phase=${phase}, dept="${dept}"`);

      expect(role,  `targetType=${targetType}: role이 DEPT_HEAD여야 함 (실제: ${role})`).toBe("DEPT_HEAD");
      expect(dept,  `targetType=${targetType}: department가 비어있으면 안 됨`).not.toBe("");
      expect(phase, `targetType=${targetType}: currentPhase가 -1이면 안 됨`).not.toBe(-1);

      // ── 검증 2: Phase 1에서 타본부 직원이 0명인지 ──────────────────────
      if (currentPhase === 1) {
        const candidates = data.candidates ?? [];
        const nonOwn = candidates.filter(c => c.department !== dept);

        if (nonOwn.length > 0) {
          const names = nonOwn.map(c => `${c.name}(${c.department},${c.level})`).join(", ");
          console.log(`  ❌ FAIL: Phase 1, targetType="${targetType}"에서 타본부 노출 — ${names}`);
          await captureError(page, `phase1_leak_${targetType}`, DEPT_A.email);
        } else {
          console.log(`  ✅ PASS: Phase 1, targetType="${targetType}" 타본부 0명`);
        }
        expect(nonOwn.length, `Phase 1 ${targetType}: 타본부 직원 ${nonOwn.length}명 노출`).toBe(0);
      }

      // ── 검증 3: Phase 2에서 "all"/"other" 에 L3/L4만 있는지 ──────────
      if (currentPhase === 2 && (targetType === "all" || targetType === "other")) {
        const candidates = data.candidates ?? [];
        const illegalLevels = candidates.filter(c => c.level !== null && !["L3", "L4"].includes(c.level));
        const ownDeptCands  = candidates.filter(c => c.department === dept);

        if (illegalLevels.length > 0) {
          const names = illegalLevels.map(c => `${c.name}(${c.level})`).join(", ");
          console.log(`  ❌ FAIL: Phase 2 ${targetType}: L3/L4 외 레벨 포함 — ${names}`);
        } else {
          console.log(`  ✅ PASS: Phase 2 ${targetType}: 레벨 필터 정상`);
        }
        if (ownDeptCands.length > 0) {
          const names = ownDeptCands.map(c => c.name).join(", ");
          console.log(`  ❌ FAIL: Phase 2 ${targetType}: 본인소속 직원 노출 — ${names}`);
        } else {
          console.log(`  ✅ PASS: Phase 2 ${targetType}: 본인소속 직원 없음`);
        }
        expect(illegalLevels.length, `Phase 2 ${targetType}: L3/L4 외 레벨 노출`).toBe(0);
        expect(ownDeptCands.length,  `Phase 2 ${targetType}: 본인소속(${dept}) 노출`).toBe(0);
      }
    }

    await ctx.close();
  } finally {
    await browser.close();
  }
});

// ── 시나리오 C: 본부장 3명 동시 접속 + Phase 전환 ────────────────────────────

test("시나리오 C: 본부장 3명 동시 접속 중 Phase 전환 — 권한 교차 오염 없음", async () => {
  const browser = await chromium.launch({ headless: true });
  let originalPhase = 1;
  let hrPage: Page | null = null;
  let hrCtx: BrowserContext | null = null;

  try {
    console.log("\n=== 시나리오 C: 3명 본부장 동시 접속 + Phase 전환 ===");

    const deptUsers = [DEPT_A, DEPT_B, DEPT_C];

    // ── Step 1: HR + 본부장 3명 동시 로그인 ───────────────────────────────
    const hrSession = await newIsolatedPage(browser);
    hrCtx  = hrSession.ctx;
    hrPage = hrSession.page;
    const hrResult = makeResult(HR_USER);
    await loginUser(hrSession.page, HR_USER, hrResult);
    originalPhase = await getCurrentPhase(hrSession.page);
    console.log(`[C] 초기 Phase: ${originalPhase}`);

    const deptSessions = await Promise.all(
      deptUsers.map(async (u) => {
        const result = makeResult(u);
        const { ctx, page } = await newIsolatedPage(browser);
        const loggedIn = await loginUser(page, u, result);
        return { user: u, ctx, page, result, loggedIn };
      })
    );

    const allLoggedIn = deptSessions.every(s => s.loggedIn);
    if (!allLoggedIn) {
      const failed = deptSessions.filter(s => !s.loggedIn).map(s => s.user.description);
      console.log(`[C] 로그인 실패: ${failed.join(", ")} — 테스트 스킵`);
    }
    expect(allLoggedIn, "본부장 3명 전원 로그인 필요").toBe(true);

    // ── Step 2: 전환 전 각 본부장 소속 기록 ───────────────────────────────
    const beforeDepts = await Promise.all(
      deptSessions.map(async (s) => {
        const data = await fetchReviewCandidates(s.page, "own");
        return {
          email: s.user.email,
          description: s.user.description,
          dept: data.currentUser?.department ?? "",
          role: data.currentUser?.role ?? "",
          phase: data.currentUser?.currentPhase ?? -1,
          page: s.page,
        };
      })
    );

    console.log("[C] 본부장 소속:");
    beforeDepts.forEach(d =>
      console.log(`  ${d.description}: dept="${d.dept}", role=${d.role}, phase=${d.phase}`)
    );

    for (const d of beforeDepts) {
      expect(d.role, `${d.description}: role이 DEPT_HEAD여야 함`).toBe("DEPT_HEAD");
      expect(d.dept, `${d.description}: department가 비어있으면 안 됨`).not.toBe("");
    }

    // ── Step 3: Phase 전환 (반대 방향) ────────────────────────────────────
    const targetPhase = originalPhase === 1 ? 2 : 1;
    console.log(`[C] Phase ${originalPhase} → ${targetPhase} 전환...`);
    const switched = await switchPhase(hrSession.page, targetPhase);
    expect(switched, `Phase ${targetPhase} 전환 실패`).toBe(true);

    await new Promise(r => setTimeout(r, 800)); // 전환 완료 대기

    // ── Step 4: 3명 동시 재조회 ───────────────────────────────────────────
    console.log("[C] 3명 동시 재조회...");
    const afterResults = await Promise.all(
      beforeDepts.map(async (info) => {
        const allData  = await fetchReviewCandidates(info.page, "all");
        const ownData  = await fetchReviewCandidates(info.page, "own");
        return {
          ...info,
          afterRole:  allData.currentUser?.role ?? "",
          afterPhase: allData.currentUser?.currentPhase ?? -1,
          afterDept:  allData.currentUser?.department ?? "",
          allCandidates: allData.candidates ?? [],
          ownCandidates: ownData.candidates ?? [],
        };
      })
    );

    // ── 검증: 각 본부장이 자기 권한 데이터만 받는지 ──────────────────────
    let allPassed = true;
    for (const r of afterResults) {
      console.log(`\n  [${r.description}] 전환 후: role=${r.afterRole}, phase=${r.afterPhase}, dept="${r.afterDept}"`);

      // role이 여전히 DEPT_HEAD인지
      if (r.afterRole !== "DEPT_HEAD") {
        console.log(`    ❌ FAIL: role이 DEPT_HEAD가 아님 — 실제: ${r.afterRole}`);
        allPassed = false;
      } else {
        console.log(`    ✅ role: DEPT_HEAD 유지`);
      }

      // Phase가 전환된 Phase와 일치하는지
      if (r.afterPhase !== targetPhase) {
        console.log(`    ❌ FAIL: currentPhase 불일치 — 기대: ${targetPhase}, 실제: ${r.afterPhase}`);
        allPassed = false;
      } else {
        console.log(`    ✅ currentPhase: ${targetPhase} 정상`);
      }

      // 소속 본부가 변하지 않았는지
      if (r.afterDept !== r.dept) {
        console.log(`    ❌ FAIL: department 변경됨 — 이전: "${r.dept}", 이후: "${r.afterDept}"`);
        allPassed = false;
      } else {
        console.log(`    ✅ department: "${r.dept}" 유지`);
      }

      if (targetPhase === 2) {
        // Phase 2: "all" 에서 본인소속 직원이 보이면 안 됨
        const ownDeptInAll = r.allCandidates.filter(c => c.department === r.dept);
        if (ownDeptInAll.length > 0) {
          const names = ownDeptInAll.map(c => c.name).join(", ");
          console.log(`    ❌ FAIL: Phase 2 "전체" 에 본인소속(${r.dept}) 노출 — ${names}`);
          await captureError(r.page, `C_phase2_own_leak_${r.description}`, r.email);
          allPassed = false;
        } else {
          console.log(`    ✅ Phase 2 "전체": 본인소속(${r.dept}) 없음`);
        }

        // Phase 2: L3/L4 외 레벨이 "all" 에 없어야 함
        const illegalLevels = r.allCandidates.filter(c =>
          c.level !== null && !["L3", "L4"].includes(c.level)
        );
        if (illegalLevels.length > 0) {
          const names = illegalLevels.map(c => `${c.name}(${c.level})`).join(", ");
          console.log(`    ❌ FAIL: Phase 2 "전체" 에 L3/L4 외 레벨 포함 — ${names}`);
          allPassed = false;
        } else {
          console.log(`    ✅ Phase 2 "전체": 레벨 필터 정상`);
        }
      } else {
        // Phase 1: "all" 에서 타본부 직원이 보이면 안 됨
        const nonOwn = r.allCandidates.filter(c => c.department !== r.dept);
        if (nonOwn.length > 0) {
          const names = nonOwn.map(c => `${c.name}(${c.department})`).join(", ");
          console.log(`    ❌ FAIL: Phase 1 "전체" 에 타본부 직원 노출 — ${names}`);
          await captureError(r.page, `C_phase1_leak_${r.description}`, r.email);
          allPassed = false;
        } else {
          console.log(`    ✅ Phase 1 "전체": 타본부 없음 (${r.allCandidates.length}명, 전원 ${r.dept})`);
        }
      }

      expect(r.afterRole,  `${r.description}: role 변조`).toBe("DEPT_HEAD");
      expect(r.afterPhase, `${r.description}: Phase 불일치`).toBe(targetPhase);
      expect(r.afterDept,  `${r.description}: department 변조`).toBe(r.dept);
    }

    if (allPassed) {
      console.log("\n[C] ✅ 전체 PASS — 3명 본부장 모두 자기 권한 데이터만 수신");
    } else {
      console.log("\n[C] ❌ FAIL 항목 있음 — 위 로그 참조");
    }

    // 세션 정리
    await Promise.all(deptSessions.map(s => s.ctx.close()));

  } finally {
    // 반드시 원래 Phase로 복구
    if (hrPage) {
      const restored = await switchPhase(hrPage, originalPhase);
      console.log(`[C] Phase 복구 → ${originalPhase}: ${restored ? "✅" : "❌ 실패"}`);
    }
    if (hrCtx) await hrCtx.close();
    await browser.close();
  }
});
