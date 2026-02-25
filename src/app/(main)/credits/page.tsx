"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  SearchAreas,
  type AdvancedSearchState,
} from "@/components/management/SearchAreas";
import { Pagination } from "@/components/management/Pagination";

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface YearData {
  score: number | null;
  isAutoFill: boolean;
  isRetroactive: boolean;
}

interface EmployeeCredit {
  id: string;
  name: string;
  department: string;
  team: string;
  level: string | null;
  position: string | null;
  employmentType: string | null;
  hireDate: string | null;
  yearsOfService: number | null;
  competencyLevel: string | null;
  levelUpYear: number | null;
  isActive: boolean;
  startYear: number;
  yearData: Record<string, YearData>;
  cumulative: number;
  isMet: boolean;
}

interface CreditsResponse {
  employees: EmployeeCredit[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  yearColumns: number[];
  currentYear: number;
  meta: { departments: string[]; teams: string[] };
}

interface EditState {
  employee: EmployeeCredit;
  yearScores: Record<number, string>;
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const PAGE_SIZE = 20;
const LEVELS = ["L1", "L2", "L3", "L4", "L5"] as const;

interface AddEmployeeForm {
  name: string;
  department: string;
  team: string;
  level: string;
  yearsOfService: string;
  hireDate: string;
  credit2022: string;
  credit2023: string;
  credit2024: string;
  credit2025: string;
}

const DEFAULT_ADVANCED: AdvancedSearchState = {
  department: "",
  team: "",
  keyword: "",
  isMet: "all",
  position: "",
  level: "",
  employmentType: "",
  hireDateFrom: "",
  hireDateTo: "",
};

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function numVal(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  } catch {
    return "-";
  }
}

function buildQuery(
  params: Record<string, string | number | boolean>,
  page: number
): string {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== "" && val !== false && val !== "all") {
      q.set(key, String(val));
    }
  }
  q.set("page", String(page));
  q.set("pageSize", String(PAGE_SIZE));
  return q.toString();
}

// ─────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────

