import SessionAdminView from "@/components/sessions/SessionAdminView";

/**
 * /s/[token]/admin — panel admin dari link sesi (Task 2.2, Fase 2).
 * Memakai komponen bersama dengan /admin/[token]; tanpa login.
 * Catatan: params adalah Promise di Next.js 15+/16 → wajib di-await.
 */
export default async function SessionAdminPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SessionAdminView backHref="/" token={token} />;
}
