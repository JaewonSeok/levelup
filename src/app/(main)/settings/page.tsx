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

  useEffect(() => {
    fetchData(year);
    fetchHistory(year);
  }, [year, fetchData, fetchHistory]);

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
