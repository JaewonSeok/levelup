"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { parseExcelFile, type ParsedEmployee } from "@/lib/excel/parse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Upload,
  Download,
  FileSpreadsheet,
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Trash2,
} from "lucide-react";

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface UploadResult {
  totalCount: number;
  successCount: number;
  skipCount: number;
  errorCount: number;
  errors: { row: number; sheet: string; name: string; errors: string[] }[];
}

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const MAX_PREVIEW_ROWS = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const PREVIEW_COLS = [
  { key: "rowIndex", label: "행" },
  { key: "department", label: "본부" },
  { key: "team", label: "팀" },
  { key: "name", label: "이름" },
  { key: "position", label: "직책" },
  { key: "level", label: "현재레벨" },
  { key: "hireDateStr", label: "입사일자" },
  { key: "yearsOfService", label: "연차" },
  { key: "competencyLevel", label: "역량레벨" },
  { key: "levelUpYear", label: "레벨업연도" },
] as const;

// ─────────────────────────────────────────
// 셀 값 표시 헬퍼
// ─────────────────────────────────────────

function displayValue(row: ParsedEmployee, key: string): string {
  const val = (row as unknown as Record<string, unknown>)[key];
  if (val == null || val === "") return "";
  return String(val);
}

// ─────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────

export default function UploadPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "SYSTEM_ADMIN";

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedEmployee[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<"update" | "skip">("skip");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = useMemo(
    () => parsedRows?.filter((r) => r.errors.length === 0) ?? [],
    [parsedRows]
  );
  const errorRows = useMemo(
    () => parsedRows?.filter((r) => r.errors.length > 0) ?? [],
    [parsedRows]
  );
  const previewRows = useMemo(
    () => parsedRows?.slice(0, MAX_PREVIEW_ROWS) ?? [],
    [parsedRows]
  );

  // ── 파일 처리 ──────────────────────────────────────────────

  const processFile = useCallback((f: File) => {
    setFileError(null);
    setUploadError(null);
    setResult(null);

    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setFileError(".xlsx 파일만 허용됩니다.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError("파일 크기는 10MB 이하여야 합니다.");
      return;
    }

    setFile(f);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const rows = parseExcelFile(buffer);
        setParsedRows(rows);
      } catch {
        setFileError("Excel 파싱 오류: 파일 형식을 확인해주세요.");
        setParsedRows(null);
      }
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) processFile(f);
    },
    [processFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) processFile(f);
    },
    [processFile]
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setParsedRows(null);
    setFileError(null);
    setUploadError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── 업로드 제출 ────────────────────────────────────────────

  const handleUpload = useCallback(async () => {
    if (!file || validRows.length === 0) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("duplicatePolicy", duplicatePolicy);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data: UploadResult & { error?: string } = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? "업로드 실패");
        return;
      }

      setResult(data);
      setParsedRows(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setUploadError("업로드 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
    }
  }, [file, validRows.length, duplicatePolicy]);

  // ── 전체 데이터 초기화 ──────────────────────────────────────

  const handleDataReset = useCallback(async () => {
    if (!window.confirm(
      "⚠️ 전체 직원 데이터를 초기화하시겠습니까?\n\n" +
      "• 모든 직원 계정 (일반/팀장/실장) 삭제\n" +
      "• 포인트 / 학점 / 평가등급 / 가감점 삭제\n" +
      "• 대상자 / 심사 / 확정 데이터 삭제\n" +
      "• 업로드 이력 삭제\n\n" +
      "시스템 계정(인사팀/대표이사/본부장)은 유지됩니다.\n" +
      "이 작업은 되돌릴 수 없습니다."
    )) return;
    setIsResetting(true);
    try {
      const res = await fetch("/api/upload/reset", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "초기화 실패");
      alert("전체 직원 데이터가 초기화되었습니다.\n엑셀을 다시 업로드해주세요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "초기화 중 오류가 발생했습니다.");
    } finally {
      setIsResetting(false);
    }
  }, []);

  // ─────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── 헤더 ─────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">엑셀 업로드</h1>
          <p className="text-sm text-muted-foreground mt-1">
            본부/팀별 직원 데이터를 .xlsx 파일로 업로드합니다. (인사팀 전용)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-50"
              onClick={handleDataReset}
              disabled={isResetting}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {isResetting ? "초기화 중..." : "전체 데이터 초기화"}
            </Button>
          )}
          <a href="/api/upload/template" download="levelup_upload_template.xlsx">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              템플릿 다운로드
            </Button>
          </a>
        </div>
      </div>

      {/* ── 드롭존 (파일 미선택 상태) ──────────── */}
      {!parsedRows && !result && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors select-none",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
          )}
        >
          <FileSpreadsheet
            className={cn(
              "mx-auto h-14 w-14 transition-colors",
              dragOver ? "text-primary" : "text-gray-400"
            )}
          />
          <p className="mt-4 text-sm font-semibold text-gray-700">
            .xlsx 파일을 여기에 드래그하거나 클릭하여 선택
          </p>
          <p className="mt-1 text-xs text-gray-500">
            최대 10MB · .xlsx 형식 · 다중 시트 지원
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* ── 파일 파싱 오류 ───────────────────── */}
      {fileError && (
        <div className="flex items-start gap-3 rounded-md bg-red-50 border border-red-200 p-4">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-700">{fileError}</p>
            <button
              className="mt-1 text-xs text-red-500 underline"
              onClick={handleReset}
            >
              다시 선택하기
            </button>
          </div>
        </div>
      )}

      {/* ── 미리보기 ────────────────────────── */}
      {parsedRows && parsedRows.length > 0 && (
        <div className="space-y-4">

          {/* 요약 배지 + 취소 */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-700 mr-1">
                {file?.name}
              </span>
              <Badge variant="secondary">전체 {parsedRows.length}행</Badge>
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                정상 {validRows.length}건
              </Badge>
              {errorRows.length > 0 && (
                <Badge variant="destructive">오류 {errorRows.length}건</Badge>
              )}
              {parsedRows.length > MAX_PREVIEW_ROWS && (
                <span className="text-xs text-muted-foreground">
                  (미리보기: 상위 {MAX_PREVIEW_ROWS}행)
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <X className="h-4 w-4 mr-1" />
              취소
            </Button>
          </div>

          {/* 미리보기 테이블 */}
          <div className="rounded-md border overflow-auto max-h-[420px]">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {PREVIEW_COLS.map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-3 py-2 text-left font-semibold text-gray-600 border-b"
                    >
                      {label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b">
                    상태
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const hasError = row.errors.length > 0;
                  return (
                    <tr
                      key={`${row.sheet}-${row.rowIndex}`}
                      className={cn(
                        "border-b last:border-0",
                        hasError
                          ? "bg-red-50 hover:bg-red-100"
                          : "hover:bg-gray-50"
                      )}
                    >
                      {PREVIEW_COLS.map(({ key }) => (
                        <td
                          key={key}
                          className={cn(
                            "px-3 py-1.5",
                            key === "name" && "font-medium",
                            key === "rowIndex" && "text-gray-400"
                          )}
                        >
                          {displayValue(row, key)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        {hasError ? (
                          <span className="text-red-600">
                            {row.errors.join(" / ")}
                          </span>
                        ) : (
                          <span className="text-green-600 font-medium">
                            정상
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 오류 행 전체 목록 (미리보기 범위 밖 오류 포함) */}
          {errorRows.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <p className="text-sm font-medium text-amber-800">
                  오류 {errorRows.length}건은 업로드에서 제외됩니다.
                </p>
              </div>
              <ul className="text-xs space-y-0.5 max-h-28 overflow-y-auto pl-6 list-disc">
                {errorRows.map((r) => (
                  <li key={`${r.sheet}-${r.rowIndex}`} className="text-amber-700">
                    {r.sheet !== "직원정보" && `[${r.sheet}] `}
                    행 {r.rowIndex}
                    {r.name ? ` (${r.name})` : ""}: {r.errors.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 중복 처리 정책 */}
          <div className="flex items-center gap-6 rounded-md bg-gray-50 border px-5 py-3">
            <span className="text-sm font-medium text-gray-700 shrink-0">
              동일 사원(이름+입사일) 존재 시:
            </span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="duplicatePolicy"
                value="skip"
                checked={duplicatePolicy === "skip"}
                onChange={() => setDuplicatePolicy("skip")}
                className="accent-primary"
              />
              <span className="text-sm">
                <span className="font-medium">스킵</span>{" "}
                <span className="text-muted-foreground">(기존 데이터 유지)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="duplicatePolicy"
                value="update"
                checked={duplicatePolicy === "update"}
                onChange={() => setDuplicatePolicy("update")}
                className="accent-primary"
              />
              <span className="text-sm">
                <span className="font-medium">업데이트</span>{" "}
                <span className="text-muted-foreground">(인사정보 덮어쓰기)</span>
              </span>
            </label>
          </div>

          {/* 업로드 오류 */}
          {uploadError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {uploadError}
            </div>
          )}

          {/* 업로드 버튼 */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {validRows.length === 0
                ? "유효한 데이터가 없습니다."
                : `유효한 데이터 ${validRows.length}건을 DB에 저장합니다.`}
            </p>
            <Button
              onClick={handleUpload}
              disabled={isUploading || validRows.length === 0}
              className="min-w-36"
            >
              {isUploading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  업로드 중...
                </span>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  업로드 ({validRows.length}건)
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── 업로드 결과 ─────────────────────── */}
      {result && (
        <div className="rounded-xl border p-6 space-y-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <h2 className="text-lg font-bold">업로드 완료</h2>
          </div>

          {/* 결과 카드 */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "전체", value: result.totalCount, color: "bg-gray-50 text-gray-800" },
              { label: "성공", value: result.successCount, color: "bg-green-50 text-green-700" },
              { label: "스킵", value: result.skipCount, color: "bg-yellow-50 text-yellow-700" },
              { label: "오류", value: result.errorCount, color: "bg-red-50 text-red-700" },
            ].map(({ label, value, color }) => (
              <div key={label} className={cn("rounded-lg p-4 text-center", color)}>
                <div className="text-3xl font-bold">{value}</div>
                <div className="text-xs mt-1 font-medium opacity-70">{label}</div>
              </div>
            ))}
          </div>

          {/* 오류 목록 */}
          {result.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-700">
                오류 상세 ({result.errors.length}건)
              </p>
              <div className="rounded-md border border-red-100 bg-red-50 p-3 max-h-40 overflow-y-auto">
                <ul className="text-xs space-y-0.5 list-disc pl-4">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-red-600">
                      {e.sheet !== "직원정보" && `[${e.sheet}] `}
                      행 {e.row}
                      {e.name !== "(없음)" ? ` (${e.name})` : ""}: {e.errors.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <Button variant="outline" onClick={handleReset}>
            <Upload className="mr-2 h-4 w-4" />
            새 파일 업로드
          </Button>
        </div>
      )}
    </div>
  );
}
