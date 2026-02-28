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

import { toast } from "sonner";
import { Trash2 } from "lucide-react";

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
  bonusTotal: number;
  penaltyTotal: number;
  adjustment: number;
  totalPoints: number;
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

interface GradeCriteriaItem {
  grade: string;
  yearRange: string; // "2021-2024" | "2025"
  points: number;
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
  yearGrades: Record<number, string>; // year → grade letter ("S","A",...) or "" for none
  totalMerit: string;
  totalPenalty: string;
}

// ─────────────────────────────────────────
// 가감점 상수
// ─────────────────────────────────────────

const BONUS_ITEMS = [
  { category: "공로상", points: 1.0, type: "bonus" },
  { category: "B of B", points: 0.5, type: "bonus" },
  { category: "기술혁신상", points: 0.5, type: "bonus" },
] as const;

const PENALTY_ITEMS = [
  { category: "견책", points: -0.5, type: "penalty" },
  { category: "감급", points: -1.0, type: "penalty" },
  { category: "정직 이상", points: -2.0, type: "penalty" },
] as const;

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────


const PAGE_SIZE = 20;
const GRADE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;
const LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"] as const;
const GRADES_2022_2024 = ["S", "A", "B", "C"] as const;
const GRADES_2025 = ["S", "O", "E", "G", "N", "U"] as const;

