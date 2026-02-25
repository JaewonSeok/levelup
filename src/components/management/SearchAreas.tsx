"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─────────────────────────────────────────
// 공유 타입
// ─────────────────────────────────────────

export interface BasicSearchState {
  department: string;
  team: string;
  keyword: string;
  isMet: string; // "all" | "Y" | "N"
}

export interface AdvancedSearchState extends BasicSearchState {
  position: string;
  level: string;
  employmentType: string;
  hireDateFrom: string;
  hireDateTo: string;
}

export interface SearchAreasProps {
  departments: string[];
  teams: string[];
  advanced: AdvancedSearchState;
  onAdvancedChange: (patch: Partial<AdvancedSearchState>) => void;
  onAdvancedSearch: () => void;
  loading?: boolean;
}

// ─────────────────────────────────────────
// 내부 서브 컴포넌트
// ─────────────────────────────────────────

const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
const POSITIONS = ["팀원", "팀장", "실장", "본부장"];

function IsMetRadio({
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
      <span className="text-sm font-medium whitespace-nowrap">충족</span>
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
// 검색 영역 (기본 + 상세)
// ─────────────────────────────────────────

export function SearchAreas({
  departments,
  teams,
  advanced,
  onAdvancedChange,
  onAdvancedSearch,
  loading = false,
}: SearchAreasProps) {
  return (
    <>
      {/* ── 검색 영역: 상세 조회 ──────────────────────── */}
      <div className="border rounded-md p-4 mb-4 bg-gray-50">
        {/* 첫 번째 행 */}
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">본부</span>
            <Select
              value={advanced.department || "__all__"}
              onValueChange={(v) =>
                onAdvancedChange({ department: v === "__all__" ? "" : v, team: "" })
              }
            >
              <SelectTrigger className="w-36 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">팀</span>
            <Select
              value={advanced.team || "__all__"}
              onValueChange={(v) => onAdvancedChange({ team: v === "__all__" ? "" : v })}
            >
              <SelectTrigger className="w-32 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">직책</span>
            <Select
              value={advanced.position || "__all__"}
              onValueChange={(v) => onAdvancedChange({ position: v === "__all__" ? "" : v })}
            >
              <SelectTrigger className="w-24 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">고용형태</span>
            <Select
              value={advanced.employmentType || "__all__"}
              onValueChange={(v) =>
                onAdvancedChange({ employmentType: v === "__all__" ? "" : v })
              }
            >
              <SelectTrigger className="w-24 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                <SelectItem value="REGULAR">정규직</SelectItem>
                <SelectItem value="CONTRACT">계약직</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">레벨</span>
            <Select
              value={advanced.level || "__all__"}
              onValueChange={(v) => onAdvancedChange({ level: v === "__all__" ? "" : v })}
            >
              <SelectTrigger className="w-20 bg-white h-8 text-sm">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체</SelectItem>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 두 번째 행 */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">입사일자</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advanced.hireDateFrom}
              onChange={(e) => onAdvancedChange({ hireDateFrom: e.target.value })}
            />
            <span className="text-sm text-muted-foreground">~</span>
            <input
              type="date"
              className="border rounded px-2 py-1 text-sm bg-white h-8"
              value={advanced.hireDateTo}
              onChange={(e) => onAdvancedChange({ hireDateTo: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium whitespace-nowrap">검색어</span>
            <Input
              className="w-40 bg-white h-8 text-sm"
              value={advanced.keyword}
              onChange={(e) => onAdvancedChange({ keyword: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onAdvancedSearch()}
              placeholder="이름 검색"
            />
          </div>

          <IsMetRadio
            name={`adv-isMet-${Math.random()}`}
            value={advanced.isMet}
            onChange={(v) => onAdvancedChange({ isMet: v })}
          />

          <Button onClick={onAdvancedSearch} disabled={loading} size="sm" className="h-8">
            검색
          </Button>
        </div>
      </div>
    </>
  );
}
