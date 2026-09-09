"use client";

/**
 * SessionAdminView — UI admin sesi (Task 2.2, Fase 2).
 *
 * Dipakai bersama oleh /admin/[token] (admin Fase 1) dan /s/[token]/admin
 * (panel admin versi peserta-view, Fase 2). Fitur:
 * - Matriks centang siapa makan apa + tambah item/peserta (draft).
 * - Edit pajak/service/diskon (draft).
 * - Edit info pembayaran: BCA, QRIS URL, upload gambar QRIS (draft).
 * - Tombol "Selesai & Hitung" dengan modal konfirmasi → finalize →
 *   redirect ke /s/[token]/result.
 *
 * Data di-fetch dari GET /api/sessions/[token]; semua tulisan lewat API
 * routes Fase 1 (RLS anon). Realtime menyusul di Fase 3.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSessionRealtime } from "@/lib/hooks/use-session-realtime";
import type { RealtimeSelectionEvent } from "@/lib/hooks/use-session-realtime";
import type {
  ParticipantDto,
  SessionDetailDto,
  SessionDto,
} from "@/lib/api/types";
import { cn, formatRupiah } from "@/lib/utils";

export default function SessionAdminView({
  token,
  backHref,
}: {
  token: string;
  /** Link "kembali" di header (mis. /admin atau /). */
  backHref: string;
}) {
  const router = useRouter();

  const [detail, setDetail] = useState<SessionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const load = () => setRefreshKey((k) => k + 1);

  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newParticipant, setNewParticipant] = useState("");
  const [taxInput, setTaxInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [discountInput, setDiscountInput] = useState("");
  const [bcaInput, setBcaInput] = useState("");
  const [qrisInput, setQrisInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Pola fetching React docs: ignore flag + cleanup.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${token}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(json.error ?? "Gagal memuat sesi.");
          return;
        }
        setError(null);
        setDetail(json as SessionDetailDto);
        setTaxInput(String(json.session.tax));
        setServiceInput(String(json.session.service_charge));
        setDiscountInput(String(json.session.discount));
        setBcaInput(json.session.payer_bca ?? "");
        setQrisInput(json.session.payer_qris_url ?? "");
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : "Gagal memuat sesi.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [token, refreshKey]);

  const claimedSubtotal = useMemo(
    () =>
      detail?.items
        .filter((i) => i.selections.length > 0)
        .reduce((a, i) => a + i.price, 0) ?? 0,
    [detail]
  );

  // ---------------------------------------------------------------
  // Realtime (Fase 3): matriks & peserta live; finalized live.
  // ---------------------------------------------------------------
  const applySelection = useCallback((ev: RealtimeSelectionEvent) => {
    setDetail((prev) =>
      !prev
        ? prev
        : {
            ...prev,
            items: prev.items.map((it) => {
              if (it.id !== ev.itemId) return it;
              const has = it.selections.includes(ev.participantId);
              if (ev.added && !has) {
                return {
                  ...it,
                  selections: [...it.selections, ev.participantId],
                };
              }
              if (!ev.added && has) {
                return {
                  ...it,
                  selections: it.selections.filter(
                    (id) => id !== ev.participantId
                  ),
                };
              }
              return it;
            }),
          }
    );
  }, []);

  const applyParticipant = useCallback((p: ParticipantDto) => {
    setDetail((prev) =>
      !prev || prev.participants.some((x) => x.id === p.id)
        ? prev
        : { ...prev, participants: [...prev.participants, p] }
    );
  }, []);

  const applySessionUpdate = useCallback((s: SessionDto) => {
    setDetail((prev) =>
      !prev || prev.session.id !== s.id ? prev : { ...prev, session: s }
    );
  }, []);

  const { status: rtStatus, onlineNames } = useSessionRealtime({
    token,
    sessionId: detail?.session.id ?? "",
    displayName: "Admin",
    subscribeSessionUpdates: true,
    onSelection: applySelection,
    onParticipant: applyParticipant,
    onSessionUpdate: applySessionUpdate,
  });

  async function act(
    fn: () => Promise<Response>,
    successMessage?: string
  ): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? `Gagal (HTTP ${res.status}).`);
        return false;
      }
      if (successMessage) setNotice(successMessage);
      load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (itemId: string, participantId: string, selected: boolean) =>
    act(() =>
      fetch(`/api/sessions/${token}/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participantId, selected }),
      })
    );

  const finalize = async () => {
    setConfirmOpen(false);
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${token}/finalize`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? `Gagal finalize (HTTP ${res.status}).`);
        return;
      }
      router.push(`/s/${token}/result`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal finalize.");
    } finally {
      setBusy(false);
    }
  };

  const uploadQris = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/sessions/${token}/qris`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Gagal upload QRIS (HTTP ${res.status}).`);
        return;
      }
      setQrisInput(json.url as string);
      setNotice("Gambar QRIS terunggah. Jangan lupa simpan perubahan.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal upload QRIS.");
    } finally {
      setUploading(false);
    }
  };

  // ---------------------------------------------------------------
  // Render: loading / error.
  // ---------------------------------------------------------------
  if (error && !detail) {
    return (
      <main className="flex flex-1 flex-col gap-4 px-5 pt-10 pb-10">
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
        <a className="text-sm text-emerald-700 underline" href={backHref}>
          ← Kembali
        </a>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-5 pt-10 pb-10">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-zinc-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-zinc-200" />
      </main>
    );
  }

  const { session, items, participants } = detail;
  const isDraft = session.status === "draft";
  const unclaimed = items.filter((i) => i.selections.length === 0);

  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-8 pb-10">
      <header>
        <a
          className="text-xs font-semibold text-emerald-700 underline"
          href={backHref}
        >
          ← Panel admin
        </a>
        <h1 className="mt-2 text-2xl font-bold">
          Sesi <span data-testid="session-token">{session.token}</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Status: <strong>{session.status}</strong> · bagikan link{" "}
          <code className="rounded bg-zinc-100 px-1">/s/{token}</code> ke
          peserta.
        </p>
        <div
          className="mt-1 flex items-center gap-1 text-xs text-zinc-500"
          data-testid="presence"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              rtStatus === "live"
                ? "bg-emerald-500"
                : rtStatus === "connecting"
                  ? "bg-amber-400"
                  : "bg-red-400"
            )}
            aria-hidden
          />
          <span>
            {rtStatus === "live"
              ? `realtime live${onlineNames.length > 0 ? ` · online: ${onlineNames.join(", ")}` : ""}`
              : rtStatus === "connecting"
                ? "menghubungkan realtime…"
                : "realtime terputus"}
          </span>
        </div>
      </header>

      {notice && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Matriks siapa makan apa */}
      <Card>
        <CardHeader>
          <CardTitle>Siapa makan apa?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2 text-right">Harga</th>
                  {participants.map((p) => (
                    <th key={p.id} className="px-1 py-2 text-center">
                      {p.display_name.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td
                      className="py-4 text-zinc-500"
                      colSpan={2 + participants.length}
                    >
                      Belum ada item.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-2">
                      {item.name}
                      {item.qty > 1 && (
                        <span className="ml-1 text-xs text-zinc-400">
                          ×{item.qty}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {formatRupiah(item.price)}
                    </td>
                    {participants.map((p) => {
                      const checked = item.selections.includes(p.id);
                      return (
                        <td key={p.id} className="px-1 py-1 text-center">
                          <input
                            aria-label={`${p.display_name} makan ${item.name}`}
                            checked={checked}
                            className="size-5 accent-emerald-600 disabled:opacity-40"
                            disabled={!isDraft || busy}
                            type="checkbox"
                            onChange={() =>
                              void toggle(item.id, p.id, !checked)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unclaimed.length > 0 && isDraft && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Belum diklaim: {unclaimed.map((i) => i.name).join(", ")} —
              finalize akan ditolak sampai semua item punya pemilih.
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Subtotal terklaim: {formatRupiah(claimedSubtotal)} dari{" "}
            {formatRupiah(session.subtotal)}
          </p>
        </CardContent>
      </Card>

      {isDraft && (
        <>
          {/* Tambah item & peserta */}
          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Tambah item</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Nama item"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                />
                <Input
                  className="w-28"
                  inputMode="numeric"
                  placeholder="Harga"
                  value={newItemPrice}
                  onChange={(e) =>
                    setNewItemPrice(e.target.value.replace(/[^\d]/g, ""))
                  }
                />
                <Button
                  disabled={busy || !newItemName.trim() || !newItemPrice}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        fetch(`/api/sessions/${token}/items`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            name: newItemName.trim(),
                            price: Number(newItemPrice),
                          }),
                        }),
                      "Item ditambahkan."
                    );
                    if (ok) {
                      setNewItemName("");
                      setNewItemPrice("");
                    }
                  }}
                >
                  +
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tambah peserta</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Nama peserta"
                  value={newParticipant}
                  onChange={(e) => setNewParticipant(e.target.value)}
                />
                <Button
                  disabled={busy || !newParticipant.trim()}
                  onClick={async () => {
                    const ok = await act(
                      () =>
                        fetch(`/api/sessions/${token}/participants`, {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            displayName: newParticipant.trim(),
                          }),
                        }),
                      "Peserta ditambahkan."
                    );
                    if (ok) setNewParticipant("");
                  }}
                >
                  +
                </Button>
              </CardContent>
            </Card>

            {/* Pajak / service / diskon (Task 2.2) */}
            <Card>
              <CardHeader>
                <CardTitle>Pajak, service & diskon</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-zinc-600">
                    Pajak
                    <Input
                      inputMode="numeric"
                      value={taxInput}
                      onChange={(e) =>
                        setTaxInput(e.target.value.replace(/[^\d]/g, ""))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-600">
                    Service
                    <Input
                      inputMode="numeric"
                      value={serviceInput}
                      onChange={(e) =>
                        setServiceInput(e.target.value.replace(/[^\d]/g, ""))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-zinc-600">
                    Diskon
                    <Input
                      inputMode="numeric"
                      value={discountInput}
                      onChange={(e) =>
                        setDiscountInput(e.target.value.replace(/[^\d]/g, ""))
                      }
                    />
                  </label>
                </div>
                <p className="text-xs text-zinc-500">
                  Grand total:{" "}
                  <strong>
                    {formatRupiah(
                      session.subtotal +
                        (Number(taxInput) || 0) +
                        (Number(serviceInput) || 0) -
                        (Number(discountInput) || 0)
                    )}
                  </strong>
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        fetch(`/api/sessions/${token}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            tax: Number(taxInput) || 0,
                            service_charge: Number(serviceInput) || 0,
                            discount: Number(discountInput) || 0,
                          }),
                        }),
                      "Nominal diperbarui."
                    )
                  }
                >
                  Simpan pajak/service/diskon
                </Button>
              </CardContent>
            </Card>

            {/* Info pembayaran (Task 2.2): BCA, QRIS URL, upload QRIS */}
            <Card>
              <CardHeader>
                <CardTitle>Info pembayaran</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Input
                  aria-label="Info rekening BCA"
                  placeholder="BCA: 1234567890 a.n. Nama"
                  value={bcaInput}
                  onChange={(e) => setBcaInput(e.target.value)}
                />
                <Input
                  aria-label="URL QRIS"
                  placeholder="URL QRIS (opsional)"
                  value={qrisInput}
                  onChange={(e) => setQrisInput(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Upload gambar QRIS"
                    className="hidden"
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadQris(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    disabled={busy || uploading}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? "Mengunggah…" : "📷 Upload gambar QRIS"}
                  </Button>
                  {session.receipt_image_url && (
                    <span className="text-xs text-zinc-500">
                      struk tersimpan ✓
                    </span>
                  )}
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        fetch(`/api/sessions/${token}`, {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            payer_bca: bcaInput,
                            payer_qris_url: qrisInput,
                          }),
                        }),
                      "Info pembayaran disimpan."
                    )
                  }
                  variant="secondary"
                >
                  Simpan info pembayaran
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Sticky bar: Selesai & Hitung dengan konfirmasi (Task 2.2) */}
          <div className="sticky bottom-0 -mx-5 border-t border-zinc-200 bg-white/95 px-5 pt-3 pb-4 backdrop-blur">
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              size="lg"
            >
              {busy ? "Memproses…" : "Selesai & Hitung"}
            </Button>
          </div>

          {confirmOpen && (
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-5 sm:items-center"
              role="dialog"
            >
              <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
                <h2 className="text-lg font-bold">Selesaikan sesi?</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  Semua item akan dihitung final & pilihan dikunci:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                  <li className="flex justify-between">
                    <span>Subtotal</span>
                    <strong>{formatRupiah(session.subtotal)}</strong>
                  </li>
                  <li className="flex justify-between">
                    <span>Pajak + service − diskon</span>
                    <strong>
                      {formatRupiah(
                        (Number(taxInput) || 0) +
                          (Number(serviceInput) || 0) -
                          (Number(discountInput) || 0)
                      )}
                    </strong>
                  </li>
                  <li
                    className={cn(
                      "flex justify-between border-t border-zinc-100 pt-1"
                    )}
                  >
                    <span>Total</span>
                    <strong>
                      {formatRupiah(
                        session.subtotal +
                          (Number(taxInput) || 0) +
                          (Number(serviceInput) || 0) -
                          (Number(discountInput) || 0)
                      )}
                    </strong>
                  </li>
                </ul>
                {unclaimed.length > 0 && (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {unclaimed.length} item belum diklaim — finalize akan
                    ditolak.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy}
                    onClick={() => void finalize()}
                  >
                    Ya, Hitung Final
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy}
                    variant="secondary"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Status finalized: arahkan ke hasil */}
      {!isDraft && (
        <Card>
          <CardContent className="flex flex-col gap-2 py-4">
            <p className="text-sm text-zinc-600">
              Sesi sudah {session.status}. Pilihan dikunci.
            </p>
            <Button onClick={() => router.push(`/s/${token}/result`)}>
              Lihat Hasil Split
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
