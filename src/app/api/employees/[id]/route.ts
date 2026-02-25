import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role, Level, EmploymentType } from "@prisma/client";

// ── PUT /api/employees/[id] (SYSTEM_ADMIN only) ──────────────────
// Body: { name?, department?, team?, level?, position?, employmentType?,
//         hireDate?, resignDate?, isActive?, competencyLevel?, yearsOfService?, levelUpYear? }
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "시스템 관리자만 수정할 수 있습니다." }, { status: 403 });
  }

  const { id } = params;

  let body: {
    name?: string;
    department?: string;
    team?: string;
    level?: string | null;
    position?: string | null;
    employmentType?: string | null;
    hireDate?: string | null;
    resignDate?: string | null;
    isActive?: boolean;
    competencyLevel?: string | null;
    yearsOfService?: number | null;
    levelUpYear?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.department !== undefined) updateData.department = body.department;
  if (body.team !== undefined) updateData.team = body.team;
  if (body.level !== undefined) {
    updateData.level =
      body.level && Object.values(Level).includes(body.level as Level)
        ? (body.level as Level)
        : null;
  }
  if (body.position !== undefined) updateData.position = body.position;
  if (body.employmentType !== undefined) {
    updateData.employmentType =
      body.employmentType &&
      Object.values(EmploymentType).includes(body.employmentType as EmploymentType)
        ? (body.employmentType as EmploymentType)
        : null;
  }
  if (body.hireDate !== undefined) {
    updateData.hireDate = body.hireDate ? new Date(body.hireDate) : null;
  }
  if (body.resignDate !== undefined) {
    updateData.resignDate = body.resignDate ? new Date(body.resignDate) : null;
  }
  if (body.isActive !== undefined) updateData.isActive = body.isActive;
  if (body.competencyLevel !== undefined) updateData.competencyLevel = body.competencyLevel;
  if (body.yearsOfService !== undefined) updateData.yearsOfService = body.yearsOfService;
  if (body.levelUpYear !== undefined) updateData.levelUpYear = body.levelUpYear;

  const updated = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      department: true,
      team: true,
      level: true,
      position: true,
      employmentType: true,
      hireDate: true,
      resignDate: true,
      competencyLevel: true,
      yearsOfService: true,
      levelUpYear: true,
      isActive: true,
      role: true,
    },
  });

  return NextResponse.json({ success: true, employee: updated });
}

// ── DELETE /api/employees/[id] (SYSTEM_ADMIN only) — soft delete ──
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.user.role !== Role.SYSTEM_ADMIN) {
    return NextResponse.json({ error: "시스템 관리자만 삭제할 수 있습니다." }, { status: 403 });
  }

  const { id } = params;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  }

  await prisma.user.update({
    where: { id },
    data: {
      isActive: false,
      resignDate: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
