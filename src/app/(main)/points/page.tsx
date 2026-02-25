"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";
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
import { Separator } from "@/components/ui/separator";
import {
  SearchAreas,
  type AdvancedSearchState,
} from "@/components/management/SearchAreas";
import { Pagination } from "@/components/management/Pagination";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface YearData {
  score: number | null;
  isAutoFill: boolean;
}

interface GradeMap {
  2021: string | null;
  2022: string | null;
  2023: string | null;
  2024: string | null;
  2025: string | null;
}

interface EmployeePoint {
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
  totalMerit: number;
  totalPenalty: number;
  cumulative: number;
  isMet: boolean;
  creditCumulative: number;
  grades: GradeMap;
}

// ─────────────────────────────────────────
// 평가등급 뱃지
// ─────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  // S: 공통 (금색)
  S: "bg-amber-100 text-[#b8860b]",
  // 2022~2024 등급
  A: "bg-green-100 text-green-700",
  B: "bg-gray-100 text-gray-600",
  C: "bg-orange-100 text-orange-700",
  // 2025~ 등급
  O: "bg-blue-100 text-blue-700",
  E: "bg-green-100 text-green-700",
  G: "bg-gray-100 text-gray-600",
  N: "bg-orange-100 text-orange-700",
  U: "bg-red-100 text-red-700",
};

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-gray-300 text-xs">-</span>;
  const cls = GRADE_COLORS[grade.toUpperCase()] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {grade}
    </span>
  );
}

