import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Role } from "@prisma/client";
import { generateUploadTemplate } from "@/lib/excel/template";

const ALLOWED_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// [보안] 인증 추가 — 이전에는 누구나 템플릿 다운로드 가능했음
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }

  try {
    const buffer = generateUploadTemplate();

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="levelup_upload_template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // [보안] e.message 제거 — 내부 에러 정보 클라이언트 노출 방지
    console.error("[upload/template] error:", e);
    return NextResponse.json({ error: "템플릿 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
