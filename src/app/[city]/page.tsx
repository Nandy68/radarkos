"use client";

import { Suspense, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

function CityRedirectContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const city = (params?.city as string) || "purwokerto";
    const q = new URLSearchParams(searchParams.toString());
    q.set("city", city);
    router.replace(`/?${q.toString()}`);
  }, [params, searchParams, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="text-sm font-medium">Memuat radar kos...</span>
      </div>
    </div>
  );
}

export default function CityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <span className="text-sm font-medium">Memuat radar kos...</span>
          </div>
        </div>
      }
    >
      <CityRedirectContent />
    </Suspense>
  );
}
