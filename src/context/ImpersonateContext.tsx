"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface ImpersonateCtx {
  impersonateDept: string | null;
  setImpersonateDept: (dept: string | null) => void;
}

const ImpersonateContext = createContext<ImpersonateCtx>({
  impersonateDept: null,
  setImpersonateDept: () => {},
});

export const useImpersonate = () => useContext(ImpersonateContext);

export function ImpersonateProvider({ children }: { children: ReactNode }) {
  const [impersonateDept, setImpersonateDept] = useState<string | null>(null);
  return (
    <ImpersonateContext.Provider value={{ impersonateDept, setImpersonateDept }}>
      {children}
    </ImpersonateContext.Provider>
  );
}
