/**
 * 대상자 관리 수정 v2
 * 1. 김채린 → source="excluded" candidate 레코드 생성 (페이지에서 숨김)
 * 2. 응용개발팀 최승훈B → 이름 "최승훈" 원복 + 2026 candidate 삭제
 * 3. 웹개발1팀 최승훈B → 2026 특진 candidate 등록
 * 4. 최종 2026 대상자 목록 출력
 *
 * 실행: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/fix-candidates-v2.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const YEAR = 2026;

async function main() {
  console.log("=".repeat(65));
  console.log("대상자 관리 수정 v2");
  console.log("=".repeat(65));

  // ── 1. 김채린: excluded 레코드로 페이지에서 숨김 ─────────────
  console.log("\n[1] 김채린 제외 처리");

  const kcrUsers = await prisma.user.findMany({
    where: { name: "김채린" },
    select: { id: true, name: true, department: true, team: true, level: true },
  });

  if (kcrUsers.length === 0) {
    console.log("  ⚠️  '김채린' 없음");
  } else {
    for (const u of kcrUsers) {
      console.log(`  대상: ${u.name} (${u.level ?? "-"}, ${u.department}/${u.team})`);
      const existing = await prisma.candidate.findUnique({
        where: { userId_year: { userId: u.id, year: YEAR } },
        select: { id: true, source: true },
      });

      if (existing) {
        await prisma.candidate.update({
          where: { userId_year: { userId: u.id, year: YEAR } },
          data: { source: "excluded" },
        });
        console.log(`  ✅ 기존 레코드 source → excluded`);
      } else {
        // 레코드가 없으면 excluded로 생성 → 페이지 자동 필터에서 숨겨짐
        await prisma.candidate.create({
          data: {
            userId: u.id,
            year: YEAR,
            pointMet: false,
            creditMet: false,
            isReviewTarget: false,
            source: "excluded",
            promotionType: "normal",
          },
        });
        console.log(`  ✅ excluded 레코드 신규 생성 (자동 표시 방지)`);
      }
    }
  }

  // ── 2. 응용개발팀 "최승훈B" → 이름 원복 + candidate 삭제 ──────
  console.log("\n[2] 응용개발팀 최승훈B → 이름 '최승훈' 원복 + candidate 삭제");

  const wrongChoi = await prisma.user.findFirst({
    where: { name: "최승훈B", department: "연구개발본부", team: "응용개발팀" },
    select: { id: true, name: true, department: true, team: true, level: true },
  });

  if (!wrongChoi) {
    console.log("  ℹ️  연구개발본부/응용개발팀의 '최승훈B' 없음 — 이미 처리됐거나 원래 없었음");
    // 혹시 '최승훈'으로 존재하는지 확인
    const orig = await prisma.user.findFirst({
      where: { name: "최승훈", department: "연구개발본부", team: "응용개발팀" },
      select: { id: true, name: true, department: true, team: true, level: true },
    });
    if (orig) {
      console.log(`  ℹ️  '최승훈'(L4, 응용개발팀) 이름 이미 원복됨 — candidate만 삭제 시도`);
      const candDel = await prisma.candidate.findUnique({
        where: { userId_year: { userId: orig.id, year: YEAR } },
        select: { id: true },
      });
      if (candDel) {
        await prisma.candidate.delete({ where: { userId_year: { userId: orig.id, year: YEAR } } });
        console.log(`  ✅ 응용개발팀 최승훈 2026 candidate 삭제`);
      } else {
        console.log(`  ℹ️  응용개발팀 최승훈 2026 candidate 없음`);
      }
    }
  } else {
    // 이름 원복
    await prisma.user.update({
      where: { id: wrongChoi.id },
      data: { name: "최승훈" },
    });
    console.log(`  ✅ 이름 변경: '최승훈B' → '최승훈' (${wrongChoi.level}, 응용개발팀)`);

    // candidate 삭제
    const candDel = await prisma.candidate.findUnique({
      where: { userId_year: { userId: wrongChoi.id, year: YEAR } },
      select: { id: true },
    });
    if (candDel) {
      await prisma.candidate.delete({ where: { userId_year: { userId: wrongChoi.id, year: YEAR } } });
      console.log(`  ✅ 응용개발팀 2026 candidate 삭제`);
    }
  }

  // ── 3. 웹개발1팀 "최승훈B" → 2026 특진 등록 ──────────────────
  console.log("\n[3] 웹개발1팀 최승훈B → 2026 특진 등록");

  const correctChoi = await prisma.user.findFirst({
    where: { name: "최승훈B", department: "연구개발본부", team: "웹개발1팀" },
    select: { id: true, name: true, department: true, team: true, level: true, isActive: true },
  });

  if (!correctChoi) {
    console.log("  ❌ 연구개발본부/웹개발1팀의 '최승훈B' 없음 — 직원 데이터 확인 필요");
    // 전체 최승훈 계열 출력
    const all = await prisma.user.findMany({
      where: { name: { startsWith: "최승훈" } },
      select: { id: true, name: true, department: true, team: true, level: true, isActive: true },
    });
    console.log("  현재 최승훈 계열 직원:");
    for (const u of all) console.log(`    ${u.name} | ${u.level} | ${u.department}/${u.team} | active=${u.isActive}`);
  } else {
    console.log(`  대상: ${correctChoi.name} (${correctChoi.level ?? "-"}, ${correctChoi.department}/${correctChoi.team}) active=${correctChoi.isActive}`);

    const result = await prisma.candidate.upsert({
      where: { userId_year: { userId: correctChoi.id, year: YEAR } },
      create: {
        userId: correctChoi.id,
        year: YEAR,
        pointMet: true,
        creditMet: true,
        isReviewTarget: true,
        source: "auto",
        promotionType: "special",
      },
      update: {
        isReviewTarget: true,
        source: "auto",
        promotionType: "special",
        pointMet: true,
        creditMet: true,
      },
    });
    console.log(`  ✅ 웹개발1팀 최승훈B — 2026 특진 candidate 등록 (id=${result.id.slice(-8)})`);
  }

  // ── 4. 최종 2026 대상자 목록 ───────────────────────────────────
  console.log("\n" + "=".repeat(65));
  console.log(`[최종] ${YEAR}년 대상자 전체 목록 (excluded 제외)`);
  console.log("=".repeat(65));

  const finalList = await prisma.candidate.findMany({
    where: { year: YEAR, source: { not: "excluded" } },
    orderBy: [{ user: { department: "asc" } }, { user: { name: "asc" } }],
    select: {
      id: true,
      source: true,
      promotionType: true,
      isReviewTarget: true,
      pointMet: true,
      creditMet: true,
      user: { select: { name: true, department: true, team: true, level: true } },
    },
  });

  console.log(`총 ${finalList.length}명\n`);
  const header = `${"No.".padEnd(4)} ${"이름".padEnd(8)} ${"레벨".padEnd(4)} ${"본부".padEnd(16)} ${"팀".padEnd(14)} ${"구분".padEnd(6)} ${"심사대상"}`;
  console.log(header);
  console.log("-".repeat(header.length + 10));

  for (let i = 0; i < finalList.length; i++) {
    const c = finalList[i];
    const badge = c.promotionType === "special" ? "⚡특진" : "일반  ";
    console.log(
      `${String(i + 1).padEnd(4)} ${c.user.name.padEnd(8)} ${(c.user.level ?? "-").padEnd(4)} ${c.user.department.padEnd(16)} ${c.user.team.padEnd(14)} ${badge} ${c.isReviewTarget ? "✅" : "-"}`
    );
  }

  // excluded 목록도 별도 출력
  const excluded = await prisma.candidate.findMany({
    where: { year: YEAR, source: "excluded" },
    select: { user: { select: { name: true, department: true } } },
  });
  if (excluded.length > 0) {
    console.log(`\n제외(excluded): ${excluded.map(e => e.user.name).join(", ")}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  prisma.$disconnect();
  process.exit(1);
});
