import { NextResponse } from "next/server";
import { generateUploadTemplate } from "@/lib/excel/template";

export async function GET() {
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
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `템플릿 생성 실패: ${msg}` },
      { status: 500 }
    );
  }
}
