"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────

interface Reviewer {
  userId: string;
  reviewerName: string;
  reviewerRole: string;
  isCurrentUser: boolean;
  opinionId: string | null;
  opinionText: string | null;
  recommendation: boolean | null;
  savedAt: string | null;
  modifiedBy: string | null;
  modifiedAt: string | null;
}

interface OpinionData {
  review: { id: string };
  candidate: {
    id: string;
    year: number;
    user: {
      name: string;
      department: string;
      team: string;
      level: string | null;
      competencyLevel: string | null;
    };
  };
  pointCumulative: number;
  creditCumulative: number;
  reviewers: Reviewer[];
  currentUser: {
    id: string;
    role: string;
    department: string;
  };
}

interface RowState {
  text: string;
  rec: "추천" | "미추천" | "";
  isDirty: boolean;
  saving: boolean;
  savedJustNow: boolean;
}

interface OpinionModalProps {
  reviewId: string;
  onClose: () => void;
  /** 저장 성공 시 서버가 확정한 값 전달. reviewUpdated=true면 Review.recommendation도 업데이트됨 */
  onSaved: (reviewerRole: string, recommendation: boolean | null, reviewUpdated: boolean) => void;
  isSubmitted?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function OpinionModal({
  reviewId,
  onClose,
  onSaved,
  isSubmitted = false,
}: OpinionModalProps) {
  const [data, setData] = useState<OpinionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/reviews/${reviewId}/opinions`)
      .then((res) => res.json())
      .then((json: OpinionData) => {
        setData(json);
        const initial: Record<string, RowState> = {};
        for (const r of json.reviewers) {
          initial[r.userId] = {
            text: r.opinionText ?? "",
            rec:
              r.recommendation === true
                ? "추천"
                : r.recommendation === false
                ? "미추천"
                : "",
            isDirty: false,
            saving: false,
            savedJustNow: false,
          };
        }
        setRowStates(initial);
      })
      .finally(() => setLoading(false));
  }, [reviewId]);

  const isAdmin = data?.currentUser.role === "SYSTEM_ADMIN";

  // 행 편집 가능 여부
  function getEditable(reviewer: Reviewer): boolean {
    if (isSubmitted) return false;
    if (reviewer.reviewerRole === "인사팀장") return !!isAdmin;
    return reviewer.isCurrentUser || !!isAdmin;
  }

  function handleChange(
    userId: string,
    field: "text" | "rec",
    value: string
  ) {
    setRowStates((prev) => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        [field]: value,
        isDirty: true,
        savedJustNow: false,
      },
    }));
  }

  async function handleSave(reviewer: Reviewer) {
    const rs = rowStates[reviewer.userId];
    if (!rs) return;

    setRowStates((prev) => ({
      ...prev,
      [reviewer.userId]: { ...prev[reviewer.userId], saving: true },
    }));

    try {
      const body: Record<string, unknown> = {
        opinionText: rs.text,
        recommendation:
          rs.rec === "추천" ? true : rs.rec === "미추천" ? false : null,
      };

      // admin이 타인 행을 저장할 때 reviewerId 전달
      if (isAdmin && !reviewer.isCurrentUser) {
        body.reviewerId = reviewer.userId;
      }

      const res = await fetch(`/api/reviews/${reviewId}/opinions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // 성공/실패 모두 응답 본문을 먼저 읽는다
      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.error ?? "저장 실패");
      }

      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: {
          ...prev[reviewer.userId],
          saving: false,
          isDirty: false,
          savedJustNow: true,
        },
      }));

      // 2초 후 "저장됨" → "저장"
      setTimeout(() => {
        setRowStates((prev) => ({
          ...prev,
          [reviewer.userId]: {
            ...prev[reviewer.userId],
            savedJustNow: false,
          },
        }));
      }, 2000);

      // 서버가 확정한 값 + Review 업데이트 여부를 부모에게 전달
      onSaved(
        resData.reviewerRole ?? "",
        resData.recommendation ?? null,
        resData.reviewUpdated === true
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
      setRowStates((prev) => ({
        ...prev,
        [reviewer.userId]: { ...prev[reviewer.userId], saving: false },
      }));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>심사 의견 입력</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">
            불러오는 중...
          </div>
        ) : !data ? (
          <div className="py-10 text-center text-muted-foreground">
            데이터를 불러올 수 없습니다.
          </div>
        ) : (
          <>
            {/* ── 대상자 요약 ─────────────────────────────────── */}
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm mb-4">
              <div className="grid grid-cols-6 gap-x-4 gap-y-1 mb-2">
                <span className="font-semibold text-blue-700">소속/성명</span>
                <span>{data.candidate.user.department}</span>
                <span>{data.candidate.user.team}</span>
                <span className="font-semibold">{data.candidate.user.name}</span>
                <span className="font-semibold text-blue-700">역량레벨</span>
                <span>
                  {data.candidate.user.competencyLevel ??
                    data.candidate.user.level ??
                    "-"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-1">
                <span className="font-semibold text-blue-700">포인트</span>
                <span>{data.pointCumulative.toFixed(1)}</span>
                <span className="font-semibold text-blue-700">학점</span>
                <span>{data.creditCumulative.toFixed(1)}</span>
              </div>
            </div>

            {/* ── 본부장 의견 행 ──────────────────────────────── */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                본부장 의견
              </h3>
              <div className="space-y-2">
                {data.reviewers.map((reviewer) => {
                  const isHR = reviewer.reviewerRole === "인사팀장";
                  const isOwn = reviewer.reviewerRole === "소속본부장";
                  const editable = getEditable(reviewer);
                  const rs: RowState = rowStates[reviewer.userId] ?? {
                    text: reviewer.opinionText ?? "",
                    rec:
                      reviewer.recommendation === true
                        ? "추천"
                        : reviewer.recommendation === false
                        ? "미추천"
                        : "",
                    isDirty: false,
                    saving: false,
                    savedJustNow: false,
                  };

                  return (
                    <div
                      key={reviewer.userId}
                      className={`border rounded-md p-3 ${
                        isOwn
                          ? "bg-blue-50 border-blue-300"
                          : isHR
                          ? "bg-amber-50 border-amber-200"
                          : "bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* 검토자 이름 */}
                        <div className="w-28 flex-shrink-0 pt-1">
                          <p
                            className={`text-xs font-semibold ${
                              isOwn
                                ? "text-blue-700"
                                : isHR
                                ? "text-amber-700"
                                : "text-gray-600"
                            }`}
                          >
                            {reviewer.reviewerName}
                          </p>
                          {isOwn && (
                            <p className="text-xs text-blue-500">(소속)</p>
                          )}
                          {isHR && (
                            <p className="text-xs text-amber-600">(추가보고용)</p>
                          )}
                          {reviewer.modifiedBy && (
                            <p className="text-xs text-purple-600 font-medium mt-0.5">
                              (관리자 수정)
                            </p>
                          )}
                        </div>

                        {/* 의견 입력 영역 */}
                        <div className="flex-1">
                          {editable ? (
                            <textarea
                              className="w-full text-xs border rounded px-2 py-1.5 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-white"
                              value={rs.text}
                              onChange={(e) =>
                                handleChange(reviewer.userId, "text", e.target.value)
                              }
                              placeholder="의견을 입력하세요."
                            />
                          ) : (
                            <div
                              className={`text-xs text-gray-600 min-h-[52px] rounded px-2 py-1.5 border ${
                                isHR ? "bg-gray-100" : "bg-gray-50"
                              }`}
                            >
                              {reviewer.opinionText ?? (
                                <span className="text-gray-400">미입력</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 추천여부 + 저장 (HR 제외) */}
                        {!isHR && (
                          <div className="flex flex-col items-end gap-1.5 w-24 flex-shrink-0">
                            {editable ? (
                              <>
                                {/* 추천여부 드롭다운 */}
                                <select
                                  className={`w-full h-7 text-xs rounded border px-1 bg-white focus:outline-none focus:ring-1 ${
                                    rs.rec === "추천"
                                      ? "border-green-400 text-green-700 focus:ring-green-300"
                                      : rs.rec === "미추천"
                                      ? "border-red-400 text-red-600 focus:ring-red-300"
                                      : "border-gray-300 text-gray-400"
                                  }`}
                                  value={rs.rec}
                                  onChange={(e) =>
                                    handleChange(reviewer.userId, "rec", e.target.value)
                                  }
                                >
                                  <option value="">선택</option>
                                  <option value="추천">추천</option>
                                  <option value="미추천">미추천</option>
                                </select>

                                {/* 저장 버튼 */}
                                <Button
                                  size="sm"
                                  className={`h-6 text-xs px-2 w-full transition-colors ${
                                    rs.savedJustNow
                                      ? "bg-green-600 hover:bg-green-700 text-white border-0"
                                      : rs.isDirty
                                      ? "bg-blue-600 hover:bg-blue-700 text-white border-0"
                                      : ""
                                  }`}
                                  variant={
                                    rs.savedJustNow || rs.isDirty
                                      ? "default"
                                      : "outline"
                                  }
                                  disabled={rs.saving}
                                  onClick={() => handleSave(reviewer)}
                                >
                                  {rs.saving
                                    ? "..."
                                    : rs.savedJustNow
                                    ? "저장됨"
                                    : "저장"}
                                </Button>
                              </>
                            ) : (
                              /* 읽기 전용: 텍스트로만 표시 */
                              <span
                                className={`text-xs font-medium ${
                                  reviewer.recommendation === true
                                    ? "text-green-600"
                                    : reviewer.recommendation === false
                                    ? "text-red-500"
                                    : "text-gray-400"
                                }`}
                              >
                                {reviewer.recommendation === true
                                  ? "추천"
                                  : reviewer.recommendation === false
                                  ? "미추천"
                                  : "-"}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 인사팀장 저장 영역 (admin만 표시) */}
                        {isHR && editable && (
                          <div className="flex flex-col items-end gap-1.5 w-20 flex-shrink-0">
                            <Button
                              size="sm"
                              className={`h-6 text-xs px-2 w-full transition-colors ${
                                rs.savedJustNow
                                  ? "bg-green-600 hover:bg-green-700 text-white border-0"
                                  : rs.isDirty
                                  ? "bg-blue-600 hover:bg-blue-700 text-white border-0"
                                  : ""
                              }`}
                              variant={
                                rs.savedJustNow || rs.isDirty ? "default" : "outline"
                              }
                              disabled={rs.saving}
                              onClick={() => handleSave(reviewer)}
                            >
                              {rs.saving
                                ? "..."
                                : rs.savedJustNow
                                ? "저장됨"
                                : "저장"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                닫기
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
