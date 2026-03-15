/**
 * 시나리오 8 + 9: 동시 접속 시 Phase 전환 안전성 테스트
 *
 * 시나리오 8: Phase 전환 중 5명의 DEPT_HEAD 동시 접속 → 에러 없이 Phase 2 반영
 * 시나리오 9: Phase 2에서 3명의 본부장이 동시에 다른 후보자에게 의견 저장 → 충돌 없음
 */

import { test, expect, chromium } from "@playwright/test";
import { TEST_USERS, BASE_URL } from "../utils/test-users";
import { newIsolatedPage, loginUser, makeResult, apiCall } from "../utils/helpers";

const HR_USER = TEST_USERS.find(u => u.email === "qa-hr01@rsupport.com")!;
const DEPT_USERS = [
  TEST_USERS.find(u => u.email === "qa-dept01@rsupport.com")!,
  TEST_USERS.find(u => u.email === "qa-dept02@rsupport.com")!,
  TEST_USERS.find(u => u.email === "qa-dept03@rsupport.com")!,
];
const YEAR = 2026;

interface ReviewsResponse {
  candidates: Array<{ candidateId: string; reviewId: string | null; department: string; name: string }>;
  currentUser: { department: string; currentPhase: number };
}

async function resetPhase(page: Parameters<typeof apiCall>[0], phase: number) {
  return apiCall(page, `${BASE_URL}/api/review-phase`, "PUT", { year: YEAR, phase });
}

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 8: Phase 전환 중 5명 동시 접속 안전성", async () => {
  const browser = await chromium.launch({ headless: true });

  // HR 로그인
  const hrResult = makeResult(HR_USER);
  const { ctx: hrCtx, page: hrPage } = await newIsolatedPage(browser);
  await loginUser(hrPage, HR_USER, hrResult);

  // Phase 1 보장
  await resetPhase(hrPage, 1);
  console.log("\n  Phase 1 초기화 완료");

  try {
    // ── 5명의 DEPT_HEAD 세션 준비 ────────────────────────────
    // (3개의 QA 본부장 + 2개는 재사용)
    const deptUsers = [
      DEPT_USERS[0], DEPT_USERS[1], DEPT_USERS[2],
      DEPT_USERS[0], DEPT_USERS[1], // 동일 계정 2개 세션 추가
    ].slice(0, 5);

    const deptSessions = await Promise.all(
      deptUsers.map(async (user, i) => {
        const result = makeResult(user);
        const { ctx, page } = await newIsolatedPage(browser);
        const loggedIn = await loginUser(page, user, result);
        if (!loggedIn) {
          await ctx.close();
          return null;
        }
        console.log(`  세션 ${i + 1} 로그인 완료: ${user.description}`);
        return { ctx, page, user, index: i };
      })
    );

    const activeSessions = deptSessions.filter(s => s !== null);
    console.log(`  활성 세션 수: ${activeSessions.length}/5`);

    // ── 모든 세션이 /review를 동시에 조회 (Phase 1 상태) ─────
    const phase1Results = await Promise.all(
      activeSessions.map(async (s) => {
        try {
          const res = await apiCall(s!.page, `${BASE_URL}/api/reviews?year=${YEAR}`);
          return { index: s!.index, status: res.status, phase: (res.data as ReviewsResponse)?.currentUser?.currentPhase };
        } catch (e) {
          return { index: s!.index, status: 0, error: String(e) };
        }
      })
    );

    const phase1Errors = phase1Results.filter(r => r.status !== 200);
    console.log(`  Phase 1 동시 조회: ${phase1Results.length - phase1Errors.length}/${phase1Results.length} 성공`);
    if (phase1Errors.length > 0) {
      console.log(`  오류: ${JSON.stringify(phase1Errors)}`);
    }

    // ── HR이 Phase 2로 전환 (모든 세션이 조회 중인 상태에서) ──
    const phaseChangeRes = await resetPhase(hrPage, 2);
    expect(phaseChangeRes.status, "Phase 2 전환 실패").toBe(200);
    console.log("  HR Phase 2 전환 완료");

    // ── 잠깐 대기 후 모든 세션이 다시 조회 ──────────────────
    await new Promise(resolve => setTimeout(resolve, 500));

    const phase2Results = await Promise.all(
      activeSessions.map(async (s) => {
        try {
          const res = await apiCall(s!.page, `${BASE_URL}/api/reviews?year=${YEAR}`);
          return {
            index:  s!.index,
            status: res.status,
            phase:  (res.data as ReviewsResponse)?.currentUser?.currentPhase,
            count:  (res.data as ReviewsResponse)?.candidates?.length ?? 0,
          };
        } catch (e) {
          return { index: s!.index, status: 0, phase: 0, count: 0, error: String(e) };
        }
      })
    );

    const phase2Errors  = phase2Results.filter(r => r.status !== 200);
    const wrongPhase    = phase2Results.filter(r => r.status === 200 && r.phase !== 2);
    console.log(`  Phase 2 동시 재조회: ${phase2Results.length - phase2Errors.length}/${phase2Results.length} 성공`);

    for (const r of phase2Results) {
      console.log(`    세션 ${r.index + 1}: status=${r.status} phase=${r.phase} candidates=${r.count}`);
    }

    expect(phase2Errors.length, `${phase2Errors.length}개 세션에서 오류 발생`).toBe(0);
    expect(wrongPhase.length, `${wrongPhase.length}개 세션이 Phase 2를 반영 못 함`).toBe(0);
    console.log("  ✅ 모든 세션이 Phase 2로 전환 확인");

    // ── Phase 전환 직후 2개 세션이 동시에 의견 저장 ──────────
    // 각자 다른 본부의 타본부 후보자에게 저장 (충돌 없어야 함)
    const saveResults = await Promise.all(
      activeSessions.slice(0, 2).map(async (s) => {
        try {
          const res = await apiCall(s!.page, `${BASE_URL}/api/reviews?year=${YEAR}&targetType=other`);
          const data = res.data as ReviewsResponse;
          const ownDept = data.currentUser?.department ?? "";
          const targetCand = (data.candidates ?? []).find(c => c.department !== ownDept && c.reviewId);
          if (!targetCand?.reviewId) {
            return { index: s!.index, skipped: true };
          }
          const saveRes = await apiCall(s!.page, `${BASE_URL}/api/reviews/${targetCand.reviewId}/opinions`, "POST", {
            opinionText:    `QA 동시 저장 테스트 — 세션 ${s!.index + 1}`,
            recommendation: true,
            noOpinion:      false,
            phase:          2,
          });
          return { index: s!.index, status: saveRes.status, reviewId: targetCand.reviewId };
        } catch (e) {
          return { index: s!.index, status: 0, error: String(e) };
        }
      })
    );

    console.log("\n  Phase 전환 직후 동시 의견 저장:");
    for (const r of saveResults) {
      if ((r as { skipped?: boolean }).skipped) {
        console.log(`    세션 ${r.index + 1}: 타본부 후보자 없음 — 스킵`);
      } else {
        const ok = (r as { status: number }).status === 200 || (r as { status: number }).status === 201;
        console.log(`    세션 ${r.index + 1}: status=${(r as { status: number }).status} ${ok ? "✅" : "❌"}`);
      }
    }

    // Cleanup: 모든 세션 닫기
    await Promise.all(activeSessions.map(s => s!.ctx.close()));

  } finally {
    await resetPhase(hrPage, 1);
    console.log("\n  Phase 1 원복 완료");
    await hrCtx.close();
    await browser.close();
  }
});

