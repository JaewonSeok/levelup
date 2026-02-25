"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────

interface GradeMap {
  2021: string | null;
  2022: string | null;
  2023: string | null;
  2024: string | null;
  2025: string | null;
}

interface ConfirmationRow {
  candidateId: string;
  confirmationId: string;
  userId: string;
  name: string;
  department: string;
  team: string;
  level: string | null;
  competencyLevel: string | null;
  yearsOfService: number | null;
  hireDate: string | null;
  pointCumulative: number;
  creditCumulative: number;
  requiredPoints: number | null;
  requiredCredits: number | null;
  competencyScore: number | null;
  competencyEval: number | null;
  reviewRecommendation: boolean | null;
  status: "PENDING" | "CONFIRMED" | "DEFERRED";
  confirmedAt: string | null;
  isSubmitted: boolean;
  grades: GradeMap;
}

interface Summary {
  pending: number;
  confirmed: number;
  deferred: number;
  submittedDeptCount: number;
}

interface ConfirmationResponse {
  employees: ConfirmationRow[];
  total: number;
  summary: Summary;
  submittedDepartments: { department: string; submittedAt: string }[];
  meta: { departments: string[]; teams: string[] };
}

// ── Constants ──────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-300 text-xs">-</span>;
  const colors: Record<string, string> = {
    S: "bg-green-100 text-green-700",
    A: "bg-blue-100 text-blue-700",
    B: "bg-amber-100 text-amber-700",
    C: "bg-orange-100 text-orange-700",
    D: "bg-red-100 text-red-700",
  };
  const cls = colors[grade.toUpperCase()] ?? "bg-gray-100 text-gray-600";
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>{grade}</span>;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "미제출",
  CONFIRMED: "확정",
  DEFERRED: "반려",
};

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  PENDING: "secondary",
  CONFIRMED: "default",
  DEFERRED: "destructive",
};

const ALLOWED_ROLES = ["CEO", "HR_TEAM", "SYSTEM_ADMIN"];

// ── Component ──────────────────────────────────────────────────

