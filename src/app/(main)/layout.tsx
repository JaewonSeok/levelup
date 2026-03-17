import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Sidebar from "@/components/layout/Sidebar";
import { ImpersonateProvider } from "@/context/ImpersonateContext";
import { ImpersonateBanner } from "@/components/layout/ImpersonateBanner";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <ImpersonateProvider>
      <div className="flex h-screen bg-gray-100">
        <Sidebar user={session.user} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <ImpersonateBanner userRole={session.user.role} />
          <div className="flex-1 overflow-y-auto">
            <div className="p-6">{children}</div>
          </div>
        </main>
      </div>
    </ImpersonateProvider>
  );
}
