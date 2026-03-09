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
  // [보안] API 키 길이 로그 제거 — 런타임 로그에 키 메타데이터 노출 방지
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

  // [보안] Prompt Injection 방어 — 사용자 입력값을 프롬프트에 삽입 전 위험 문자 제거
  function sanitizeForPrompt(value: unknown): string {
    if (value == null) return "-";
    const str = String(value).slice(0, 200); // 최대 200자 제한
    // 프롬프트 구조를 깨는 마크다운/특수 패턴 제거
    return str.replace(/#+\s/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  const grades = ed.grades as Record<string, string | null> | undefined;
  // 등급은 허용 목록으로만 필터링 (S/A/B/C/O/E/G/N/U)
  const VALID_GRADES = new Set(["S", "A", "B", "C", "O", "E", "G", "N", "U"]);

  // 등급 레이블: AI가 의미를 오해하지 않도록 설명 포함
  const GRADE_LABEL: Record<string, string> = {
    // 신규 등급 (2025~)
    O: "O(탁월, A수준)",
    E: "E(우수, B+수준)",
    G: "G(양호, B수준)",
    N: "N(개선필요, B-수준)",
    U: "U(미흡, C수준)",
    // 기존 등급 (~2024)
    S: "S(최우수)",
    A: "A(우수)",
    B: "B(양호)",
    C: "C(미흡)",
  };

  const gradeHistory = grades
    ? Object.entries(grades)
        .filter(([, v]) => v && VALID_GRADES.has(v))
        .map(([k, v]) => `${Number(k)}년: ${GRADE_LABEL[v!] ?? v}`)
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

  const VALID_LEVELS = new Set(["L0", "L1", "L2", "L3", "L4", "L5"]);
  const nextLevelMap: Record<string, string> = {
    L0: "L1", L1: "L2", L2: "L3", L3: "L4", L4: "L5",
  };
  // [보안] Prompt Injection 방어 — 숫자형 데이터는 Number() 캐스팅, 문자열은 sanitizeForPrompt 처리
  const rawLevel = String(ed.level ?? "");
  const level = VALID_LEVELS.has(rawLevel) ? rawLevel : "-";
  const nextLevel = nextLevelMap[level] ?? "최고 레벨";
  const yearsOfService = Number(ed.yearsOfService) || 0;
  const promotionType = ed.promotionType === "special" ? "special" : "normal";
  const finalPoints = Number(ed.finalPoints ?? ed.pointCumulative) || 0;
  const requiredPoints = Number(ed.requiredPoints) || 0;
  const creditScore = Number(ed.creditScore ?? ed.creditCumulative) || 0;
  const requiredCredits = Number(ed.requiredCredits) || 0;
  const minTenure = Number(ed.minTenure) || 0;
  const sameLevelAvgPoints = ed.sameLevelAvgPoints != null ? Number(ed.sameLevelAvgPoints).toFixed(1) : "-";
  const sameLevelAvgCredits = ed.sameLevelAvgCredits != null ? Number(ed.sameLevelAvgCredits).toFixed(1) : "-";

  // 소속/팀은 문자열이므로 sanitizeForPrompt로 위험 패턴 제거
  const safeDepartment = sanitizeForPrompt(ed.department);
  const safeTeam = sanitizeForPrompt(ed.team);

  const prompt = `당신은 인사 평가 전문가입니다. 아래 직원의 레벨업 심사를 위한 객관적 분석 리포트를 작성해주세요.

## 평가 등급 체계 안내 (반드시 숙지)

이 조직은 2025년부터 새로운 평가 등급 체계를 도입했습니다. 두 체계를 혼동하지 마세요.

### 기존 등급 (2024년 이전)
A(우수) > B(양호) > C(미흡) — 알파벳 순서 = 등급 순서

### 신규 등급 (2025년~)
O(탁월) > E(우수) > G(양호) > N(개선필요) > U(미흡)

### 등급 간 대응 관계
- O = A 수준 (탁월)
- E = B+ 수준 (우수)
- G = B 수준 (양호)
- N = B- 수준 (개선필요)
- U = C 수준 (미흡)

### 등급 변화 해석 시 주의사항
- 알파벳 순서로 비교하지 마세요. 반드시 위 서열 기준으로 해석하세요.
- 2024년 B → 2025년 E: "하락"이 아니라 "상승"입니다 (B → B+수준)
- 2024년 B → 2025년 G: "변동 없음"입니다 (B → B수준)
- 2024년 A → 2025년 E: "소폭 하락"입니다 (A → B+수준)
- 2024년 A → 2025년 O: "동일 수준 유지"입니다 (A → A수준)

## 직원 정보
- 소속: ${safeDepartment} / ${safeTeam}
- 현재 레벨: ${level}
- 레벨업 목표 레벨: ${nextLevel}
- 재직기간: ${yearsOfService}년
- 심사유형: ${promotionType === "special" ? "특별심사 (재직기간 단축 적용)" : "일반심사 (재직기간 충족)"}

## 정량적 데이터
- 연도별 성과등급: ${gradeHistory}
- 포인트: ${finalPoints} (기준: ${requiredPoints})
- 학점: ${creditScore} (기준: ${requiredCredits})
- 재직기간: ${yearsOfService}년 (기준: ${minTenure}년)
- AI 종합점수: ${Number(aiScore?.totalScore) || "-"}/100 (${aiScore?.grade ?? "-"}등급)
- AI 세부 점수: 성과추이 ${Number(aiScore?.trendScore) || "-"}, 포인트초과분 ${Number(aiScore?.pointsExcessScore) || "-"}, 학점초과 ${Number(aiScore?.creditsExcessScore) || "-"}, 안정성 ${Number(aiScore?.stabilityScore) || "-"}, 성숙도 ${Number(aiScore?.maturityScore) || "-"}

## 동일 레벨 비교
- 동일 레벨 평균 포인트: ${sameLevelAvgPoints}
- 동일 레벨 평균 학점: ${sameLevelAvgCredits}

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
    // [보안] String(error) 제거 — 스택트레이스/API 에러 상세 클라이언트 노출 방지
    console.error("[ai-report] error:", error);
    return NextResponse.json({ error: "AI 리포트 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