interface PointsResponse {
  employees: EmployeePoint[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  yearColumns: number[];
  currentYear: number;
  meta: { departments: string[]; teams: string[] };
}

interface EditState {
  employee: EmployeePoint;
  yearScores: Record<number, string>;
  totalMerit: string;
  totalPenalty: string;
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const EMPLOYMENT_MAP: Record<string, string> = { REGULAR: "정규직", CONTRACT: "계약직" };
const PAGE_SIZE = 20;
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;
const LEVELS = ["L1", "L2", "L3", "L4", "L5"] as const;
const GRADES_2022_2024 = ["S", "A", "B", "C"] as const;
const GRADES_2025 = ["S", "O", "E", "G", "N", "U"] as const;

interface AddEmployeeForm {
  name: string;
  department: string;
  team: string;
  level: string;
  yearsOfService: string;
  grade2022: string;
  grade2023: string;
  grade2024: string;
  grade2025: string;
  pointScore: string;
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

export default function PointsPage() {
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
  const [employees, setEmployees] = useState<EmployeePoint[]>([]);
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

  // ── 연도 추가 (admin) ─────────────────────────────────────
  const [newYear, setNewYear] = useState<string>("");
  const [newYearScore, setNewYearScore] = useState<string>("");
  const [deletingYear, setDeletingYear] = useState<number | null>(null);

  // ── 직원 추가 모달 ────────────────────────────────────────
  const DEFAULT_ADD_FORM: AddEmployeeForm = {
    name: "", department: "", team: "", level: "", yearsOfService: "",
    grade2022: "", grade2023: "", grade2024: "", grade2025: "", pointScore: "0",
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
      const res = await fetch("/api/points/add-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addEmpForm.name,
          department: addEmpForm.department,
          team: addEmpForm.team,
          level: addEmpForm.level || null,
          yearsOfService: addEmpForm.yearsOfService !== "" ? Number(addEmpForm.yearsOfService) : null,
          grade2022: addEmpForm.grade2022 || null,
          grade2023: addEmpForm.grade2023 || null,
          grade2024: addEmpForm.grade2024 || null,
          grade2025: addEmpForm.grade2025 || null,
          pointScore: addEmpForm.pointScore !== "" ? Number(addEmpForm.pointScore) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      toast.success("직원이 추가되었습니다.");
      setAddEmpOpen(false);
      setAddEmpForm(DEFAULT_ADD_FORM);
      fetchPoints(lastParams, 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setAddEmpSaving(false);
    }
  }

  // ── 데이터 페치 ──────────────────────────────────────────
  const fetchPoints = useCallback(
    async (params: Record<string, string | number | boolean>, targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/points?${buildQuery(params, targetPage)}`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? "데이터 조회 실패");
        }
        const data: PointsResponse = await res.json();
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
      fetchPoints({}, 1);
    }
  }, [status, session, fetchPoints]);

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
    fetchPoints(params, 1);
  }

  // ── 편집 모달 열기 ────────────────────────────────────────
  function openEdit(emp: EmployeePoint) {
    const yearScores: Record<number, string> = {};
    for (const yr of yearColumns) {
      const d = emp.yearData[yr];
      if (d) {
        yearScores[yr] = d.score !== null ? String(d.score) : d.isAutoFill ? "2" : "";
      } else {
        yearScores[yr] = "";
      }
    }
    setEditState({
      employee: emp,
      yearScores,
      totalMerit: String(emp.totalMerit),
      totalPenalty: String(emp.totalPenalty),
    });
    setSaveError(null);
  }

  // ── 편집 계산 ─────────────────────────────────────────────
  const editCalc = useMemo(() => {
    if (!editState) return { scoreSum: 0, cumulative: 0 };
    const scoreSum = Object.entries(editState.yearScores)
      .filter(([yr]) => Number(yr) >= editState.employee.startYear)
      .reduce((s, [, v]) => s + numVal(v), 0);
    const cumulative =
      scoreSum + numVal(editState.totalMerit) - numVal(editState.totalPenalty);
    return { scoreSum, cumulative };
  }, [editState]);

  // ── 연도 삭제 (admin) ─────────────────────────────────────
  async function handleDeleteYear(yr: number) {
    if (!editState) return;
    setDeletingYear(yr);
    try {
      const res = await fetch(
        `/api/points?userId=${editState.employee.id}&year=${yr}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      toast.success(`${yr}년 포인트 데이터가 삭제되었습니다.`);
      // 로컬 상태에서 해당 연도 제거
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

    const payload = {
      userId: emp.id,
      yearScores,
      totalMerit: numVal(editState.totalMerit),
      totalPenalty: numVal(editState.totalPenalty),
    };

    try {
      const res = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "저장 실패");
      }
      const result = await res.json();

      setEmployees((prev) =>
        prev.map((e) => {
          if (e.id !== emp.id) return e;
          const newYearData = { ...e.yearData };
          for (const ys of yearScores) {
            newYearData[ys.year] = { score: ys.score, isAutoFill: false };
          }
          return {
            ...e,
            yearData: newYearData,
            totalMerit: result.totalMerit,
            totalPenalty: result.totalPenalty,
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
        <h1 className="text-2xl font-bold">레벨업 포인트 관리</h1>
        <Button size="sm" variant="outline" onClick={() => { setAddEmpForm(DEFAULT_ADD_FORM); setAddEmpOpen(true); }}>
          + 직원 추가
        </Button>
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
        <Table style={{ minWidth: "860px" }}>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 text-center text-xs sticky left-0 bg-muted/40">No.</TableHead>
              <TableHead className="text-xs">본부</TableHead>
              <TableHead className="text-xs">팀</TableHead>
              <TableHead className="text-xs">이름</TableHead>
              <TableHead className="text-xs">레벨</TableHead>
              <TableHead className="text-center text-xs">연차</TableHead>
              {GRADE_YEARS.map((yr) => (
                <TableHead key={yr} className="text-center text-xs text-gray-600">
                  {yr}년
                </TableHead>
              ))}
              <TableHead className="text-center text-xs font-bold">포인트</TableHead>
              <TableHead className="text-center text-xs font-bold">학점</TableHead>
              <TableHead className="text-center text-xs">편집</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6 + GRADE_YEARS.length + 3}
                  className="text-center py-16 text-muted-foreground text-sm"
                >
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6 + GRADE_YEARS.length + 3}
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
                      employmentType={emp.employmentType}
                      pointCumulative={emp.cumulative}
                      creditCumulative={emp.creditCumulative}
                    >
                      {emp.name}
                    </EmployeeTooltip>
                  </TableCell>
                  <TableCell className="text-sm">{emp.competencyLevel || emp.level || "-"}</TableCell>
                  <TableCell className="text-center text-sm">{emp.yearsOfService ?? "-"}</TableCell>

                  {GRADE_YEARS.map((yr) => (
                    <TableCell key={yr} className="text-center">
                      <GradeBadge grade={emp.grades?.[yr] ?? null} />
                    </TableCell>
                  ))}

                  <TableCell className="text-center text-sm font-bold">
                    {emp.cumulative.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-center text-sm font-bold">
                    {emp.creditCumulative.toFixed(1)}
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
        onPageChange={(p) => fetchPoints(lastParams, p)}
      />

      {/* ── 편집 모달 ─────────────────────────────────────────── */}
      <Dialog open={!!editState} onOpenChange={(open) => !open && setEditState(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              포인트 수정 —{" "}
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
                {editState.employee.department} › {editState.employee.team} ·{" "}
                {editState.employee.employmentType
                  ? EMPLOYMENT_MAP[editState.employee.employmentType]
                  : ""}{" "}
                · 입사{" "}
                {editState.employee.hireDate
                  ? new Date(editState.employee.hireDate).getFullYear()
                  : "-"}
                년
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3">연도별 포인트</h3>
                <div className="grid grid-cols-3 gap-3">
                  {Object.keys(editState.yearScores)
                    .map(Number)
                    .sort((a, b) => a - b)
                    .filter((yr) => yr >= editState.employee.startYear || yearColumns.includes(yr))
                    .map((yr) => {
                      const d = editState.employee.yearData[yr];
                      const isAutoFill = d?.isAutoFill ?? false;
                      const isCurrent = yr === currentYear;

                      return (
                        <div key={yr}>
                          <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                            {yr}년
                            {isAutoFill && (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">
                                자동부여
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
                                  ? { ...prev, yearScores: { ...prev.yearScores, [yr]: e.target.value } }
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

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3">상점 / 벌점</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      상점 (레벨 체류 기간 합산)
                    </label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      className="h-8 text-sm"
                      value={editState.totalMerit}
                      onChange={(e) =>
                        setEditState((prev) =>
                          prev ? { ...prev, totalMerit: e.target.value } : null
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      벌점 (레벨 체류 기간 합산)
                    </label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      className="h-8 text-sm"
                      value={editState.totalPenalty}
                      onChange={(e) =>
                        setEditState((prev) =>
                          prev ? { ...prev, totalPenalty: e.target.value } : null
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="bg-muted/40 rounded-md p-3 text-sm flex justify-between items-center">
                <span className="text-muted-foreground">예상 누적 포인트</span>
                <span className="font-bold text-lg">{editCalc.cumulative.toFixed(1)}</span>
              </div>

              {Object.values(editState.employee.yearData).some((d) => d.isAutoFill) && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded p-2 border border-amber-200">
                  * 자동부여(G기준 2점) 항목은 신규입사자의 입사 전 레벨 체류 연도입니다.
                </div>
              )}

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

      <div className="mt-3 text-xs text-muted-foreground flex gap-4">
        <span>S/O: 최우수 &nbsp; A/E: 우수 &nbsp; B/G: 양호 &nbsp; C/N: 미흡 &nbsp; U: 불량</span>
      </div>

      {/* ── 직원 추가 모달 ─────────────────────────────────────── */}
      <Dialog open={addEmpOpen} onOpenChange={(o) => !o && setAddEmpOpen(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>직원 추가 (포인트)</DialogTitle>
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
                <label className="text-xs text-muted-foreground block mb-1">포인트</label>
                <Input className="h-8" type="number" step="0.5" min="0" value={addEmpForm.pointScore} onChange={(e) => setAddEmpForm((p) => ({ ...p, pointScore: e.target.value }))} />
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground mb-2">평가등급 (2022~2024: S/A/B/C, 2025: S/O/E/G/N/U)</p>
              <div className="grid grid-cols-4 gap-2">
                {([2022, 2023, 2024] as const).map((yr) => {
                  const key = `grade${yr}` as keyof AddEmployeeForm;
                  return (
                    <div key={yr}>
                      <label className="text-xs text-muted-foreground block mb-1">{yr}년</label>
                      <Select value={(addEmpForm[key] as string) || "__none__"} onValueChange={(v) => setAddEmpForm((p) => ({ ...p, [key]: v === "__none__" ? "" : v }))}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">-</SelectItem>
                          {GRADES_2022_2024.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">2025년</label>
                  <Select value={addEmpForm.grade2025 || "__none__"} onValueChange={(v) => setAddEmpForm((p) => ({ ...p, grade2025: v === "__none__" ? "" : v }))}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="-" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">-</SelectItem>
                      {GRADES_2025.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
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
