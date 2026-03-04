import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Role } from "@prisma/client";

const ALLOWED_ROLES: Role[] = [
  Role.DEPT_HEAD,
  Role.HR_TEAM,
  Role.CEO,
  Role.SYSTEM_ADMIN,
];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log("[ai-report] ANTHROPIC_API_KEY loaded:", !!apiKey, "| length:", apiKey?.length ?? 0);
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. 서버를 재시작해주세요." },
      { status: 500 }
    );
  }

  let body: { employeeData?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const ed = body.employeeData;
  if (!ed) {
    return NextResponse.json({ error: "employeeData가 필요합니다." }, { status: 400 });
  }

  const grades = ed.grades as Record<string, string | null> | undefined;
  const gradeHistory = grades
    ? Object.entries(grades)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}년: ${v}`)
        .join(", ")
    : "정보 없음";

  const aiScore = ed.aiScore as {
    totalScore?: number;
    trendScore?: number;
    pointsExcessScore?: number;
    creditsExcessScore?: number;
    stabilityScore?: number;
    maturityScore?: number;
    grade?: string;
    details?: string[];
  } | undefined;

  const nextLevelMap: Record<string, string> = {
    L0: "L1", L1: "L2", L2: "L3", L3: "L4", L4: "L5",
  };
  const level = String(ed.level ?? "");
  const nextLevel = nextLevelMap[level] ?? "최고 레벨";

  const prompt = `당신은 인사 평가 전문가입니다. 아래 직원의 레벨업 심사를 위한 객관적 분석 리포트를 작성해주세요.

## 직원 정보
- 소속: ${ed.department ?? "-"} / ${ed.team ?? "-"}
- 현재 레벨: ${level}
- 레벨업 목표 레벨: ${nextLevel}
- 재직기간: ${ed.yearsOfService ?? "-"}년
- 심사유형: ${ed.promotionType === "special" ? "특별심사 (재직기간 단축 적용)" : "일반심사 (재직기간 충족)"}

## 정량적 데이터
- 연도별 성과등급: ${gradeHistory}
- 포인트: ${ed.finalPoints ?? ed.pointCumulative ?? "-"} (기준: ${ed.requiredPoints ?? "-"})
- 학점: ${ed.creditScore ?? ed.creditCumulative ?? "-"} (기준: ${ed.requiredCredits ?? "-"})
- 재직기간: ${ed.yearsOfService ?? "-"}년 (기준: ${ed.minTenure ?? "-"}년)
- AI 종합점수: ${aiScore?.totalScore ?? "-"}/100 (${aiScore?.grade ?? "-"}등급)
- AI 세부 점수: 성과추이 ${aiScore?.trendScore ?? "-"}, 포인트초과분 ${aiScore?.pointsExcessScore ?? "-"}, 학점초과 ${aiScore?.creditsExcessScore ?? "-"}, 안정성 ${aiScore?.stabilityScore ?? "-"}, 성숙도 ${aiScore?.maturityScore ?? "-"}

## 동일 레벨 비교
- 동일 레벨 평균 포인트: ${ed.sameLevelAvgPoints != null ? Number(ed.sameLevelAvgPoints).toFixed(1) : "-"}
- 동일 레벨 평균 학점: ${ed.sameLevelAvgCredits != null ? Number(ed.sameLevelAvgCredits).toFixed(1) : "-"}

## 작성 형식
아래 항목으로 구분하여 작성해주세요 (각 항목 2~3문단):

1. **성과 추이 분석**: 최근 연도별 성과등급의 흐름과 의미
2. **강점**: 데이터에서 두드러지는 해당 직원의 강점
3. **발전 방향**: 레벨업 이후 성장이 필요한 역량
4. **동료 대비 위치**: 동일 레벨 직원 대비 위치 평가
5. **종합 의견**: 레벨업 적합성에 대한 종합적 의견 (3~4문단)

주의: 직함/직책명을 직접 쓰지 말고, 데이터에 기반한 객관적 평가를 해주세요.
대상 직원 표현은 "해당 직원"으로 일컬어 주세요.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-report] Anthropic API error:", errText);
      return NextResponse.json(
        { error: `AI API 오류: ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const report = (data.content as Array<{ type: string; text: string }>)
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    return NextResponse.json({ report });
  } catch (error) {
    console.error("[ai-report] error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
