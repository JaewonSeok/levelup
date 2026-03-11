import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Role } from "@prisma/client";
import fs from "fs";
import path from "path";

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

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  if (!ALLOWED_MIME.has(file.type) && !/\.(pdf|xlsx|xls|jpg|jpeg|png|gif|webp)$/i.test(file.name)) {
    return NextResponse.json({ error: "허용되지 않는 파일 형식입니다. (PDF, Excel, 이미지만 가능)" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "파일 크기는 10MB 이하여야 합니다." }, { status: 400 });
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "notes");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const ext = path.extname(file.name);
  const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(uploadsDir, uniqueName);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return NextResponse.json({
    success: true,
    fileUrl: `/uploads/notes/${uniqueName}`,
    fileName: file.name,
  });
}
