"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// ── 상수 ──────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  "경영지원본부",
  "연구개발본부",
  "품질경영본부",
  "마케팅본부",
  "글로벌기술지원본부",
  "국내영업총괄본부",
] as const;

// ── Types ─────────────────────────────────────────────────────────────
// [KISA2021-22] residentIdLast7(개인식별정보)는 API에서 반환하지 않음
interface Account {
  id: string;
  name: string;
  email: string;
  department: string;
  createdAt: string;
}

interface FormState {
  name: string;
  emailPrefix: string;
  department: string;
  residentIdLast7: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  emailPrefix: "",
  department: "",
  residentIdLast7: "",
};

// ── Component ─────────────────────────────────────────────────────────
export default function AccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // 추가/수정 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 삭제 확인 모달
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── 권한 체크 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "SYSTEM_ADMIN") {
      router.replace("/level-management");
    }
  }, [session, status, router]);

  // ── 데이터 조회 ────────────────────────────────────────────────────
  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts");
      const json = await res.json();
      setAccounts(json.accounts ?? []);
    } catch {
      toast.error("계정 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user.role === "SYSTEM_ADMIN") {
      fetchAccounts();
    }
  }, [session, fetchAccounts]);

  // ── 모달 열기 ──────────────────────────────────────────────────────
  function openAddModal() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEditModal(account: Account) {
    setEditTarget(account);
    setForm({
      name: account.name,
      emailPrefix: account.email.replace("@rsupport.com", ""),
      department: account.department,
      residentIdLast7: "",
    });
    setModalOpen(true);
  }

  // ── 저장 (추가/수정) ───────────────────────────────────────────────
  async function handleSubmit() {
    const isEdit = !!editTarget;

    if (!form.name || !form.emailPrefix || !form.department) {
      toast.error("이름, 이메일, 본부를 입력해 주세요.");
      return;
    }
    if (!isEdit && !form.residentIdLast7) {
      toast.error("주민번호 뒷 7자리를 입력해 주세요.");
      return;
    }
    if (form.residentIdLast7 && !/^\d{7}$/.test(form.residentIdLast7)) {
      toast.error("주민번호 뒷 7자리는 정확히 7자리 숫자여야 합니다.");
      return;
    }

    setSubmitting(true);
    try {
      const url = isEdit ? `/api/accounts/${editTarget!.id}` : "/api/accounts";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "저장에 실패했습니다.");
        return;
      }

      toast.success(isEdit ? "계정이 수정되었습니다." : "계정이 추가되었습니다.");
      setModalOpen(false);
      fetchAccounts();
    } catch {
      toast.error("저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 삭제 ──────────────────────────────────────────────────────────
  function openDeleteModal(account: Account) {
    setDeleteTarget(account);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "삭제에 실패했습니다.");
        return;
      }
      toast.success("계정이 삭제되었습니다.");
      setDeleteOpen(false);
      setDeleteTarget(null);
      fetchAccounts();
    } catch {
      toast.error("삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  // ── 로딩/권한 대기 ─────────────────────────────────────────────────
  if (status === "loading" || !session) return null;
  if (session.user.role !== "SYSTEM_ADMIN") return null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">본부장 계정 관리</h1>
        <Button onClick={openAddModal}>본부장 계정 추가</Button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-12 text-center">No.</TableHead>
              <TableHead>본부명</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>비밀번호 설정</TableHead>
              <TableHead className="text-center">등록일</TableHead>
              <TableHead className="w-28 text-center">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  등록된 본부장 계정이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((acc, idx) => (
                <TableRow key={acc.id}>
                  <TableCell className="text-center text-sm">{idx + 1}</TableCell>
                  <TableCell className="text-sm">{acc.department}</TableCell>
                  <TableCell className="text-sm">{acc.name}</TableCell>
                  <TableCell className="text-sm">{acc.email}</TableCell>
                  <TableCell className="text-sm tracking-widest text-gray-500">
                    ●●●●●●●
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {new Date(acc.createdAt).toLocaleDateString("ko-KR")}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => openEditModal(acc)}
                      >
                        수정
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => openDeleteModal(acc)}
                      >
                        삭제
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 추가/수정 모달 */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "본부장 계정 수정" : "본부장 계정 추가"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 본부 */}
            <div className="space-y-1.5">
              <Label>본부</Label>
              <Select
                value={form.department}
                onValueChange={(v) => setForm((f) => ({ ...f, department: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="본부를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 이름 */}
            <div className="space-y-1.5">
              <Label>이름</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="홍길동"
              />
            </div>

            {/* 이메일 */}
            <div className="space-y-1.5">
              <Label>이메일</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={form.emailPrefix}
                  onChange={(e) => setForm((f) => ({ ...f, emailPrefix: e.target.value }))}
                  placeholder="아이디"
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  @rsupport.com
                </span>
              </div>
            </div>

            {/* 주민번호 뒷 7자리 */}
            <div className="space-y-1.5">
              <Label>초기 비밀번호 (주민번호 뒷 7자리)</Label>
              <Input
                type="password"
                value={form.residentIdLast7}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 7);
                  setForm((f) => ({ ...f, residentIdLast7: val }));
                }}
                placeholder="0000000"
                maxLength={7}
              />
              <p className="text-xs text-muted-foreground">
                {editTarget
                  ? "입력 시 비밀번호가 새 주민번호 뒷 7자리로 재설정됩니다. 변경하지 않으려면 비워두세요."
                  : "주민번호 뒷 7자리가 초기 로그인 비밀번호로 설정됩니다. (7자리 숫자)"}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 모달 */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>계정 삭제 확인</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 py-2">
            <span className="font-semibold">{deleteTarget?.name}</span> ({deleteTarget?.email})
            계정을 삭제하시겠습니까?
            <br />이 작업은 되돌릴 수 없습니다.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
