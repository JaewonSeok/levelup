"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { EmployeeTooltip } from "@/components/EmployeeTooltip";
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
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  department: string;
  team: string;
  level: string | null;
  position: string | null;
  employmentType: "REGULAR" | "CONTRACT" | null;
  hireDate: string | null;
  resignDate: string | null;
  competencyLevel: string | null;
  yearsOfService: number | null;
  levelUpYear: number | null;
  isActive: boolean;
  role: string;
}

interface EmployeeResponse {
  employees: Employee[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  meta: {
    departments: string[];
    teams: string[];
  };
}

interface AdvancedSearch {
  department: string;
  team: string;
  keyword: string;
  isActive: string;
  position: string;
  level: string;
  employmentType: string;
  hireDateFrom: string;
  hireDateTo: string;
}

interface EmployeeFormData {
  name: string;
  department: string;
  team: string;
  level: string;
  position: string;
  employmentType: string;
  hireDate: string;
  competencyLevel: string;
  yearsOfService: string;
  levelUpYear: string;
  isActive: boolean;
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const EMPLOYMENT_MAP: Record<string, string> = {
  REGULAR: "정규직",
  CONTRACT: "계약직",
};

const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const POSITIONS = ["팀원", "팀장", "실장", "본부장"];
const PAGE_SIZE = 20;

const DEFAULT_FORM: EmployeeFormData = {
  name: "",
  department: "",
  team: "",
  level: "",
  position: "",
  employmentType: "",
  hireDate: "",
  competencyLevel: "",
  yearsOfService: "",
  levelUpYear: "",
  isActive: true,
};

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
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
// 서브 컴포넌트
// ─────────────────────────────────────────

function EmploymentTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground text-sm">-</span>;
  return (
    <Badge variant={type === "REGULAR" ? "default" : "secondary"} className="text-xs">
      {EMPLOYMENT_MAP[type] ?? type}
    </Badge>
  );
}

function IsActiveRadio({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium whitespace-nowrap">사용</span>
      {["all", "Y", "N"].map((v) => (
        <label key={v} className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name={name}
            value={v}
            checked={value === v}
            onChange={() => onChange(v)}
          />
          <span className="text-sm">{v === "all" ? "전체" : v}</span>
        </label>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 직원 추가/수정 모달 폼
// ─────────────────────────────────────────

function EmployeeFormModal({
  open,
  mode,
  initialData,
  editId,
  departments,
  teams,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "add" | "edit";
  initialData: EmployeeFormData;
  editId?: string;
  departments: string[];
  teams: string[];
  onClose: () => void;
  onSaved: (employee: Employee) => void;
}) {
  const [form, setForm] = useState<EmployeeFormData>(initialData);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initialData);
  }, [open, initialData]);

  const set = (key: keyof EmployeeFormData, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  async function handleSubmit() {
    if (!form.name || !form.department || !form.team) {
      toast.error("이름, 본부, 팀은 필수입니다.");
      return;
    }
    if (mode === "add" && !form.hireDate) {
      toast.error("입사일자는 필수입니다.");
      return;
    }

    setSaving(true);
    try {
      let payload: Record<string, unknown>;

      if (mode === "add") {
        const hireYear = new Date(form.hireDate).getFullYear();
        const yearsOfService = new Date().getFullYear() - hireYear;
        payload = {
          name: form.name,
          department: form.department,
          team: form.team,
          level: form.level || null,
          position: form.position || null,
          employmentType: "REGULAR",
          hireDate: form.hireDate,
          yearsOfService,
          isActive: true,
        };
      } else {
        payload = {
          name: form.name,
          department: form.department,
          team: form.team,
          level: form.level || null,
          position: form.position || null,
          employmentType: form.employmentType || null,
          hireDate: form.hireDate || null,
          competencyLevel: form.competencyLevel || null,
          yearsOfService: form.yearsOfService !== "" ? Number(form.yearsOfService) : null,
          levelUpYear: form.levelUpYear !== "" ? Number(form.levelUpYear) : null,
          isActive: form.isActive,
        };
      }

      const url = mode === "add" ? "/api/employees" : `/api/employees/${editId ?? ""}`;
      const method = mode === "add" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "저장 실패");

      toast.success(mode === "add" ? "직원이 추가되었습니다." : "직원 정보가 수정되었습니다.");
      onSaved(data.employee);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "직원 추가" : "직원 수정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {mode === "add" ? (
            /* ── 추가 폼 (간소화) ── */
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">이름 *</label>
                <Input className="h-8" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">본부 *</label>
                <Select value={form.department || "__none__"} onValueChange={(v) => set("department", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">팀 *</label>
                <Input className="h-8" value={form.team} onChange={(e) => set("team", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">직책</label>
                <Select value={form.position || "__none__"} onValueChange={(v) => set("position", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">레벨</label>
                <Select value={form.level || "__none__"} onValueChange={(v) => set("level", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">입사일자 *</label>
                <Input className="h-8" type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
              </div>
            </div>
          ) : (
            /* ── 수정 폼 (전체 필드) ── */
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">이름 *</label>
                <Input className="h-8" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">본부 *</label>
                <Input className="h-8" value={form.department} onChange={(e) => set("department", e.target.value)} list="dept-list" />
                <datalist id="dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">팀 *</label>
                <Input className="h-8" value={form.team} onChange={(e) => set("team", e.target.value)} list="team-list" />
                <datalist id="team-list">{teams.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">레벨</label>
                <Select value={form.level || "__none__"} onValueChange={(v) => set("level", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">직책</label>
                <Select value={form.position || "__none__"} onValueChange={(v) => set("position", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">고용형태</label>
                <Select value={form.employmentType || "__none__"} onValueChange={(v) => set("employmentType", v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">-</SelectItem>
                    <SelectItem value="REGULAR">정규직</SelectItem>
                    <SelectItem value="CONTRACT">계약직</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">입사일자</label>
                <Input className="h-8" type="date" value={form.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">역량레벨</label>
                <Input className="h-8" value={form.competencyLevel} onChange={(e) => set("competencyLevel", e.target.value)} placeholder="예: L3-07" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">연차</label>
                <Input className="h-8" type="number" min="0" value={form.yearsOfService} onChange={(e) => set("yearsOfService", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">레벨업연도</label>
                <Input className="h-8" type="number" value={form.levelUpYear} onChange={(e) => set("levelUpYear", e.target.value)} placeholder="예: 2026" />
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <label className="text-xs text-muted-foreground">재직여부</label>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set("isActive", e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs">{form.isActive ? "재직" : "퇴직"}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────

export default function LevelManagementPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "SYSTEM_ADMIN";

  // 드롭다운 옵션
  const [departments, setDepartments] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  // 상세 검색 상태
  const [advanced, setAdvanced] = useState<AdvancedSearch>({
    department: "",
    team: "",
    keyword: "",
    isActive: "Y",
    position: "",
    level: "",
    employmentType: "",
    hireDateFrom: "",
    hireDateTo: "",
  });

  // 마지막으로 실행된 검색 파라미터 (페이지 이동 시 재사용)
  const [lastParams, setLastParams] = useState<Record<string, string | number | boolean>>({
    isActive: "Y",
  });

  // 결과
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 모달 상태
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── 검색 실행 ────────────────────────────────────────────
  const fetchEmployees = useCallback(
    async (params: Record<string, string | number | boolean>, currentPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/employees?${buildQuery(params, currentPage)}`);
        if (!res.ok) {
          let body: { error?: string; detail?: string } = {};
          try { body = await res.json(); } catch { /* empty body */ }
          throw new Error(body.error ?? `데이터 조회 실패 (${res.status})`);
        }
        const data: EmployeeResponse = await res.json();
        setEmployees(data.employees);
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

  // 초기 로드
  useEffect(() => {
    fetchEmployees({ isActive: "Y" }, 1);
  }, [fetchEmployees]);

  function handleAdvancedSearch() {
    const params: Record<string, string | number | boolean> = {
      department: advanced.department,
      team: advanced.team,
      keyword: advanced.keyword,
      isActive: advanced.isActive,
      position: advanced.position,
      level: advanced.level,
      employmentType: advanced.employmentType,
      hireDateFrom: advanced.hireDateFrom,
      hireDateTo: advanced.hireDateTo,
    };
    setLastParams(params);
    fetchEmployees(params, 1);
  }

  function handlePageChange(newPage: number) {
    fetchEmployees(lastParams, newPage);
  }

  // 직원 추가 완료 후 목록 새로고침
  function handleEmployeeAdded() {
    fetchEmployees(lastParams, 1);
  }

  // 직원 수정 완료 후 목록 업데이트
  function handleEmployeeUpdated(updated: Employee) {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
  }

  // 직원 삭제 (soft delete)
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/employees/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      toast.success("직원이 비활성화되었습니다.");
      setDeleteTarget(null);
      fetchEmployees(lastParams, page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  // 편집 모달용 초기 데이터 변환
  function toFormData(emp: Employee): EmployeeFormData {
    return {
      ...DEFAULT_FORM,
      name: emp.name,
      department: emp.department ?? "",
      team: emp.team ?? "",
      level: emp.level ?? "",
      position: emp.position ?? "",
      employmentType: emp.employmentType ?? "",
      hireDate: emp.hireDate ? formatDate(emp.hireDate) : "",
      competencyLevel: emp.competencyLevel ?? "",
      yearsOfService: emp.yearsOfService != null ? String(emp.yearsOfService) : "",
      levelUpYear: emp.levelUpYear != null ? String(emp.levelUpYear) : "",
      isActive: emp.isActive,
    };
  }

  const filteredTeamsForAdvanced = advanced.department ? teams : teams;

  // ─────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">레벨관리/조회</h1>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddModalOpen(true)}>
            + 직원 추가
          </Button>
        )}
      </div>

      {/* ── 검색 영역: 상세 조회 ─────────────────────── */}
      <div className="border rounded-md p-4 mb-4 bg-gray-50">
        {/* 첫 번째 행 */}
        <div className="flex flex-wrap gap-3 items-end mb-3">
          {/* 본부 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">본부</span>
            <Select
              value={advanced.department || "__all__"}
              onValueChange={(v) =>
                setAdvanced({ ...advanced, department: v === "__all__" ? "" : v, team: "" })
              }
            >
              <SelectTrigger className="w-36 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 팀 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">팀</span>
            <Select
              value={advanced.team || "__all__"}
              onValueChange={(v) =>
                setAdvanced({ ...advanced, team: v === "__all__" ? "" : v })
              }
            >
              <SelectTrigger className="w-32 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {filteredTeamsForAdvanced.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 직책 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">직책</span>
            <Select
              value={advanced.position || "__all__"}
              onValueChange={(v) =>
                setAdvanced({ ...advanced, position: v === "__all__" ? "" : v })
              }
            >
              <SelectTrigger className="w-28 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 레벨 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">레벨</span>
            <Select
              value={advanced.level || "__all__"}
              onValueChange={(v) =>
                setAdvanced({ ...advanced, level: v === "__all__" ? "" : v })
              }
            >
              <SelectTrigger className="w-20 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 두 번째 행 */}
        <div className="flex flex-wrap gap-3 items-end">
          {/* 입사일자 범위 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">입사일자</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advanced.hireDateFrom}
              onChange={(e) => setAdvanced({ ...advanced, hireDateFrom: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">~</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advanced.hireDateTo}
              onChange={(e) => setAdvanced({ ...advanced, hireDateTo: e.target.value })}
            />
          </div>

          {/* 검색어 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">검색어</span>
            <Input
              className="w-40 bg-white h-8 text-sm"
              value={advanced.keyword}
              onChange={(e) => setAdvanced({ ...advanced, keyword: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleAdvancedSearch()}
              placeholder="이름 검색"
            />
          </div>

          {/* 사용 */}
          <IsActiveRadio
            name="adv-isActive"
            value={advanced.isActive}
            onChange={(v) => setAdvanced({ ...advanced, isActive: v })}
          />

          <Button onClick={handleAdvancedSearch} disabled={loading} size="sm" className="h-8">
            검색
          </Button>
        </div>
      </div>

      {/* ── 오류 메시지 ──────────────────────────────────── */}
      {error && (
        <div className="text-red-600 text-sm mb-4 p-3 bg-red-50 rounded border border-red-200">
          {error}
        </div>
      )}

      {/* ── 결과 건수 ────────────────────────────────────── */}
      <div className="text-sm text-muted-foreground mb-2">
        총{" "}
        <span className="font-semibold text-foreground">{total.toLocaleString()}</span>명
      </div>

      {/* ── 결과 테이블 ──────────────────────────────────── */}
      <div className="border rounded-md overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-center text-xs">No.</TableHead>
              <TableHead className="text-xs">본부</TableHead>
              <TableHead className="text-xs">팀</TableHead>
              <TableHead className="text-xs">이름</TableHead>
              <TableHead className="text-xs">직책</TableHead>
              <TableHead className="text-xs">레벨</TableHead>
              <TableHead className="text-xs">입사일자</TableHead>
              <TableHead className="text-center text-xs">연차</TableHead>
              <TableHead className="text-xs">역량레벨</TableHead>
              {isAdmin && <TableHead className="text-center text-xs">관리</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 10 : 9}
                  className="text-center py-16 text-muted-foreground text-sm"
                >
                  로딩 중...
                </TableCell>
              </TableRow>
            ) : employees.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 10 : 9}
                  className="text-center py-16 text-muted-foreground text-sm"
                >
                  검색 결과가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              employees.map((emp, idx) => (
                <TableRow key={emp.id} className="hover:bg-muted/30">
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </TableCell>
                  <TableCell className="text-sm">{emp.department || "-"}</TableCell>
                  <TableCell className="text-sm">{emp.team || "-"}</TableCell>
                  <TableCell>
                    <EmployeeTooltip
                      name={emp.name}
                      department={emp.department}
                      team={emp.team}
                      level={emp.level}
                      competencyLevel={emp.competencyLevel}
                      hireDate={emp.hireDate}
                      yearsOfService={emp.yearsOfService}
                      employmentType={emp.employmentType}
                    >
                      <button
                        className="text-blue-600 hover:underline font-medium text-sm"
                        onClick={() => setSelectedEmployee(emp)}
                      >
                        {emp.name}
                      </button>
                    </EmployeeTooltip>
                  </TableCell>
                  <TableCell className="text-sm">{emp.position || "-"}</TableCell>
                  <TableCell className="text-sm font-medium">{emp.level || "-"}</TableCell>
                  <TableCell className="text-sm">{formatDate(emp.hireDate)}</TableCell>
                  <TableCell className="text-center text-sm">
                    {emp.yearsOfService ?? "-"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {emp.competencyLevel || "-"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="p-1 hover:bg-blue-50 rounded text-blue-600"
                          title="수정"
                          onClick={() => setEditTarget(emp)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          className="p-1 hover:bg-red-50 rounded text-red-600"
                          title="비활성화"
                          onClick={() => setDeleteTarget(emp)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── 페이지네이션 ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-1 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(1)}
            disabled={page <= 1 || loading}
            className="px-2"
          >
            ««
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="px-2"
          >
            «
          </Button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const p = start + i;
            return (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                onClick={() => handlePageChange(p)}
                disabled={loading}
                className="w-8 px-0"
              >
                {p}
              </Button>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-2"
          >
            »
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(totalPages)}
            disabled={page >= totalPages || loading}
            className="px-2"
          >
            »»
          </Button>
        </div>
      )}

      {/* ── 직원 상세 모달 ───────────────────────────────── */}
      <Dialog
        open={!!selectedEmployee}
        onOpenChange={(open) => !open && setSelectedEmployee(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>직원 상세 정보</DialogTitle>
            <DialogDescription>입사 후 역량레벨 정보 조회</DialogDescription>
          </DialogHeader>

          {selectedEmployee && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">이름</p>
                  <p className="font-semibold">{selectedEmployee.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">현재 레벨</p>
                  <p className="font-semibold">{selectedEmployee.level ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">본부</p>
                  <p>{selectedEmployee.department || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">팀</p>
                  <p>{selectedEmployee.team || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">직책</p>
                  <p>{selectedEmployee.position ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">고용형태</p>
                  <p>
                    {selectedEmployee.employmentType
                      ? EMPLOYMENT_MAP[selectedEmployee.employmentType]
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">입사일자</p>
                  <p>{formatDate(selectedEmployee.hireDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">퇴사일자</p>
                  <p>{formatDate(selectedEmployee.resignDate)}</p>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold mb-2">역량레벨 정보</h3>
                <div className="bg-muted/40 rounded-md p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">현재 역량레벨</span>
                    <span className="font-medium">
                      {selectedEmployee.competencyLevel ?? "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">레벨 체류 연수</span>
                    <span className="font-medium">
                      {selectedEmployee.yearsOfService != null
                        ? `${selectedEmployee.yearsOfService}년`
                        : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">레벨업 대상 연도</span>
                    <span className="font-medium">
                      {selectedEmployee.levelUpYear ?? "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">재직 여부</span>
                    <Badge
                      variant={selectedEmployee.isActive ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {selectedEmployee.isActive ? "재직" : "퇴직"}
                    </Badge>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                * 역량레벨 이력 상세 조회는 추후 업데이트 예정입니다.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 직원 추가 모달 ──────────────────────────────── */}
      {isAdmin && (
        <EmployeeFormModal
          open={addModalOpen}
          mode="add"
          initialData={DEFAULT_FORM}
          departments={departments}
          teams={teams}
          onClose={() => setAddModalOpen(false)}
          onSaved={() => handleEmployeeAdded()}
        />
      )}

      {/* ── 직원 수정 모달 ──────────────────────────────── */}
      {isAdmin && editTarget && (
        <EmployeeFormModal
          open={!!editTarget}
          mode="edit"
          initialData={toFormData(editTarget)}
          editId={editTarget.id}
          departments={departments}
          teams={teams}
          onClose={() => setEditTarget(null)}
          onSaved={(emp) => { handleEmployeeUpdated(emp); setEditTarget(null); }}
        />
      )}

      {/* ── 삭제 확인 AlertDialog ──────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>직원 비활성화</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.name}</strong> 직원을 비활성화하시겠습니까?
              직원 데이터는 보존되며 재직 상태만 변경됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "처리 중..." : "비활성화"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
