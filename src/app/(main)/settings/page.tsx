"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── Types ─────────────────────────────────────────────────────────

interface GradeCriteriaEntry {
  grade: string;
  yearRange: string;
  points: number;
}

interface CriteriaRow {
  level: string;
  year: number;
  id: string | null;
  requiredPoints: number | null;
  requiredCredits: number | null;
  minTenure: number | null;
}

interface HistoryRow {
  no: number;
  id: string;
  level: string;
  year: number;
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string;
  changedByName: string;
  changedAt: string;
}

interface SettingsData {
  criteria: CriteriaRow[];
  year: number;
  availableYears: number[];
}

type EditValues = Record<
  string,
  { requiredPoints: string; requiredCredits: string; minTenure: string }
>;

const CURRENT_YEAR = new Date().getFullYear();
const ALL_LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const GRADES_2022_2024 = ["S", "A", "B", "C"] as const;
const GRADES_2025 = ["S", "O", "E", "G", "N", "U"] as const;

// Default grade points map
const DEFAULT_GRADE_POINTS: Record<string, Record<string, string>> = {
  "2022-2024": { S: "", A: "", B: "", C: "" },
  "2025": { S: "", O: "", E: "", G: "", N: "", U: "" },
};

// ── Component ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState<SettingsData | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Grade Criteria 상태 ────────────────────────────────────────
  const [gradePoints, setGradePoints] = useState<Record<string, Record<string, string>>>(
    JSON.parse(JSON.stringify(DEFAULT_GRADE_POINTS))
  );
  const [gradeDirty, setGradeDirty] = useState(false);
  const [gradeSaving, setGradeSaving] = useState(false);

  const fetchData = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settings?year=${y}`);
      const json: SettingsData = await res.json();
      setData(json);

      const init: EditValues = {};
      for (const row of json.criteria) {
        init[row.level] = {
          requiredPoints: row.requiredPoints != null ? String(row.requiredPoints) : "",
          requiredCredits: row.requiredCredits != null ? String(row.requiredCredits) : "",
          minTenure: row.minTenure != null ? String(row.minTenure) : "",
        };
      }
      setEditValues(init);
      setIsDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (y: number) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/settings/history?year=${y}`);
      const json = await res.json();
      setHistory(json.history ?? []);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchGradeCriteria = useCallback(async () => {
    try {
      const res = await fetch("/api/grade-criteria");
      if (!res.ok) return;
      const json: { criteria: GradeCriteriaEntry[] } = await res.json();
      const map: Record<string, Record<string, string>> = JSON.parse(JSON.stringify(DEFAULT_GRADE_POINTS));
      for (const entry of json.criteria) {
        if (map[entry.yearRange]) {
          map[entry.yearRange][entry.grade] = String(entry.points);
        }
      }
      setGradePoints(map);
      setGradeDirty(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData(year);
    fetchHistory(year);
    fetchGradeCriteria();
  }, [year, fetchData, fetchHistory, fetchGradeCriteria]);

  async function handleGradeSave() {
    setGradeSaving(true);
    try {
      const criteria: { grade: string; yearRange: string; points: number }[] = [];
      for (const [yearRange, grades] of Object.entries(gradePoints)) {
        for (const [grade, pts] of Object.entries(grades)) {
          criteria.push({ grade, yearRange, points: Number(pts) || 0 });
        }
      }
      const res = await fetch("/api/grade-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria }),
      });
      if (res.ok) {
        toast.success("등급별 포인트 기준이 저장되었습니다. 포인트 재계산이 실행됩니다.");
        setGradeDirty(false);
      } else {
        const err = await res.json();
        toast.error(err.error ?? "저장에 실패했습니다.");
      }
    } catch {
      toast.error("저장에 실패했습니다.");
    } finally {
      setGradeSaving(false);
    }
  }

  const handleEdit = (level: string, field: keyof EditValues[string], value: string) => {
    setEditValues((prev) => ({
      ...prev,
      [level]: { ...prev[level], [field]: value },
    }));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const criteria = ALL_LEVELS.map((level) => {
        const v = editValues[level] ?? {
          requiredPoints: "",
          requiredCredits: "",
          minTenure: "",
        };
        return {
          level,
          requiredPoints: Number(v.requiredPoints) || 0,
          requiredCredits: Number(v.requiredCredits) || 0,
          minTenure: Number(v.minTenure) || 0,
        };
      });

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, criteria }),
      });

      if (res.ok) {
        toast.success("기준이 저장되었습니다.");
        setIsDirty(false);
        fetchData(year);
        fetchHistory(year);
      } else {
        const err = await res.json();
        toast.error(err.error ?? "저장에 실패했습니다.");
      }
    } catch {
      toast.error("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const availableYears = data?.availableYears ?? [];
  const yearOptions = Array.from(
    new Set([CURRENT_YEAR, CURRENT_YEAR + 1, ...availableYears])
  ).sort((a, b) => b - a);

  return (
    <div>
      {/* ── 헤더 ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">레벨업 기준 설정</h1>
        <div className="flex items-center gap-3">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}년
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>

      {/* ── 기준 설정 테이블 ──────────────────────────────── */}
      <div className="bg-white rounded-lg border mb-8">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-20 text-center">레벨</TableHead>
              <TableHead className="text-center">필요 포인트</TableHead>
              <TableHead className="text-center">필요 학점</TableHead>
              <TableHead className="text-center">최소 체류 연수</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : (
              ALL_LEVELS.map((level) => {
                const v = editValues[level] ?? {
                  requiredPoints: "",
                  requiredCredits: "",
                  minTenure: "",
                };
                return (
                  <TableRow key={level}>
                    <TableCell className="text-center font-semibold">{level}</TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        className="w-28 mx-auto text-center h-8"
                        value={v.requiredPoints}
                        onChange={(e) => handleEdit(level, "requiredPoints", e.target.value)}
                        placeholder="0"
                        min={0}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        className="w-28 mx-auto text-center h-8"
                        value={v.requiredCredits}
                        onChange={(e) => handleEdit(level, "requiredCredits", e.target.value)}
                        placeholder="0"
                        min={0}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        className="w-28 mx-auto text-center h-8"
                        value={v.minTenure}
                        onChange={(e) => handleEdit(level, "minTenure", e.target.value)}
                        placeholder="0"
                        min={0}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── 등급별 포인트 기준 ────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">등급별 포인트 기준</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              평가등급에 따라 자동으로 포인트를 계산합니다. 저장 시 전체 재계산이 실행됩니다.
            </p>
          </div>
          <Button onClick={handleGradeSave} disabled={gradeSaving || !gradeDirty} size="sm">
            {gradeSaving ? "저장 중..." : "저장"}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 2022-2024 등급 */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-medium mb-3 text-gray-700">2022~2024년 등급 (S/A/B/C)</h3>
            <div className="space-y-2">
              {GRADES_2022_2024.map((grade) => (
                <div key={grade} className="flex items-center gap-3">
                  <span className="w-8 text-center font-semibold text-sm bg-gray-100 rounded px-1.5 py-0.5">{grade}</span>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    className="w-28 h-8 text-sm"
                    placeholder="0"
                    value={gradePoints["2022-2024"]?.[grade] ?? ""}
                    onChange={(e) => {
                      setGradePoints((prev) => ({
                        ...prev,
                        "2022-2024": { ...prev["2022-2024"], [grade]: e.target.value },
                      }));
                      setGradeDirty(true);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">점</span>
                </div>
              ))}
            </div>
          </div>
          {/* 2025 등급 */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-medium mb-3 text-gray-700">2025년~ 등급 (S/O/E/G/N/U)</h3>
            <div className="space-y-2">
              {GRADES_2025.map((grade) => (
                <div key={grade} className="flex items-center gap-3">
                  <span className="w-8 text-center font-semibold text-sm bg-gray-100 rounded px-1.5 py-0.5">{grade}</span>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    className="w-28 h-8 text-sm"
                    placeholder="0"
                    value={gradePoints["2025"]?.[grade] ?? ""}
                    onChange={(e) => {
                      setGradePoints((prev) => ({
                        ...prev,
                        "2025": { ...prev["2025"], [grade]: e.target.value },
                      }));
                      setGradeDirty(true);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">점</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 변경 이력 ─────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold mb-3">변경 이력</h2>
        <div className="bg-white rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="w-12 text-center">No.</TableHead>
                <TableHead className="w-16 text-center">레벨</TableHead>
                <TableHead className="text-center">항목</TableHead>
                <TableHead className="text-center">이전값</TableHead>
                <TableHead className="text-center">변경값</TableHead>
                <TableHead className="text-center">변경자</TableHead>
                <TableHead className="text-center">변경일시</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    불러오는 중...
                  </TableCell>
                </TableRow>
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    변경 이력이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-center text-xs">{h.no}</TableCell>
                    <TableCell className="text-center text-xs font-medium">{h.level}</TableCell>
                    <TableCell className="text-center text-xs">{h.fieldLabel}</TableCell>
                    <TableCell className="text-center text-xs text-gray-500">
                      {h.oldValue ?? "-"}
                    </TableCell>
                    <TableCell className="text-center text-xs font-medium">{h.newValue}</TableCell>
                    <TableCell className="text-center text-xs">{h.changedByName}</TableCell>
                    <TableCell className="text-center text-xs">
                      {new Date(h.changedAt).toLocaleString("ko-KR", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