interface AddEmployeeForm {
  name: string;
  department: string;
  team: string;
  level: string;
  yearsOfService: string;
  grade2021: string;
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // ── 등급 기준 ─────────────────────────────────────────────
  const [gradeCriteria, setGradeCriteria] = useState<GradeCriteriaItem[]>([]);
  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/grade-criteria")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d.criteria)) setGradeCriteria(d.criteria); })
        .catch(() => {});
    }
  }, [status]);


  // ── 가감점 모달 ───────────────────────────────────────────
  const [bpEmployee, setBpEmployee] = useState<EmployeePoint | null>(null);
  const [bpChecked, setBpChecked] = useState<Set<string>>(new Set());
  const [bpNote, setBpNote] = useState("");
  const [bpLoading, setBpLoading] = useState(false);
  const [bpSaving, setBpSaving] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function openBonusPenalty(emp: EmployeePoint) {
    setBpEmployee(emp);
    setBpChecked(new Set());
    setBpNote("");
    setBpLoading(true);
    try {
      const res = await fetch(`/api/bonus-penalty?userId=${emp.id}&year=${currentYear}`);
      const data = await res.json();
      if (res.ok && data.items) {
        const checked = new Set<string>(data.items.map((it: { category: string }) => it.category));
        setBpChecked(checked);
        setBpNote(data.items[0]?.note ?? "");
      }
    } finally {
      setBpLoading(false);
    }
  }

  function toggleBpItem(category: string) {
    setBpChecked((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const bpAdjustment = useMemo(() => {
    let total = 0;
    for (const b of BONUS_ITEMS) {
      if (bpChecked.has(b.category)) total += b.points;
    }
    for (const p of PENALTY_ITEMS) {
      if (bpChecked.has(p.category)) total += p.points; // points is negative
    }
    return total;
  }, [bpChecked]);

  async function handleBpSave() {
    if (!bpEmployee) return;
    setBpSaving(true);
    try {
      const items: { type: string; category: string; points: number }[] = [];
      for (const b of BONUS_ITEMS) {
        if (bpChecked.has(b.category)) items.push({ type: b.type, category: b.category, points: b.points });
      }
      for (const p of PENALTY_ITEMS) {
        if (bpChecked.has(p.category)) items.push({ type: p.type, category: p.category, points: p.points });
      }
      const res = await fetch("/api/bonus-penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: bpEmployee.id, year: currentYear, items, note: bpNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");
      toast.success("가감점이 저장되었습니다.");
      // 로컬 상태 업데이트
      const bonusTotal = items.filter((i) => i.type === "bonus").reduce((s, i) => s + i.points, 0);
      const penaltyTotal = Math.abs(items.filter((i) => i.type === "penalty").reduce((s, i) => s + i.points, 0));
      const adjustment = bonusTotal - penaltyTotal;
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === bpEmployee.id
            ? { ...e, bonusTotal, penaltyTotal, adjustment, cumulative: e.cumulative - e.adjustment + adjustment }
            : e
        )
      );
      setBpEmployee(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setBpSaving(false);
    }
  }

  // ── 직원 삭제 (숨김) ─────────────────────────────────────
  async function handleDeleteEmployee(emp: { id: string; name: string }) {
    if (!window.confirm(`"${emp.name}" 직원을 비활성화하시겠습니까?\n(레벨관리·포인트·학점 모든 화면에서 숨김 처리됩니다)`)) return;
    try {
      const res = await fetch(`/api/employees/${emp.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      toast.success(`"${emp.name}" 직원이 비활성화되었습니다.`);
      fetchPoints(lastParams, page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.");
    }
  }

  // ── 직원 추가 모달 ────────────────────────────────────────
  const DEFAULT_ADD_FORM: AddEmployeeForm = {
    name: "", department: "", team: "", level: "", yearsOfService: "",
    grade2021: "", grade2022: "", grade2023: "", grade2024: "", grade2025: "", pointScore: "0",
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
          grade2021: addEmpForm.grade2021 || null,
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
    const yearGrades: Record<number, string> = {};
    for (const yr of GRADE_YEARS) {
      yearGrades[yr] = emp.grades?.[yr as keyof GradeMap] ?? "";
    }
    setEditState({
      employee: emp,
      yearGrades,
      totalMerit: String(emp.totalMerit),
      totalPenalty: String(emp.totalPenalty),
    });
    setSaveError(null);
  }

  // ── 등급→포인트 변환 ─────────────────────────────────────
  function getPointsForGrade(grade: string, yr: number): number {
    if (!grade) return 0;
    const yearRange = yr <= 2024 ? "2021-2024" : "2025";
    const crit = gradeCriteria.find((c) => c.grade === grade && c.yearRange === yearRange);
    return crit ? crit.points : 0;
  }

  // ── 편집 계산 (최근 tenureRange년 윈도우 합산) ────────────
  const editCalc = useMemo(() => {
    if (!editState) return { scoreSum: 0, cumulative: 0 };
    const MAX_DATA_YEAR = 2025;
    const emp = editState.employee;
    const yearsOfService = emp.yearsOfService ?? 0;
    const tenureRange = Math.min(yearsOfService, 5);
    let scoreSum = 0;
    for (let i = 0; i < tenureRange; i++) {
      const yr = MAX_DATA_YEAR - i;
      if (yr < 2021) break;
      const grade = editState.yearGrades[yr] ?? "";
      const yearRange = yr <= 2024 ? "2021-2024" : "2025";
      const crit = gradeCriteria.find((c) => c.grade === grade && c.yearRange === yearRange);
      scoreSum += crit ? crit.points : 2;
    }
    const cumulative =
      scoreSum + numVal(editState.totalMerit) - numVal(editState.totalPenalty);
    return { scoreSum, cumulative };
  }, [editState, gradeCriteria]);

  // ── 저장 ─────────────────────────────────────────────────
  async function handleSave() {
    if (!editState) return;
    setSaving(true);
    setSaveError(null);

    const emp = editState.employee;
    const empHireYear = emp.hireDate ? new Date(emp.hireDate).getFullYear() : emp.startYear;
    const yearScores: { year: number; score: number }[] = [];
    const yearGradesPayload: { year: number; grade: string }[] = [];

    for (const yr of GRADE_YEARS) {
      if (yr < empHireYear) continue;
      const grade = editState.yearGrades[yr] ?? "";
      const score = getPointsForGrade(grade, yr);
      yearScores.push({ year: yr, score });
      if (grade) yearGradesPayload.push({ year: yr, grade });
    }

    const payload = {
      userId: emp.id,
      yearScores,
      yearGrades: yearGradesPayload,
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
          const newGrades = { ...e.grades };
          for (const { year, grade } of yearGradesPayload) {
            newGrades[year as keyof GradeMap] = grade;
          }
          return {
            ...e,
            yearData: newYearData,
            grades: newGrades,
            totalMerit: result.totalMerit,
            totalPenalty: result.totalPenalty,
            cumulative: result.cumulative,
            totalPoints: result.totalPoints ?? result.cumulative + e.adjustment,
            adjustment: result.adjustment ?? e.adjustment,
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
              <TableHead className="text-center text-xs font-bold">충족</TableHead>
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

                  <TableCell className="text-center text-sm">
                    {emp.cumulative.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${emp.isMet ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {emp.isMet ? "충족" : "미충족"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => openEdit(emp)}
                      >
                        수정
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeleteEmployee(emp)}
                          title="비활성화"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
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
                {editState.employee.department} › {editState.employee.team} · 입사{" "}
                {editState.employee.hireDate
                  ? new Date(editState.employee.hireDate).getFullYear()
                  : "-"}
                년
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold mb-3">연도별 평가등급</h3>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground">
                        <th className="text-left px-3 py-1.5 w-20">연도</th>
                        <th className="text-left px-3 py-1.5">평가등급</th>
                        <th className="text-right px-3 py-1.5 w-24">포인트</th>
                      </tr>
                    </thead>
                    <tbody>
                      {GRADE_YEARS.map((yr) => {
                        const editHireYear = editState.employee.hireDate ? new Date(editState.employee.hireDate).getFullYear() : editState.employee.startYear;
                        const isDisabled = yr < editHireYear;
                        const grade = editState.yearGrades[yr] ?? "";
                        const points = getPointsForGrade(grade, yr);
                        const gradeOptions =
                          yr <= 2024 ? GRADES_2022_2024 : GRADES_2025;

                        return (
                          <tr key={yr} className="border-t">
                            <td className="px-3 py-2 text-muted-foreground text-xs">
                              {yr}년
                            </td>
                            <td className="px-3 py-2">
                              {isDisabled ? (
                                <span className="text-xs text-muted-foreground">-</span>
                              ) : (
                                <Select
                                  value={grade || "none"}
                                  onValueChange={(v) =>
                                    setEditState((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            yearGrades: {
                                              ...prev.yearGrades,
                                              [yr]: v === "none" ? "" : v,
                                            },
                                          }
                                        : null
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-7 w-32 text-xs">
                                    <SelectValue placeholder="- (없음)" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">- (없음)</SelectItem>
                                    {gradeOptions.map((g) => (
                                      <SelectItem key={g} value={g}>
                                        {g}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {isDisabled ? (
                                <span className="text-xs text-muted-foreground">-</span>
                              ) : grade ? (
                                <span className="text-sm font-medium">
                                  {points.toFixed(1)}점
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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

              {(() => {
                const footerHireYear = editState.employee.hireDate ? new Date(editState.employee.hireDate).getFullYear() : editState.employee.startYear;
                return footerHireYear > 2021 && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 border">
                    * 입사 전 연도({footerHireYear - 1}년 이전)는 편집 불가합니다.
                  </div>
                );
              })()}

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

      {/* ── 가감점 모달 ───────────────────────────────────────── */}
      <Dialog open={!!bpEmployee} onOpenChange={(open) => !open && setBpEmployee(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{bpEmployee?.name} 가감점 관리</DialogTitle>
          </DialogHeader>
          {bpLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">로딩 중...</div>
          ) : (
            <div className="space-y-4">
              {/* 가점 섹션 */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-blue-700">가점</h3>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground">
                        <th className="text-left px-3 py-1.5">항목</th>
                        <th className="text-center px-3 py-1.5 w-16">점수</th>
                        <th className="text-center px-3 py-1.5 w-12">적용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BONUS_ITEMS.map((item) => (
                        <tr key={item.category} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2">{item.category}</td>
                          <td className="text-center px-3 py-2 text-blue-700">+{item.points.toFixed(1)}점</td>
                          <td className="text-center px-3 py-2">
                            <input
                              type="checkbox"
                              checked={bpChecked.has(item.category)}
                              onChange={() => toggleBpItem(item.category)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 감점 섹션 */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-red-700">감점</h3>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground">
                        <th className="text-left px-3 py-1.5">항목</th>
                        <th className="text-center px-3 py-1.5 w-16">점수</th>
                        <th className="text-center px-3 py-1.5 w-12">적용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PENALTY_ITEMS.map((item) => (
                        <tr key={item.category} className="border-t hover:bg-muted/20">
                          <td className="px-3 py-2">{item.category}</td>
                          <td className="text-center px-3 py-2 text-red-700">{item.points.toFixed(1)}점</td>
                          <td className="text-center px-3 py-2">
                            <input
                              type="checkbox"
                              checked={bpChecked.has(item.category)}
                              onChange={() => toggleBpItem(item.category)}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 합계 */}
              <div className="bg-muted/40 rounded px-4 py-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">합계</span>
                <span className={`font-bold text-base ${bpAdjustment > 0 ? "text-blue-700" : bpAdjustment < 0 ? "text-red-700" : "text-gray-600"}`}>
                  {bpAdjustment > 0 ? `+${bpAdjustment.toFixed(1)}` : bpAdjustment.toFixed(1)}점
                </span>
              </div>

              {/* 비고 */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">비고 (선택)</label>
                <Input
                  className="h-8 text-sm"
                  placeholder="비고를 입력하세요"
                  value={bpNote}
                  onChange={(e) => setBpNote(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBpEmployee(null)} disabled={bpSaving}>
              취소
            </Button>
            <Button onClick={handleBpSave} disabled={bpSaving || bpLoading}>
              {bpSaving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <p className="text-xs text-muted-foreground mb-2">평가등급 (2021~2024: S/A/B/C, 2025: S/O/E/G/N/U)</p>
              <div className="grid grid-cols-5 gap-2">
                {([2021, 2022, 2023, 2024] as const).map((yr) => {
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
