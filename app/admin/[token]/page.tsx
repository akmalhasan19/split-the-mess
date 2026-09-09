"use client";

/**
 * /admin/[token] — UI admin minimal (Task 1.4): daftar item, tambah peserta,
 * centang siapa makan apa, edit pajak/service/diskon, tombol Selesai & Hitung.
 *
 * Fase 2 akan menambah realtime (Supabase Realtime); sekarang cukup refetch
 * setelah setiap aksi.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRupiah } from "@/lib/utils";

interface SessionDto {
  id: string;
  token: string;
  subtotal: number;
  tax: number;
  service_charge: number;
  discount: number;
  payer_bca: string | null;
  payer_qris_url: string | null;
  status: "draft" | "finalized" | "cancelled";
}

interface ItemDto {
  id: string;
  name: string;
  price: number;
  qty: number;
  selections: string[];
}

interface ParticipantDto {
  id: string;
  display_name: string;
}

interface SettlementDto {
  participant_id: string;
  amount_subtotal: number;
  amount_tax: number;
  amount_service: number;
  amount_discount: number;
  amount_final: number;
  participants: { display_name: string } | null;
}

interface DetailDto {
  session: SessionDto;
  items: ItemDto[];
  participants: ParticipantDto[];
  settlements?: SettlementDto[];
}

export default function AdminSessionPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [detail, setDetail] = useState<DetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newParticipant, setNewParticipant] = useState("");
  const [taxInput, setTaxInput] = useState("");
  const [serviceInput, setServiceInput] = useState("");
  const [discountInput, setDiscountInput] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Gagal memuat sesi.");
        return;
      }
      setError(null);
      setDetail(json as DetailDto);
      setTaxInput(String(json.session.tax));
      setServiceInput(String(json.session.service_charge));
      setDiscountInput(String(json.session.discount));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat sesi.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !detail) {
    return (
      <main className="flex flex-1 flex-col px-5 pt-10 pb-10">
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
        <Link className="mt-4 text-sm text-emerald-700 underline" href="/admin">
          ← Buat sesi baru
        </Link>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="flex flex-1 flex-col px-5 pt-10 pb-10">
        <p className="text-sm text-zinc-500">Memuat sesi…</p>
      </main>
    );
  }

  const { session, items, participants } = detail;
  const isDraft = session.status === "draft";

  async function act(fn: () => Promise<Response>, successMessage?: string) {
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
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (item: ItemDto, participantId: string) =>
    act(() =>
      fetch(`/api/sessions/${token}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantId,
          selected: !item.selections.includes(participantId),
        }),
      })
    );

  const finalize = async () => {
    const ok = await act(
      () => fetch(`/api/sessions/${token}/finalize`, { method: "POST" }),
      "Sesi finalized — rincian tersimpan."
    );
    if (ok) void load();
  };

  const claimedSubtotal = items
    .filter((i) => i.selections.length > 0)
    .reduce((a, i) => a + i.price, 0);
  const unclaimed = items.filter((i) => i.selections.length === 0);

  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-8 pb-10">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
          Admin Sesi
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          Token: <span data-testid="session-token">{session.token}</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Status: <strong>{session.status}</strong> · Bagikan link{" "}
          <code className="rounded bg-zinc-100 px-1">/s/{token}</code> ke
          peserta (Fase 2).
        </p>
      </div>

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

      {/* Tabel centang siapa makan apa */}
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
                            className="size-5 accent-emerald-600 disabled:opacity-40"
                            disabled={!isDraft || busy}
                            type="checkbox"
                            checked={checked}
                            onChange={() => void toggle(item, p.id)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unclaimed.length > 0 && (
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

      {/* Tambah item & peserta (hanya draft) */}
      {isDraft && (
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
        </div>
      )}

      {/* Hasil final */}
      {detail.settlements && detail.settlements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hasil final</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.settlements.map((s) => (
                <li key={s.participant_id} className="flex justify-between">
                  <span>{s.participants?.display_name ?? "?"}</span>
                  <strong>{formatRupiah(s.amount_final)}</strong>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-zinc-100 pt-2 text-sm">
              <span className="float-right font-bold">
                {formatRupiah(
                  detail.settlements.reduce((a, s) => a + s.amount_final, 0)
                )}
              </span>
              <span className="text-zinc-500">Total (presisi struk)</span>
            </p>
            <div className="clear-both mt-3 flex flex-col gap-2">
              {session.payer_bca && (
                <p className="text-sm">
                  💳 {session.payer_bca}{" "}
                  <button
                    className="ml-1 text-xs text-emerald-700 underline"
                    type="button"
                    onClick={() =>
                      void navigator.clipboard?.writeText(
                        session.payer_bca ?? ""
                      )
                    }
                  >
                    copy
                  </button>
                </p>
              )}
              {session.payer_qris_url && (
                <a
                  className="text-sm text-emerald-700 underline"
                  href={session.payer_qris_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Buka QRIS
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tombol Selesai & Hitung */}
      {isDraft && (
        <div className="sticky bottom-0 -mx-5 border-t border-zinc-200 bg-white/95 px-5 pt-3 pb-4 backdrop-blur">
          <Button
            className="w-full"
            disabled={busy}
            size="lg"
            onClick={() => void finalize()}
          >
            {busy ? "Memproses…" : "Selesai & Hitung"}
          </Button>
        </div>
      )}
    </main>
  );
}
