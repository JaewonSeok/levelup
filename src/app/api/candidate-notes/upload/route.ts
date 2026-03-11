import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Role } from "@prisma/client";
import fs from "fs";
import path from "path";
import os from "os";

const EDIT_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// ── POST /api/candidate-notes/upload ─────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role)) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  // formData 파싱 실패 시 JSON 오류 반환
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "파일 업로드 파싱에 실패했습니다." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  if (!ALLOWED_MIME.has(file.type) && !/\.(pdf|xlsx|xls|jpg|jpeg|png|gif|webp)$/i.test(file.name)) {
    return NextResponse.json({ error: "허용되지 않는 파일 형식입니다. (PDF, Excel, 이미지만 가능)" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "파일 크기는 10MB 이하여야 합니다." }, { status: 400 });
  }

  // arrayBuffer 변환 실패 대비
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "파일 읽기에 실패했습니다." }, { status: 500 });
  }

  const ext = path.extname(file.name);
  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;

  // public/uploads/notes 에 저장 시도. 실패 시 os.tmpdir() 폴백
  let savedPath: string;
  let fileUrl: string;

  const publicDir = path.join(process.cwd(), "public", "uploads", "notes");
  try {
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    savedPath = path.join(publicDir, uniqueName);
    fs.writeFileSync(savedPath, buffer);
    fileUrl = `/uploads/notes/${uniqueName}`;
  } catch (fsErr) {
    // public 디렉터리 쓰기 실패 시 (서버리스 환경 등) os.tmpdir() 폴백
    console.error("[upload] public/ 저장 실패, tmpdir 폴백:", fsErr);
    try {
      const tmpDir = path.join(os.tmpdir(), "candidate-notes");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      savedPath = path.join(tmpDir, uniqueName);
      fs.writeFileSync(savedPath, buffer);
      // tmpdir에 저장된 파일은 static URL이 없으므로 API 경유 URL 사용
      fileUrl = `/api/candidate-notes/file/${uniqueName}`;
    } catch (tmpErr) {
      console.error("[upload] tmpdir 저장도 실패:", tmpErr);
      return NextResponse.json({ error: "파일 저장에 실패했습니다. 서버 환경을 확인해주세요." }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    fileUrl,
    fileName: file.name,
  });
}