export default function CreditsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.role === "SYSTEM_ADMIN";

  // ── 권한 체크 ────────────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.replace("/login"); return; }
    const role = session.user.role;
    if (role !== "HR_TEAM" && role !== "SYSTEM_ADMIN") {
      router.replace("/level-management");
    }
  }, [session, status, router]);

  // ── 드롭다운 옵션 ─────────────────────────────────────────
  const [departments, setDepartments] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // ── 검색 상태 ─────────────────────────────────────────────
  const [advanced, setAdvanced] = useState<AdvancedSearchState>(DEFAULT_ADVANCED);
  const [lastParams, setLastParams] = useState<Record<string, string | number | boolean>>({});

  // ── 결과 ─────────────────────────────────────────────────
  const [employees, setEmployees] = useState<EmployeeCredit[]>([]);
  const [yearColumns, setYearColumns] = useState<number[]>([]);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 편집 모달 ─────────────────────────────────────────────
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── 연도 추가/삭제 (admin) ────────────────────────────────
  const [newYear, setNewYear] = useState<string>("");
  const [newYearScore, setNewYearScore] = useState<string>("");
  const [deletingYear, setDeletingYear] = useState<number | null>(null);

  // ── 직원 추가 모달 ────────────────────────────────────────
  const DEFAULT_ADD_FORM: AddEmployeeForm = {
    name: "", department: "", team: "", level: "", yearsOfService: "",
    hireDate: "", credit2022: "", credit2023: "", credit2024: "", credit2025: "",
  };
  const [addEmpOpen, setAddEmpOpen] = useState(false);
  const [addEmpForm, setAddEmpForm] = useState<AddEmployeeForm>(DEFAULT_ADD_FORM);
  const [addEmpSaving, setAddEmpSaving] = useState(false);

  async function handleAddEmployee() {
    if (!addEmpForm.name || !addEmpForm.department || !addEmpForm.team) {
      toast.error("이름, 본부, 팀은 필수입니다.");
      return;
    }
    setAddEmpSaving(true);
    try {
      const res = await fetch("/api/credits/add-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addEmpForm.name,
          department: addEmpForm.department,
          team: addEmpForm.team,
          level: addEmpForm.level || null,
          yearsOfService: addEmpForm.yearsOfService !== "" ? Number(addEmpForm.yearsOfService) : null,
          hireDate: addEmpForm.hireDate || null,
          credit2022: addEmpForm.credit2022 !== "" ? Number(addEmpForm.credit2022) : null,
          credit2023: addEmpForm.credit2023 !== "" ? Number(addEmpForm.credit2023) : null,
          credit2024: addEmpForm.credit2024 !== "" ? Number(addEmpForm.credit2024) : null,
          credit2025: addEmpForm.credit2025 !== "" ? Number(addEmpForm.credit2025) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      toast.success("직원이 추가되었습니다.");
      setAddEmpOpen(false);
      setAddEmpForm(DEFAULT_ADD_FORM);
      fetchCredits(lastParams, 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setAddEmpSaving(false);
    }
  }

  // ── 데이터 페치 ──────────────────────────────────────────
  const fetchCredits = useCallback(
    async (params: Record<string, string | number | boolean>, targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/credits?${buildQuery(params, targetPage)}`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? "데이터 조회 실패");
        }
        const data: CreditsResponse = await res.json();
        setEmployees(data.employees);
        setYearColumns(data.yearColumns);
        setCurrentYear(data.currentYear);
        setTotal(data.total);
        setPage(data.page);
        setTotalPages(data.totalPages);
        if (data.meta.departments.length > 0) setDepartments(data.meta.departments);
        if (data.meta.teams.length > 0) setTeams(data.meta.teams);
      } catch (e) {
        setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (
      status === "authenticated" &&
      (session?.user.role === "HR_TEAM" || session?.user.role === "SYSTEM_ADMIN")
    ) {
      fetchCredits({}, 1);
    }
  }, [status, session, fetchCredits]);

  // ── 검색 핸들러 ──────────────────────────────────────────
  function handleAdvancedSearch() {
    const params = {
      department: advanced.department,
      team: advanced.team,
      keyword: advanced.keyword,
      isMet: advanced.isMet,
      position: advanced.position,
      level: advanced.level,
      employmentType: advanced.employmentType,
      hireDateFrom: advanced.hireDateFrom,
      hireDateTo: advanced.hireDateTo,
    };
    setLastParams(params);
    fetchCredits(params, 1);
  }

  // ── 편집 모달 열기 ────────────────────────────────────────
  function openEdit(emp: EmployeeCredit) {
    const yearScores: Record<number, string> = {};
    for (const yr of yearColumns) {
      const d = emp.yearData[yr];
      if (d) {
        yearScores[yr] = d.score !== null ? String(d.score) : d.isAutoFill ? "2" : "";
      } else {
        yearScores[yr] = "";
      }
    }
    setEditState({ employee: emp, yearScores });
    setSaveError(null);
  }

  // ── 편집 계산 ─────────────────────────────────────────────
  const editCalc = useMemo(() => {
    if (!editState) return 0;
    return Object.entries(editState.yearScores)
      .filter(([yr]) => Number(yr) >= editState.employee.startYear)
      .reduce((s, [, v]) => s + numVal(v), 0);
  }, [editState]);

  // ── 연도 삭제 (admin) ─────────────────────────────────────
  async function handleDeleteYear(yr: number) {
    if (!editState) return;
    setDeletingYear(yr);
    try {
      const res = await fetch(
        `/api/credits?userId=${editState.employee.id}&year=${yr}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      toast.success(`${yr}년 학점 데이터가 삭제되었습니다.`);
      setEditState((prev) => {
        if (!prev) return null;
        const newYearScores = { ...prev.yearScores };
        delete newYearScores[yr];
        return { ...prev, yearScores: newYearScores };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingYear(null);
    }
  }

  // ── 연도 추가 (admin) ─────────────────────────────────────
  function handleAddYear() {
    const yr = Number(newYear);
    if (!newYear || isNaN(yr) || yr < 2021 || yr > 2100) {
      toast.error("2021년 이상의 유효한 연도를 입력하세요.");
      return;
    }
    if (!editState) return;
    if (editState.yearScores[yr] !== undefined) {
      toast.error("이미 존재하는 연도입니다.");
      return;
    }
    setEditState((prev) =>
      prev
        ? {
            ...prev,
            yearScores: {
              ...prev.yearScores,
              [yr]: newYearScore !== "" ? newYearScore : "0",
            },
          }
        : null
    );
    setNewYear("");
    setNewYearScore("");
  }

  // ── 저장 ─────────────────────────────────────────────────
  async function handleSave() {
    if (!editState) return;
    setSaving(true);
    setSaveError(null);

    const emp = editState.employee;
    const yearScores: { year: number; score: number }[] = [];
    for (const [yrStr, val] of Object.entries(editState.yearScores)) {
      const yr = Number(yrStr);
      // SYSTEM_ADMIN can save years outside the normal range
      if (!isAdmin && yr < emp.startYear) continue;
      if (val !== "") yearScores.push({ year: yr, score: numVal(val) });
    }

    try {
      const res = await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: emp.id, yearScores }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "저장 실패");
      }
      const result = await res.json();

      // 테이블 낙관적 업데이트
      setEmployees((prev) =>
        prev.map((e) => {
          if (e.id !== emp.id) return e;
          const newYearData = { ...e.yearData };
          for (const ys of yearScores) {
            newYearData[ys.year] = {
              score: ys.score,
              isAutoFill: false,
              isRetroactive: ys.year < 2025,
            };
          }
          return {
            ...e,
            yearData: newYearData,
            cumulative: result.cumulative,
            isMet: result.isMet,
          };
        })
      );
      setEditState(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  // ── 접근 권한 로딩 중 ─────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
        로딩 중...
      </div>
    );
  }
  if (
    session &&
    session.user.role !== "HR_TEAM" &&
    session.user.role !== "SYSTEM_ADMIN"
  ) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-red-600">
        인사팀만 접근할 수 있습니다.
      </div>
    );
  }

  // ─────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">레벨업 학점 관리</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">
            2025년부터 도입 — 이전 연도 동일 기준 소급 적용
          </span>
          <Button size="sm" variant="outline" onClick={() => { setAddEmpForm(DEFAULT_ADD_FORM); setAddEmpOpen(true); }}>
            + 직원 추가
          </Button>
        </div>
      </div>

      {/* ── 공통 검색 영역 ────────────────────────────────── */}
      <SearchAreas
        departments={departments}
        teams={teams}
        advanced={advanced}
        onAdvancedChange={(patch) => setAdvanced((prev) => ({ ...prev, ...patch }))}
        onAdvancedSearch={handleAdvancedSearch}
        loading={loading}
      />

      {/* ── 오류 ─────────────────────────────────────────────── */}
      {error && (
        <div className="text-red-600 text-sm mb-4 p-3 bg-red-50 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* ── 결과 건수 ─────────────────────────────────────────── */}
      <div className="text-sm text-muted-foreground mb-2">
        총 <span className="font-semibold text-foreground">{total.toLocaleString()}</span>명
      </div>

      {/* ── 결과 테이블 ───────────────────────────────────────── */}
      <div className="border rounded-md overflow-auto">
        <Table style={{ minWidth: `${720 + yearColumns.length * 72}px` }}>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 text-center text-xs sticky left-0 bg-muted/40">
                No.
              </TableHead>
              <TableHead className="text-xs">본부</TableHead>
              <TableHead className="text-xs">팀</TableHead>
              <TableHead className="text-xs">이름</TableHead>
              <TableHead className="text-xs">역량레벨</TableHead>
              <TableHead className="text-center text-xs">연차</TableHead>
              {/* ★ 포인트 관리에 없는 입사일 컬럼 */}
              <TableHead className="text-xs whitespace-nowrap">입사일</TableHead>
              {yearColumns.map((yr) => (
                <TableHead
                  key={yr}
                  className={`text-center text-xs ${
                    yr === currentYear
                      ? "text-blue-600"
                      : yr < 2025
                        ? "text-gray-500"
                        : ""
                  }`}
                >
                  {yr}년
                  {yr < 2025 && (
                    <span className="block text-[9px] font-normal text-gray-400">소급</span>
                  )}
                </TableHead>
              ))}
              {/* ★ 포인트 관리에 있는 상점/벌점 없음 */}
              <TableHead className="text-center text-xs font-bold">누적</TableHead>
              <TableHead className="text-center text-xs">충족</TableHead>
              <TableHead className="text-center text-xs">편집</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={7 + yearColumns.length + 3}
                  className="text-center py-16 text-muted-foreground text-sm"
                >
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7 + yearColumns.length + 3}
                  className="text-center py-16 text-muted-foreground text-sm"
                >
                  검색 결과가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp, idx) => (
                <TableRow key={emp.id} className="hover:bg-muted/20">
                  <TableCell className="text-center text-xs text-muted-foreground sticky left-0 bg-white">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </TableCell>
                  <TableCell className="text-sm">{emp.department || "-"}</TableCell>
                  <TableCell className="text-sm">{emp.team || "-"}</TableCell>
                  <TableCell className="text-sm font-medium">
                    <EmployeeTooltip
                      name={emp.name}
                      department={emp.department}
                      team={emp.team}
                      level={emp.level}
                      competencyLevel={emp.competencyLevel}
                      hireDate={emp.hireDate}
                      yearsOfService={emp.yearsOfService}
                      creditCumulative={emp.cumulative}
                    >
                      {emp.name}
                    </EmployeeTooltip>
                  </TableCell>
                  <TableCell className="text-sm">
                    {emp.competencyLevel || emp.level || "-"}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {emp.yearsOfService ?? "-"}
                  </TableCell>
                  {/* 입사일 셀 */}
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(emp.hireDate)}
                  </TableCell>

                  {/* 연도별 학점 셀 */}
                  {yearColumns.map((yr) => {
                    const d = emp.yearData[yr];
                    const isInRange = yr >= emp.startYear;

                    if (!isInRange) {
                      return (
                        <TableCell
                          key={yr}
                          className="text-center text-xs text-muted-foreground/30"
                        >
                          -
                        </TableCell>
                      );
                    }

                    // 신규입사 자동부여
                    if (d?.isAutoFill) {
                      return (
                        <TableCell
                          key={yr}
                          className="text-center text-sm text-red-500 italic bg-red-50/40"
                          title="신규입사 자동부여 (G기준 2점)"
                        >
                          {d.score}
                          <span className="text-[10px] ml-0.5">*</span>
                        </TableCell>
                      );
                    }

                    if (!d || d.score === null) {
                      return (
                        <TableCell
                          key={yr}
                          className={`text-center text-xs text-muted-foreground ${
                            yr === currentYear ? "bg-blue-50/30" : ""
                          }`}
                        >
                          -
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={yr}
                        className={`text-center text-sm ${
                          yr < 2025
                            ? "text-gray-600 bg-gray-50/50"
                            : yr === currentYear
                              ? "bg-blue-50/30"
                              : ""
                        }`}
                      >
                        {d.score}
                      </TableCell>
                    );
                  })}

                  <TableCell className="text-center text-sm font-bold">
                    {emp.cumulative.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={emp.isMet ? "default" : "outline"}
                      className="text-xs"
                    >
                      {emp.isMet ? "충족" : "미충족"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => openEdit(emp)}
                    >
                      수정
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── 공통 페이지네이션 ────────────────────────────────── */}
      <Pagination
        page={page}
        totalPages={totalPages}
        loading={loading}
        onPageChange={(p) => fetchCredits(lastParams, p)}
      />

      {/* ── 편집 모달 ─────────────────────────────────────────── */}
      <Dialog open={!!editState} onOpenChange={(open) => !open && setEditState(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              학점 수정 —{" "}
              <span className="text-primary">{editState?.employee.name}</span>
              <span className="text-sm font-normal text-muted-foreground ml-2">
                {editState?.employee.competencyLevel ?? editState?.employee.level ?? ""}
                {editState?.employee.yearsOfService != null &&
                  ` (연차 ${editState.employee.yearsOfService})`}
              </span>
            </DialogTitle>
          </DialogHeader>

          {editState && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {editState.employee.department} › {editState.employee.team} · 입사일{" "}
                {formatDate(editState.employee.hireDate)}
              </div>

              <Separator />

              {/* 연도별 학점 입력 */}
              <div>
                <h3 className="text-sm font-semibold mb-3">연도별 학점</h3>
                <div className="grid grid-cols-3 gap-3">
                  {Object.keys(editState.yearScores)
                    .map(Number)
                    .sort((a, b) => a - b)
                    .map((yr) => {
                      const d = editState.employee.yearData[yr];
                      const isAutoFill = d?.isAutoFill ?? false;
                      const isCurrent = yr === currentYear;
                      const isRetro = yr < 2025;

                      return (
                        <div key={yr}>
                          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                            {yr}년
                            {isAutoFill && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded">
                                자동부여
                              </span>
                            )}
                            {isRetro && !isAutoFill && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded">
                                소급
                              </span>
                            )}
                            {isCurrent && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">
                                현재
                              </span>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                className="ml-auto text-red-500 hover:text-red-700 disabled:opacity-40"
                                title="해당 연도 삭제"
                                disabled={deletingYear === yr}
                                onClick={() => handleDeleteYear(yr)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </label>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            className="h-8 text-sm"
                            value={editState.yearScores[yr] ?? ""}
                            onChange={(e) =>
                              setEditState((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      yearScores: { ...prev.yearScores, [yr]: e.target.value },
                                    }
                                  : null
                              )
                            }
                            placeholder="-"
                          />
                        </div>
                      );
                    })}
                </div>

                {/* 연도 추가 (admin) */}
                {isAdmin && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs text-muted-foreground mb-2">연도 추가</p>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        className="h-7 w-24 text-xs"
                        placeholder="연도"
                        value={newYear}
                        onChange={(e) => setNewYear(e.target.value)}
                      />
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        className="h-7 w-20 text-xs"
                        placeholder="점수"
                        value={newYearScore}
                        onChange={(e) => setNewYearScore(e.target.value)}
                      />
                      <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddYear}>
                        추가
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 누적 미리보기 */}
              <div className="bg-muted/40 rounded-md p-3 text-sm flex justify-between items-center">
                <span className="text-muted-foreground">예상 누적 학점</span>
                <span className="font-bold text-lg">{editCalc.toFixed(1)}</span>
              </div>

              {/* 안내 */}
              <div className="text-xs bg-blue-50 text-blue-700 rounded p-2 border border-blue-200 space-y-0.5">
                <p>* 2025년부터 도입된 제도로, 이전 연도 학점은 2025년 기준을 소급 적용합니다.</p>
                {Object.values(editState.employee.yearData).some((d) => d.isAutoFill) && (
                  <p className="text-red-600">
                    * 자동부여 항목은 신규입사자의 입사 전 레벨 체류 연도(G기준 2점)입니다.
                  </p>
                )}
              </div>

              {saveError && (
                <div className="text-red-600 text-sm p-2 bg-red-50 rounded">{saveError}</div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 범례 */}
      <div className="mt-3 text-xs text-muted-foreground flex gap-4 flex-wrap">
        <span>
          <span className="inline-block w-3 h-3 bg-red-50 border border-red-200 rounded mr-1 align-middle" />
          *: 신규입사 자동부여 (G기준 2점)
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-gray-50 border rounded mr-1 align-middle" />
          소급: 2025년 기준 이전 연도 적용
        </span>
        <span>
          <span className="inline-block w-3 h-3 bg-blue-50 border rounded mr-1 align-middle" />
          파란 열: 현재 연도
        </span>
      </div>

      {/* ── 직원 추가 모달 ─────────────────────────────────────── */}
      <Dialog open={addEmpOpen} onOpenChange={(o) => !o && setAddEmpOpen(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>직원 추가 (학점)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">이름 *</label>
                <Input className="h-8" value={addEmpForm.name} onChange={(e) => setAddEmpForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">본부 *</label>
                <Select value={addEmpForm.department || "__none__"} onValueChange={(v) => setAddEmpForm((p) => ({ ...p, department: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">팀 *</label>
                <Input className="h-8" value={addEmpForm.team} onChange={(e) => setAddEmpForm((p) => ({ ...p, team: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">레벨</label>
                <Select value={addEmpForm.level || "__none__"} onValueChange={(v) => setAddEmpForm((p) => ({ ...p, level: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">연차</label>
                <Input className="h-8" type="number" min="0" value={addEmpForm.yearsOfService} onChange={(e) => setAddEmpForm((p) => ({ ...p, yearsOfService: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">입사일</label>
                <Input className="h-8" type="date" value={addEmpForm.hireDate} onChange={(e) => setAddEmpForm((p) => ({ ...p, hireDate: e.target.value }))} />
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">연도별 학점</p>
              <div className="grid grid-cols-4 gap-2">
                {([2022, 2023, 2024, 2025] as const).map((yr) => {
                  const key = `credit${yr}` as keyof AddEmployeeForm;
                  return (
                    <div key={yr}>
                      <label className="text-xs text-muted-foreground block mb-1">{yr}년</label>
                      <Input
                        className="h-7 text-xs"
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="0"
                        value={addEmpForm[key] as string}
                        onChange={(e) => setAddEmpForm((p) => ({ ...p, [key]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddEmpOpen(false)} disabled={addEmpSaving}>취소</Button>
            <Button onClick={handleAddEmployee} disabled={addEmpSaving}>
              {addEmpSaving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
