import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-gray-50">
      <div className="text-center space-y-2">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <h2 className="text-xl font-semibold text-gray-700">
          페이지를 찾을 수 없습니다
        </h2>
        <p className="text-sm text-gray-500">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>
      </div>
      <Button asChild>
        <Link href="/level-management">메인으로 돌아가기</Link>
      </Button>
    </div>
  );
}