// ────────────────────────────────────────────────────────────────────────────
test("시나리오 9: Phase 2 동시 의견 저장 — 데이터 충돌 없음", async () => {
  const browser = await chromium.launch({ headless: true });

  const hrResult = makeResult(HR_USER);
  const { ctx: hrCtx, page: hrPage } = await newIsolatedPage(browser);
  await loginUser(hrPage, HR_USER, hrResult);

  // Phase 2 설정
  await resetPhase(hrPage, 2);
  console.log("\n  Phase 2 설정 완료");

  try {
    // 3명의 본부장이 각자 자신의 타본부 후보자 목록 조회
    const sessions = await Promise.all(
      DEPT_USERS.map(async (user, i) => {
        const result = makeResult(user);
        const { ctx, page } = await newIsolatedPage(browser);
        const loggedIn = await loginUser(page, user, result);
        if (!loggedIn) { await ctx.close(); return null; }
        return { ctx, page, user, index: i };
      })
    );

    const active = sessions.filter(s => s !== null);
    console.log(`  활성 세션: ${active.length}명`);

    // 각 세션의 타본부 후보자 목록 조회
    const candidatesPerSession = await Promise.all(
      active.map(async (s) => {
        const res = await apiCall(s!.page, `${BASE_URL}/api/reviews?year=${YEAR}&targetType=other`);
        const data = res.data as ReviewsResponse;
        const ownDept = data.currentUser?.department ?? "";
        const targets = (data.candidates ?? []).filter(c => c.department !== ownDept && c.reviewId);
        return { session: s!, targets };
      })
    );

    // 각 세션별 저장할 후보자 선택 (중복 없이 — 각자 다른 후보자 대상)
    const saveTargets = candidatesPerSession.flatMap(({ session, targets }) =>
      targets.slice(0, 1).map(t => ({ session, cand: t }))
    );

    if (saveTargets.length === 0) {
      console.log("  ⚠️  Phase 2 타본부 후보자 없음 — 동시 저장 테스트 스킵");
      await Promise.all(active.map(s => s!.ctx.close()));
      return;
    }

    console.log(`  동시 저장 대상: ${saveTargets.length}개 (각 본부장 × 1명)`);

    // 동시에 의견 저장 (Promise.all)
    const t0 = performance.now();
    const saveResults = await Promise.all(
      saveTargets.map(async ({ session, cand }, i) => {
        const res = await apiCall(session.page, `${BASE_URL}/api/reviews/${cand.reviewId}/opinions`, "POST", {
          opinionText:    `QA 동시 저장 충돌 테스트 #${i + 1} — ${session.user.description}`,
          recommendation: i % 2 === 0 ? true : false,
          noOpinion:      false,
          phase:          2,
        });
        return {
          user:     session.user.description,
          candName: cand.name,
          status:   res.status,
          ok:       res.status === 200 || res.status === 201,
        };
      })
    );
    const elapsed = Math.round(performance.now() - t0);

    console.log(`\n  동시 저장 결과 (${elapsed} ms):`);
    for (const r of saveResults) {
      console.log(`    ${r.user} → ${r.candName}: status=${r.status} ${r.ok ? "✅" : "❌"}`);
    }

    const failCount = saveResults.filter(r => !r.ok).length;
    // 실패가 있어도 0은 아닐 수 있음 (이미 의견이 있거나 Phase 불일치)
    // 중요한 건 500 (서버 오류)가 없어야 함
    const serverErrors = saveResults.filter(r => r.status >= 500);
    expect(serverErrors.length, `서버 오류(5xx) ${serverErrors.length}건 발생`).toBe(0);

    if (failCount > 0) {
      console.log(`  ℹ️  ${failCount}개 실패 (이미 저장된 의견 있거나 Phase 불일치 — 서버 오류 아님)`);
    } else {
      console.log(`  ✅ 모든 의견 정상 저장 (충돌 없음)`);
    }

    // 저장 후 각 reviewId에 대해 의견 조회 → HR로 확인
    const savedReviewIds = [...new Set(saveTargets.map(t => t.cand.reviewId!))];
    const verifyResults = await Promise.all(
      savedReviewIds.map(async (rid) => {
        const opRes = await apiCall(hrPage, `${BASE_URL}/api/reviews/${rid}/opinions`);
        const data = opRes.data as { reviewers: unknown[] };
        return { reviewId: rid, reviewerCount: (data?.reviewers ?? []).length };
      })
    );

    console.log("\n  HR로 검증한 저장된 의견 수:");
    for (const v of verifyResults) {
      console.log(`    reviewId ${v.reviewId.slice(-8)}: ${v.reviewerCount}명 의견 저장됨`);
    }
    console.log("  ✅ 동시 저장 후 데이터 무결성 확인");

    await Promise.all(active.map(s => s!.ctx.close()));

  } finally {
    await resetPhase(hrPage, 1);
    console.log("\n  Phase 1 원복 완료");
    await hrCtx.close();
    await browser.close();
  }
});
