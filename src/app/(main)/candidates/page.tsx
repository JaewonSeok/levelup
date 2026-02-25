"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/management/Pagination";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";

// ── Types ──────────────────────────────────────────────────────

interface GradeMap {
  2021: string | null;
  2022: string | null;
  2023: string | null;
  2024: string | null;
  2025: string | null;
}

interface CandidateRow {
  candidateId: string;
  userId: string;
  name: string;
  department: string;
  team: string;
  level: string | null;
  position: string | null;
  employmentType: string | null;
  hireDate: string | null;
  yearsOfService: number | null;
  competencyLevel: string | null;
  pointCumulative: number;
  creditCumulative: number;
  pointMet: boolean;
  creditMet: boolean;
  source: string;
  grades: GradeMap;
}

type MeetType = "all" | "point" | "credit" | "both";

interface Query {
  year: number;
  meetType: MeetType;
  department: string;
  team: string;
  keyword: string;
  position: string;
  hireDateFrom: string;
  hireDateTo: string;
}

// ── Constants ──────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

// ── Grade badge ────────────────────────────────────────────────

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-300 text-xs">-</span>;
  const colors: Record<string, string> = {
    S: "bg-amber-100 text-[#b8860b]",
    A: "bg-green-100 text-green-700",
    B: "bg-gray-100 text-gray-600",
    C: "bg-orange-100 text-orange-700",
    O: "bg-blue-100 text-blue-700",
    E: "bg-green-100 text-green-700",
    G: "bg-gray-100 text-gray-600",
    N: "bg-orange-100 text-orange-700",
    U: "bg-red-100 text-red-700",
  };
  const cls = colors[grade.toUpperCase()] ?? "bg-gray-100 text-gray-600";
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>{grade}</span>;
}

const defaultQuery: Query = {
  year: CURRENT_YEAR,
  meetType: "both",
  department: "",
  team: "",
  keyword: "",
  position: "",
  hireDateFrom: "",
  hireDateTo: "",
};

// ── Component ──────────────────────────────────────────────────

