import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import fs from "fs";
import path from "path";

const ALLOWED_ROLES: Role[] = [Role.CEO, Role.HR_TEAM, Role.SYSTEM_ADMIN];
const EDIT_ROLES: Role[] = [Role.HR_TEAM, Role.SYSTEM_ADMIN];

// ── GET /api/candidate-notes?candidateId=xxx ─────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const candidateId = searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId가 필요합니다." }, { status: 400 });

  const note = await prisma.candidateNote.findUnique({ where: { candidateId } });
  return NextResponse.json({ note });
}

// ── POST /api/candidate-notes ─────────────────────────────────────
// Body: { candidateId, noteText?, fileUrl?, fileName? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role)) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  let body: { candidateId?: string; noteText?: string | null; fileUrl?: string | null; fileName?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const { candidateId, noteText, fileUrl, fileName } = body;
  if (!candidateId) return NextResponse.json({ error: "candidateId가 필요합니다." }, { status: 400 });

  // 기존 파일 교체 시 이전 파일 삭제
  if (fileUrl !== undefined) {
    const existing = await prisma.candidateNote.findUnique({ where: { candidateId } });
    if (existing?.fileUrl && existing.fileUrl !== fileUrl) {
      try {
        const oldPath = path.join(process.cwd(), "public", existing.fileUrl);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch { /* silent */ }
    }
  }

  const note = await prisma.candidateNote.upsert({
    where: { candidateId },
    create: {
      candidateId,
      noteText: noteText ?? null,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      updatedBy: session.user.id,
    },
    update: {
      noteText: noteText ?? null,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      updatedBy: session.user.id,
    },
  });

  return NextResponse.json({ success: true, note });
}

// ── DELETE /api/candidate-notes?candidateId=xxx ───────────────────
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role)) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const candidateId = searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId가 필요합니다." }, { status: 400 });

  const existing = await prisma.candidateNote.findUnique({ where: { candidateId } });
  if (!existing) return NextResponse.json({ success: true }); // 이미 없으면 성공

  // 첨부파일 삭제
  if (existing.fileUrl) {
    try {
      const filePath = path.join(process.cwd(), "public", existing.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* silent */ }
  }

  await prisma.candidateNote.delete({ where: { candidateId } });
  return NextResponse.json({ success: true });
}
