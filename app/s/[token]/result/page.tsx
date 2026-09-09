"use client";

/**
 * /s/[token]/result — halaman hasil split (Task 2.3, Fase 2).
 *
 * - Rincian per orang + total presisi struk (dari settlements hasil finalize).
 * - Tombol copy nomor rekening + buka link / gambar QRIS.
 * - Optimasi mobile (Task 2.3): tombol ≥ 44px, font besar, tanpa library
 *   berat — ringan untuk in-app browser WhatsApp.
 *
 * Status draft → tampil empty state + CTA admin; error 404/expired → error
 * state.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SessionDetailDto } from "@/lib/api/types";
import { formatRupiah } from "@/lib/utils";

export default function SessionResultPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [detail, setDetail] = useState<SessionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
          setError(json.error ?? "Gagal memuat hasil.");
          return;
        }
        setDetail(json as SessionDetailDto);
      } catch (e) {
        if (ignore) return;
        setError(e instanceof Error ? e.message : "Gagal memuat hasil.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [token]);

  const copyBca = async () => {
    const text = detail?.session.payer_bca;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback browser lama / in-app browser WA tanpa clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ---------------------------------------------------------------
  // Render: loading / error.
  // ---------------------------------------------------------------
  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="text-5xl" aria-hidden>
          🧾
        </span>
        <h1 className="text-xl font-bold">Hasil tidak bisa dibuka</h1>
        <p className="max-w-xs text-sm text-zinc-600">{error}</p>
        <Link
          className="min-h-[44px] pt-3 text-sm text-emerald-700 underline"
          href="/"
        >
          Kembali ke halaman utama
        </Link>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-5 pt-10 pb-10">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-200" />
        <div className="h-24 animate-pulse rounded-2xl bg-zinc-200" />
        <div className="h-24 animate-pulse rounded-2xl bg-zinc-200" />
      </main>
    );
  }

  const { session, items, participants, settlements } = detail;
  const isFinalized = session.status === "finalized";
  const rows = settlements ?? [];

  // Total presisi struk = subtotal + pajak + service − diskon.
  const grandTotal =
    session.subtotal + session.tax + session.service_charge - session.discount;
  const settledSum = rows.reduce((a, s) => a + s.amount_final, 0);

  // ---------------------------------------------------------------
  // Render: belum finalized → empty state.
  // ---------------------------------------------------------------
  if (!isFinalized || rows.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="text-5xl" aria-hidden>
          ⏳
        </span>
        <h1 className="text-xl font-bold">Belum ada hasil</h1>
        <p className="max-w-xs text-sm text-zinc-600">
          Sesi masih draft. Admin belum menekan &quot;Selesai &amp;
          Hitung&quot;.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => router.push(`/s/${token}`)}>
            Buka Pilih Menu
          </Button>
          <Button
            onClick={() => router.push(`/s/${token}/admin`)}
            variant="secondary"
          >
            Buka Panel Admin
          </Button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Render: hasil final per orang.
  // ---------------------------------------------------------------
  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-8 pb-10">
      <header className="text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
          Hasil Split
        </p>
        <h1 className="mt-1 text-2xl font-bold">Tagihan kamu 🧾</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Sesi {session.token} · {items.length} item · {participants.length}{" "}
          peserta
        </p>
      </header>

      {/* Rincian per orang */}
      <Card>
        <CardContent className="pt-4">
          <ul className="flex flex-col" data-testid="settlement-list">
            {rows.map((s) => (
              <li
                className="flex items-center justify-between border-b border-zinc-100 py-3 last:border-b-0"
                key={s.participant_id}
              >
                <span className="text-base font-semibold">
                  {s.participants?.display_name ?? "?"}
                </span>
                <span className="text-right">
                  <span
                    className="block text-lg font-bold"
                    data-testid={`amount-${s.participant_id}`}
                  >
                    {formatRupiah(s.amount_final)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    makanan {formatRupiah(s.amount_subtotal)} · pajak & service{" "}
                    {formatRupiah(s.amount_tax + s.amount_service)}
                    {s.amount_discount > 0 &&
                      ` · diskon −${formatRupiah(s.amount_discount)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t-2 border-zinc-200 pt-3">
            <span className="text-sm font-semibold text-zinc-600">
              TOTAL (presisi struk)
            </span>
            <strong className="text-xl font-bold" data-testid="grand-total">
              {formatRupiah(grandTotal)}
            </strong>
          </div>
          {settledSum !== grandTotal && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Selisih pembulatan {formatRupiah(grandTotal - settledSum)} —
              hubungi admin bila terlihat janggal.
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Subtotal {formatRupiah(session.subtotal)} + pajak{" "}
            {formatRupiah(session.tax)} + service{" "}
            {formatRupiah(session.service_charge)}
            {session.discount > 0 &&
              ` − diskon ${formatRupiah(session.discount)}`}
          </p>
        </CardContent>
      </Card>

      {/* Info pembayaran (Task 2.3) */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <h2 className="text-sm font-semibold text-zinc-700">Cara bayar 💳</h2>
          {session.payer_bca && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3">
              <p className="text-sm break-all">{session.payer_bca}</p>
              <Button
                aria-label="Copy nomor rekening"
                className="shrink-0"
                onClick={() => void copyBca()}
                size="sm"
                variant="secondary"
              >
                {copied ? "Tersalin ✓" : "Copy"}
              </Button>
            </div>
          )}
          {session.payer_qris_url && (
            <div className="flex flex-col items-center gap-2">
              {/* URL file gambar → tampilkan; URL lain → tombol buka */}
              {/\.(png|jpe?g|webp)(\?|$)/i.test(session.payer_qris_url) ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="QRIS pembayaran"
                    className="w-48 rounded-xl border border-zinc-200"
                    src={session.payer_qris_url}
                  />
                  <a
                    className="flex min-h-[44px] items-center text-sm text-emerald-700 underline"
                    href={session.payer_qris_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Buka gambar QRIS 🔗
                  </a>
                </>
              ) : (
                <a
                  className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white shadow"
                  href={session.payer_qris_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Buka QRIS 🔗
                </a>
              )}
            </div>
          )}
          {!session.payer_bca && !session.payer_qris_url && (
            <p className="text-sm text-zinc-500">
              Admin belum mengisi info pembayaran.
            </p>
          )}
        </CardContent>
      </Card>

      <footer className="mt-auto pt-2 text-center text-xs text-zinc-400">
        {" "}
        Dibagi proporsional sesuai yang masing-masing makan. Terima kasih sudah
        patungan! 🙌
      </footer>
    </main>
  );
}