export default function CandidatesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "SYSTEM_ADMIN";

  // Applied query (triggers fetch on change)
  const [query, setQuery] = useState<Query>(defaultQuery);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Draft state for the search form
  const [advDraft, setAdvDraft] = useState({
    department: "",
    team: "",
    keyword: "",
    meetType: "both" as MeetType,
    position: "",
    hireDateFrom: "",
    hireDateTo: "",
  });

  // Server data
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [meta, setMeta] = useState<{ departments: string[]; teams: string[] }>({
    departments: [],
    teams: [],
  });
  const [loading, setLoading] = useState(false);

  // Admin: add candidate modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    department: "",
    team: "",
    name: "",
    level: "",
    yearsOfService: "",
    hireDate: "",
    pointCumulative: "",
    creditCumulative: "",
  });
  const [addSubmitting, setAddSubmitting] = useState(false);

  // Admin: delete candidate
  const [deleteTarget, setDeleteTarget] = useState<{ candidateId: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Admin: auto-select
  const [autoSelectConfirmOpen, setAutoSelectConfirmOpen] = useState(false);
  const [autoSelecting, setAutoSelecting] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function doFetch() {
      setLoading(true);
      try {
        const sp = new URLSearchParams({
          year: String(query.year),
          meetType: query.meetType,
          department: query.department,
          team: query.team,
          keyword: query.keyword,
          position: query.position,
          hireDateFrom: query.hireDateFrom,
          hireDateTo: query.hireDateTo,
          page: String(page),
          pageSize: String(pageSize),
        });

        const res = await fetch(`/api/candidates?${sp}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        setRows(data.employees ?? []);
        setTotal(data.total ?? 0);
        setTotalPages(data.totalPages ?? 0);
        setMeta(data.meta ?? { departments: [], teams: [] });

      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    doFetch();
    return () => {
      cancelled = true;
    };
  }, [query, page]);

  // ── Search handlers ────────────────────────────────────────

  const handleAdvancedSearch = () => {
    setQuery({
      year: query.year,
      meetType: advDraft.meetType,
      department: advDraft.department,
      team: advDraft.team,
      keyword: advDraft.keyword,
      position: advDraft.position,
      hireDateFrom: advDraft.hireDateFrom,
      hireDateTo: advDraft.hireDateTo,
    });
    setPage(1);
  };

  const handleYearChange = (y: number) => {
    setQuery((prev) => ({ ...prev, year: y }));
    setPage(1);
  };

  // ── Admin handlers ─────────────────────────────────────────

  const handleAddCandidate = async () => {
    const { department, team, name, level, yearsOfService, hireDate } = addForm;
    if (!department || !team || !name || !level || !hireDate) {
      toast.error("필수 항목을 모두 입력해주세요.");
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: query.year,
          name: name.trim(),
          department: department.trim(),
          team: team.trim(),
          level,
          hireDate,
          yearsOfService: yearsOfService ? Number(yearsOfService) : undefined,
          pointCumulative: addForm.pointCumulative ? Number(addForm.pointCumulative) : undefined,
          creditCumulative: addForm.creditCumulative ? Number(addForm.creditCumulative) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "추가 실패");
      toast.success("대상자가 추가되었습니다.");
      setAddModalOpen(false);
      setAddForm({ department: "", team: "", name: "", level: "", yearsOfService: "", hireDate: "", pointCumulative: "", creditCumulative: "" });
      setQuery((q) => ({ ...q }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "추가 중 오류가 발생했습니다.");
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleDeleteCandidate = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/candidates/${deleteTarget.candidateId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      toast.success("대상자가 삭제되었습니다.");
      setDeleteTarget(null);
      setQuery((q) => ({ ...q }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const handleAutoSelect = async () => {
    setAutoSelecting(true);
    try {
      const res = await fetch("/api/candidates/auto-select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: query.year }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "자동 선정 실패");
      toast.success(`${data.added}명의 대상자가 자동 선정되었습니다. (총 충족 ${data.total}명)`);
      setAutoSelectConfirmOpen(false);
      setQuery((q) => ({ ...q }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "자동 선정 중 오류가 발생했습니다.");
    } finally {
      setAutoSelecting(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "-";
    return iso.slice(0, 10);
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">레벨업 대상자 관리</h1>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={() => setAutoSelectConfirmOpen(true)}
            >
              자동 선정
            </Button>
            <Button size="sm" onClick={() => setAddModalOpen(true)}>
              + 대상자 추가
            </Button>
          </div>
        )}
      </div>

      {/* Year selector */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium">심사 연도</span>
        <Select
          value={String(query.year)}
          onValueChange={(v) => handleYearChange(Number(v))}
        >
          <SelectTrigger className="w-28 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}년
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          총 {total}명 · 포인트 또는 학점 충족 직원
        </span>
      </div>

      {/* ── 검색 영역: 상세 조회 ────────────────────────── */}
      <div className="border rounded-md p-4 mb-4 bg-gray-50">
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">본부</span>
            <Select
              value={advDraft.department || "__all__"}
              onValueChange={(v) =>
                setAdvDraft((prev) => ({
                  ...prev,
                  department: v === "__all__" ? "" : v,
                  team: "",
                }))
              }
            >
              <SelectTrigger className="w-36 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {meta.departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">팀</span>
            <Select
              value={advDraft.team || "__all__"}
              onValueChange={(v) =>
                setAdvDraft((prev) => ({
                  ...prev,
                  team: v === "__all__" ? "" : v,
                }))
              }
            >
              <SelectTrigger className="w-32 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {meta.teams.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">직책</span>
            <Select
              value={advDraft.position || "__all__"}
              onValueChange={(v) =>
                setAdvDraft((prev) => ({
                  ...prev,
                  position: v === "__all__" ? "" : v,
                }))
              }
            >
              <SelectTrigger className="w-24 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {["팀원", "팀장", "실장", "본부장"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">입사일자</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advDraft.hireDateFrom}
              onChange={(e) =>
                setAdvDraft((prev) => ({ ...prev, hireDateFrom: e.target.value }))
              }
            />
            <span className="text-sm text-muted-foreground">~</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advDraft.hireDateTo}
              onChange={(e) =>
                setAdvDraft((prev) => ({ ...prev, hireDateTo: e.target.value }))
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">검색어</span>
            <Input
              className="w-40 bg-white h-8 text-sm"
              value={advDraft.keyword}
              onChange={(e) =>
                setAdvDraft((prev) => ({ ...prev, keyword: e.target.value }))
              }
              onKeyDown={(e) => e.key === "Enter" && handleAdvancedSearch()}
              placeholder="이름 검색"
            />
          </div>

          <MeetTypeRadio
            name="adv-meetType"
            value={advDraft.meetType}
            onChange={(v) =>
              setAdvDraft((prev) => ({ ...prev, meetType: v as MeetType }))
            }
          />

          <Button
            onClick={handleAdvancedSearch}
            disabled={loading}
            size="sm"
            className="h-8"
          >
            검색
          </Button>
        </div>
      </div>

      {/* ── 테이블 ────────────────────────────────────────── */}
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
              <th className="border px-2 py-2 font-medium">입사일</th>
              <th className="border px-2 py-2 font-medium">포인트</th>
              <th className="border px-2 py-2 font-medium">충족여부</th>
              <th className="border px-2 py-2 font-medium">학점</th>
              <th className="border px-2 py-2 font-medium">충족여부</th>
              {GRADE_YEARS.map((y) => (
                <th key={y} className="border px-2 py-2 font-medium text-xs text-gray-600">{y}</th>
              ))}
              {isAdmin && <th className="border px-2 py-2 font-medium w-10">삭제</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={isAdmin ? 12 + GRADE_YEARS.length : 11 + GRADE_YEARS.length} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 12 + GRADE_YEARS.length : 11 + GRADE_YEARS.length} className="text-center py-10 text-muted-foreground">
                  충족 조건을 만족하는 직원이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const rowNum = (page - 1) * pageSize + idx + 1;

                return (
                  <tr key={row.candidateId} className="text-center hover:bg-gray-50">
                    <td className="border px-2 py-1.5 text-gray-500">{rowNum}</td>
                    <td className="border px-2 py-1.5 text-left">{row.department || "-"}</td>
                    <td className="border px-2 py-1.5 text-left">{row.team || "-"}</td>
                    <td className="border px-2 py-1.5 font-medium">
                      <div className="flex items-center gap-1.5 justify-center">
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
                        <span className={`text-xs px-1 py-0.5 rounded font-medium ${row.source === "auto" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {row.source === "auto" ? "자동" : "수동"}
                        </span>
                      </div>
                    </td>
                    <td className="border px-2 py-1.5">
                      {row.competencyLevel ?? row.level ?? "-"}
                    </td>
                    <td className="border px-2 py-1.5">
                      {row.yearsOfService ?? "-"}
                    </td>
                    <td className="border px-2 py-1.5">{formatDate(row.hireDate)}</td>

                    {/* 포인트 */}
                    <td
                      className={`border px-2 py-1.5 font-mono ${
                        !row.pointMet ? "text-red-600 font-semibold" : ""
                      }`}
                    >
                      {row.pointCumulative.toFixed(1)}
                    </td>
                    <td className="border px-2 py-1.5">
                      <Badge
                        variant={row.pointMet ? "default" : "destructive"}
                        className="text-xs px-1.5 py-0.5"
                      >
                        {row.pointMet ? "충족" : "미충족"}
                      </Badge>
                    </td>

                    {/* 학점 */}
                    <td
                      className={`border px-2 py-1.5 font-mono ${
                        !row.creditMet ? "text-red-600 font-semibold" : ""
                      }`}
                    >
                      {row.creditCumulative.toFixed(1)}
                    </td>
                    <td className="border px-2 py-1.5">
                      <Badge
                        variant={row.creditMet ? "default" : "destructive"}
                        className="text-xs px-1.5 py-0.5"
                      >
                        {row.creditMet ? "충족" : "미충족"}
                      </Badge>
                    </td>

                    {/* 평가등급 2021~2025 */}
                    {GRADE_YEARS.map((y) => (
                      <td key={y} className="border px-2 py-1.5 text-center">
                        <GradeBadge grade={row.grades?.[y] ?? null} />
                      </td>
                    ))}

                    {/* 삭제 (admin) */}
                    {isAdmin && (
                      <td className="border px-2 py-1.5 text-center">
                        <button
                          className="p-1 hover:bg-red-50 rounded text-red-500"
                          onClick={() => setDeleteTarget({ candidateId: row.candidateId, name: row.name })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        loading={loading}
        onPageChange={(p) => setPage(p)}
      />

      {/* ── 대상자 추가 모달 (admin) ──────────────────────── */}
      <Dialog open={addModalOpen} onOpenChange={(o) => !o && setAddModalOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>대상자 수동 추가</DialogTitle>
            <DialogDescription>
              {query.year}년 심사 대상자에 직원 정보를 직접 입력하여 추가합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {/* 본부 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">본부 <span className="text-red-500">*</span></label>
              <Select value={addForm.department || "__none__"} onValueChange={(v) => setAddForm((f) => ({ ...f, department: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">선택</SelectItem>
                  {meta.departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* 팀 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">팀 <span className="text-red-500">*</span></label>
              <Input className="h-8 text-sm" placeholder="팀명 입력" value={addForm.team} onChange={(e) => setAddForm((f) => ({ ...f, team: e.target.value }))} />
            </div>
            {/* 이름 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">이름 <span className="text-red-500">*</span></label>
              <Input className="h-8 text-sm" placeholder="성명 입력" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            {/* 레벨 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">레벨 <span className="text-red-500">*</span></label>
              <Select value={addForm.level || "__none__"} onValueChange={(v) => setAddForm((f) => ({ ...f, level: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">선택</SelectItem>
                  {["L1", "L2", "L3", "L4", "L5"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* 연차 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">연차</label>
              <Input className="h-8 text-sm" type="number" min={0} placeholder="숫자 입력" value={addForm.yearsOfService} onChange={(e) => setAddForm((f) => ({ ...f, yearsOfService: e.target.value }))} />
            </div>
            {/* 입사일 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">입사일 <span className="text-red-500">*</span></label>
              <input type="date" className="w-full h-8 border rounded px-2 text-sm bg-white" value={addForm.hireDate} onChange={(e) => setAddForm((f) => ({ ...f, hireDate: e.target.value }))} />
            </div>
            {/* 포인트 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">포인트 누적 (선택)</label>
              <Input className="h-8 text-sm" type="number" step="0.1" min={0} placeholder="숫자 입력" value={addForm.pointCumulative} onChange={(e) => setAddForm((f) => ({ ...f, pointCumulative: e.target.value }))} />
            </div>
            {/* 학점 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">학점 누적 (선택)</label>
              <Input className="h-8 text-sm" type="number" step="0.1" min={0} placeholder="숫자 입력" value={addForm.creditCumulative} onChange={(e) => setAddForm((f) => ({ ...f, creditCumulative: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setAddModalOpen(false)} disabled={addSubmitting}>취소</Button>
            <Button onClick={handleAddCandidate} disabled={addSubmitting}>
              {addSubmitting ? "추가 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 자동 선정 확인 다이얼로그 (admin) ────────────────── */}
      <Dialog open={autoSelectConfirmOpen} onOpenChange={(o) => !o && setAutoSelectConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>대상자 자동 선정</DialogTitle>
            <DialogDescription>
              {query.year}년 기준 설정을 기반으로 포인트 또는 학점을 충족한 직원을
              대상자로 자동 선정합니다.
              <br />
              기존 대상자는 덮어쓰지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutoSelectConfirmOpen(false)} disabled={autoSelecting}>
              취소
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleAutoSelect}
              disabled={autoSelecting}
            >
              {autoSelecting ? "선정 중..." : "자동 선정 실행"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 대상자 삭제 확인 (admin) ───────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>대상자 삭제</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.name}</strong>을(를) 심사 대상자에서 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDeleteCandidate} disabled={deleting}>
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── MeetTypeRadio ──────────────────────────────────────────────

function MeetTypeRadio({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = [
    { v: "all", label: "전체" },
    { v: "point", label: "포인트" },
    { v: "credit", label: "학점" },
    { v: "both", label: "포인트&학점" },
  ];

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium whitespace-nowrap">충족</span>
      {options.map(({ v, label }) => (
        <label key={v} className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          <span className="text-sm">{label}</span>
        </label>
      ))}
    </div>
  );
}
