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
  // 서버 콘솔에서 로딩 여부 확인용 (key 값은 노출하지 않음)
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

  // 등급 이력 문자열화
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
  const nextLevel = nextLevelMap[level] ?? "상위 레벨";

  const prompt = `당신은 인사 전문가입니다. 아래 직원의 승진 심사를 위한 객관적 분석 리포트를 작성해주세요.

## 직원 정보
- 소속: ${ed.department ?? "-"} / ${ed.team ?? "-"}
- 현재 레벨: ${level}
- 승진 대상 레벨: ${nextLevel}
- 연차: ${ed.yearsOfService ?? "-"}년
- 구분: ${ed.promotionType === "special" ? "특진 (체류연수 미달)" : "일반 (체류연수 충족)"}

## 평가 데이터
- 연도별 등급: ${gradeHistory}
- 포인트: ${ed.finalPoints ?? ed.pointCumulative ?? "-"} (기준: ${ed.requiredPoints ?? "-"})
- 학점: ${ed.creditScore ?? ed.creditCumulative ?? "-"} (기준: ${ed.requiredCredits ?? "-"})
- 체류연수: ${ed.yearsOfService ?? "-"}년 (기준: ${ed.minTenure ?? "-"}년)
- AI 적합도 점수: ${aiScore?.totalScore ?? "-"}/100 (${aiScore?.grade ?? "-"}등급)
- AI 세부 점수: 성과추세 ${aiScore?.trendScore ?? "-"}, 포인트초과 ${aiScore?.pointsExcessScore ?? "-"}, 학점초과 ${aiScore?.creditsExcessScore ?? "-"}, 안정성 ${aiScore?.stabilityScore ?? "-"}, 성숙도 ${aiScore?.maturityScore ?? "-"}

## 동일 레벨 대비
- 동일 레벨 평균 포인트: ${ed.sameLevelAvgPoints != null ? Number(ed.sameLevelAvgPoints).toFixed(1) : "-"}
- 동일 레벨 평균 학점: ${ed.sameLevelAvgCredits != null ? Number(ed.sameLevelAvgCredits).toFixed(1) : "-"}

## 작성 요청
아래 형식으로 간결하게 작성해주세요 (각 항목 2~3문장):

1. **성과 추이 분석**: 최근 평가등급의 변화 패턴과 의미
2. **강점**: 데이터에서 드러나는 이 직원의 강점
3. **발전 영역**: 승진 후 주의가 필요한 부분
4. **동료 대비 위치**: 동일 레벨 직원 대비 객관적 위치
5. **종합 의견**: 승진 적합성에 대한 종합적 판단 (3~4문장)

주의: 추천/비추천을 직접 하지 마세요. 객관적 데이터 분석만 제공하세요.
개인 이름은 "해당 직원"으로 지칭하세요.`;

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
        max_tokens: 1024,
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
