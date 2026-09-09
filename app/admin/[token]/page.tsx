"use client";

/**
 * /admin/[token] — UI admin (dibuat Fase 1 Task 1.4).
 * Fase 2: di-refactor memakai komponen bersama SessionAdminView sehingga
 * fitur admin (pajak/service/diskon, info bayar, konfirmasi finalize)
 * identik dengan /s/[token]/admin.
 */
import SessionAdminView from "@/components/sessions/SessionAdminView";
import { useParams } from "next/navigation";

export default function AdminSessionPage() {
  const params = useParams<{ token: string }>();
  return <SessionAdminView backHref="/admin" token={params.token} />;
}