export default function ConfirmationPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? "";
  const canConfirm = role === "CEO" || role === "SYSTEM_ADMIN";
  const isAdmin = role === "SYSTEM_ADMIN";

  useEffect(() => {
    if (authStatus === "loading") return;
    if (!session) { router.replace("/login"); return; }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      router.replace("/level-management");
    }
  }, [session, authStatus, router]);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [department, setDepartment] = useState("");
  const [team, setTeam] = useState("");
  const [showAll, setShowAll] = useState(false);

  const [rows, setRows] = useState<ConfirmationRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ pending: 0, confirmed: 0, deferred: 0, submittedDeptCount: 0 });
  const [meta, setMeta] = useState<{ departments: string[]; teams: string[] }>({ departments: [], teams: [] });
  const [loading, setLoading] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    if (!ALLOWED_ROLES.includes(role)) return;

    let cancelled = false;

    async function doFetch() {
      setLoading(true);
      try {
        const sp = new URLSearchParams({ year: String(year) });
        if (department) sp.set("department", department);
        if (team) sp.set("team", team);
        if (showAll) sp.set("showAll", "true");

        const res = await fetch(`/api/confirmation?${sp}`);
        if (cancelled || !res.ok) return;
        const data: ConfirmationResponse = await res.json();
        if (cancelled) return;

        setRows(data.employees ?? []);
        setSummary(data.summary ?? { pending: 0, confirmed: 0, deferred: 0, submittedDeptCount: 0 });
        setMeta(data.meta ?? { departments: [], teams: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    doFetch();
    return () => { cancelled = true; };
  }, [year, department, team, showAll, authStatus, role]);

  // ── Handlers ──────────────────────────────────────────────

  const handleStatusChange = async (
    confirmationId: string,
    newStatus: "CONFIRMED" | "DEFERRED" | "PENDING"
  ) => {
    setChangingId(confirmationId);
    try {
      const res = await fetch(`/api/confirmation/${confirmationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "변경 실패");

      toast.success(`상태가 "${STATUS_LABEL[newStatus]}"으로 변경되었습니다.`);
      setRows((prev) =>
        prev.map((r) =>
          r.confirmationId === confirmationId
            ? { ...r, status: newStatus, confirmedAt: data.confirmedAt }
            : r
        )
      );
      setSummary((prev) => {
        const oldRow = rows.find((r) => r.confirmationId === confirmationId);
        if (!oldRow) return prev;
        const next = { ...prev };
        next[oldRow.status.toLowerCase() as keyof Omit<Summary, "submittedDeptCount">] = Math.max(
          0,
          next[oldRow.status.toLowerCase() as keyof Omit<Summary, "submittedDeptCount">] - 1
        );
        next[newStatus.toLowerCase() as keyof Omit<Summary, "submittedDeptCount">] += 1;
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "변경 중 오류가 발생했습니다.");
    } finally {
      setChangingId(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────

  if (authStatus === "loading") {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        로딩 중...
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">레벨업 확정</h1>

      {/* ── 필터 영역 ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-4 border rounded-md p-4 bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">심사 연도</span>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-sm bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">본부</span>
          <Select value={department || "__all__"} onValueChange={(v) => setDepartment(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-36 h-8 text-sm bg-white">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {meta.departments.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium whitespace-nowrap">팀</span>
          <Select value={team || "__all__"} onValueChange={(v) => setTeam(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-32 h-8 text-sm bg-white">
              <SelectValue placeholder="전체" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {meta.teams.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-sm text-muted-foreground">총 {rows.length}명</span>

        {/* showAll 토글 (CEO/SYSTEM_ADMIN 전용) */}
        {(canConfirm || isAdmin) && (
          <Button
            size="sm"
            variant={showAll ? "default" : "outline"}
            className="h-8 ml-auto"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? "제출 본부만 보기" : "전체 보기"}
          </Button>
        )}
      </div>

      {/* ── 요약 카드 ──────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="border rounded-md p-4 text-center bg-white">
          <p className="text-xs text-muted-foreground mb-1">제출 본부</p>
          <p className="text-2xl font-bold text-blue-600">{summary.submittedDeptCount}</p>
          <p className="text-xs text-muted-foreground">개</p>
        </div>
        <div className="border rounded-md p-4 text-center bg-white">
          <p className="text-xs text-muted-foreground mb-1">미제출</p>
          <p className="text-2xl font-bold text-gray-600">{summary.pending}</p>
          <p className="text-xs text-muted-foreground">명</p>
        </div>
        <div className="border rounded-md p-4 text-center bg-white">
          <p className="text-xs text-muted-foreground mb-1">확정</p>
          <p className="text-2xl font-bold text-green-600">{summary.confirmed}</p>
          <p className="text-xs text-muted-foreground">명</p>
        </div>
        <div className="border rounded-md p-4 text-center bg-white">
          <p className="text-xs text-muted-foreground mb-1">반려</p>
          <p className="text-2xl font-bold text-red-500">{summary.deferred}</p>
          <p className="text-xs text-muted-foreground">명</p>
        </div>
      </div>

      {/* ── 테이블 ─────────────────────────────────────────── */}
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-center">
              <th className="border px-2 py-2 font-medium w-10">No.</th>
              <th className="border px-2 py-2 font-medium">본부</th>
              <th className="border px-2 py-2 font-medium">팀</th>
              <th className="border px-2 py-2 font-medium">이름</th>
              <th className="border px-2 py-2 font-medium">역량레벨</th>
              <th className="border px-2 py-2 font-medium">연차</th>
              <th className="border px-2 py-2 font-medium">포인트</th>
              <th className="border px-2 py-2 font-medium">학점</th>
              {GRADE_YEARS.map((y) => (
                <th key={y} className="border px-2 py-2 font-medium text-xs text-gray-600">{y}</th>
              ))}
              <th className="border px-2 py-2 font-medium">추천여부</th>
              <th className="border px-2 py-2 font-medium">확정상태</th>
              {canConfirm && <th className="border px-2 py-2 font-medium">상태변경</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={canConfirm ? 12 + GRADE_YEARS.length : 11 + GRADE_YEARS.length} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={canConfirm ? 12 + GRADE_YEARS.length : 11 + GRADE_YEARS.length} className="text-center py-10 text-muted-foreground">
                  {showAll ? "심사 완료된 대상자가 없습니다." : "제출된 본부의 심사 대상자가 없습니다."}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const isChanging = changingId === row.confirmationId;
                const notSubmitted = !row.isSubmitted;

                return (
                  <tr
                    key={row.candidateId}
                    className={`text-center hover:bg-gray-50 ${notSubmitted ? "bg-gray-50/60" : ""}`}
                  >
                    <td className="border px-2 py-1.5 text-gray-500">{idx + 1}</td>
                    <td className="border px-2 py-1.5 text-left">
                      {row.department || "-"}
                      {notSubmitted && showAll && (
                        <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 px-1 py-0.5 rounded font-medium">미제출</span>
                      )}
                    </td>
                    <td className="border px-2 py-1.5 text-left">{row.team || "-"}</td>
                    <td className="border px-2 py-1.5 font-medium">
                      <EmployeeTooltip
                        name={row.name}
                        department={row.department}
                        team={row.team}
                        level={row.level}
                        competencyLevel={row.competencyLevel}
                        hireDate={row.hireDate}
                        yearsOfService={row.yearsOfService}
                        pointCumulative={row.pointCumulative}
                        creditCumulative={row.creditCumulative}
                      >
                        {row.name}
                      </EmployeeTooltip>
                    </td>
                    <td className="border px-2 py-1.5">{row.competencyLevel ?? row.level ?? "-"}</td>
                    <td className="border px-2 py-1.5">{row.yearsOfService ?? "-"}</td>

                    {/* 포인트: 숫자만 */}
                    <td className="border px-2 py-1.5 font-mono text-xs">
                      {row.pointCumulative.toFixed(1)}
                    </td>

                    {/* 학점: 숫자만 */}
                    <td className="border px-2 py-1.5 font-mono text-xs">
                      {row.creditCumulative.toFixed(1)}
                    </td>

                    {/* 평가등급 2021~2025 */}
                    {GRADE_YEARS.map((y) => (
                      <td key={y} className="border px-2 py-1.5 text-center">
                        <GradeBadge grade={row.grades?.[y] ?? null} />
                      </td>
                    ))}

                    {/* 추천여부 */}
                    <td className="border px-2 py-1.5">
                      {row.reviewRecommendation === true ? (
                        <span className="text-green-600 text-xs font-medium">추천</span>
                      ) : row.reviewRecommendation === false ? (
                        <span className="text-red-500 text-xs font-medium">미추천</span>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>

                    {/* 확정상태 뱃지 */}
                    <td className="border px-2 py-1.5">
                      <Badge
                        variant={STATUS_VARIANT[row.status]}
                        className="text-xs"
                      >
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </td>

                    {/* 상태변경 (CEO / SYSTEM_ADMIN) */}
                    {canConfirm && (
                      <td className="border px-2 py-1.5">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {row.status !== "CONFIRMED" && (
                            <Button
                              size="sm"
                              className="h-6 text-xs px-2 bg-green-600 hover:bg-green-700"
                              disabled={isChanging}
                              onClick={() => handleStatusChange(row.confirmationId, "CONFIRMED")}
                            >
                              확정
                            </Button>
                          )}
                          {row.status !== "DEFERRED" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs px-2 text-red-600 border-red-300 hover:bg-red-50"
                              disabled={isChanging}
                              onClick={() => handleStatusChange(row.confirmationId, "DEFERRED")}
                            >
                              반려
                            </Button>
                          )}
                          {row.status !== "PENDING" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs px-2"
                              disabled={isChanging}
                              onClick={() => handleStatusChange(row.confirmationId, "PENDING")}
                            >
                              미제출
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 범례 */}
      <div className="mt-3 text-xs text-muted-foreground">
        {!canConfirm && (
          <span className="ml-3 text-orange-600">
            * 확정/반려/미제출 상태 변경은 대표이사 또는 시스템 관리자만 가능합니다.
          </span>
        )}
        {showAll && (
          <span className="ml-3 text-gray-500">
            * 주황색 &quot;미제출&quot; 뱃지 행은 아직 본부장이 제출하지 않은 본부입니다.
          </span>
        )}
      </div>
    </div>
  );
}
