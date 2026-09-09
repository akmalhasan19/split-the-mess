"use client";

/**
 * /admin — form buat sesi baru (Task 1.4).
 * Item manual dulu (nama + harga), OCR belakangan (Fase 5).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatRupiah } from "@/lib/utils";

interface ItemDraft {
  name: string;
  price: string;
  qty: string;
}

const emptyItem: ItemDraft = { name: "", price: "", qty: "1" };

export default function AdminHomePage() {
  const router = useRouter();
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [tax, setTax] = useState("");
  const [service, setService] = useState("");
  const [discount, setDiscount] = useState("");
  const [payerBca, setPayerBca] = useState("");
  const [payerQris, setPayerQris] = useState("");
  const [participants, setParticipants] = useState("Admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const subtotal = items.reduce(
    (a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0),
    0
  );
  const grandTotal =
    subtotal +
    (Number(tax) || 0) +
    (Number(service) || 0) -
    (Number(discount) || 0);

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  async function handleSubmit() {
    setError(null);
    const payloadItems = items
      .filter((i) => i.name.trim() && Number(i.price) >= 0)
      .map((i) => ({
        name: i.name.trim(),
        price: Number(i.price) || 0,
        qty: Number(i.qty) || 1,
      }));

    if (payloadItems.length === 0) {
      setError("Minimal 1 item dengan nama & harga.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: payloadItems,
          participants: participants
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          tax: Number(tax) || 0,
          service_charge: Number(service) || 0,
          discount: Number(discount) || 0,
          payer_bca: payerBca || undefined,
          payer_qris_url: payerQris || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Gagal membuat sesi.");
        return;
      }
      router.push(`/admin/${json.token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat sesi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-10 pb-10">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
          Split The Mess
        </p>
        <h1 className="mt-1 text-2xl font-bold">Buat Sesi Baru</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Ketik item struk manual dulu (OCR menyusul di Fase 5).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item struk</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label={`Nama item ${index + 1}`}
                className="flex-1"
                placeholder="Nama item"
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
              />
              <Input
                aria-label={`Harga item ${index + 1}`}
                className="w-28"
                inputMode="numeric"
                placeholder="Harga"
                value={item.price}
                onChange={(e) =>
                  updateItem(index, {
                    price: e.target.value.replace(/[^\d]/g, ""),
                  })
                }
              />
              <Input
                aria-label={`Qty item ${index + 1}`}
                className="w-14"
                inputMode="numeric"
                placeholder="Qty"
                value={item.qty}
                onChange={(e) =>
                  updateItem(index, {
                    qty: e.target.value.replace(/[^\d]/g, "") || "1",
                  })
                }
              />
              <button
                aria-label={`Hapus item ${index + 1}`}
                className="min-h-[44px] px-2 text-zinc-400 hover:text-red-500"
                type="button"
                onClick={() =>
                  setItems((prev) =>
                    prev.length === 1
                      ? [{ ...emptyItem }]
                      : prev.filter((_, i) => i !== index)
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setItems((prev) => [...prev, { ...emptyItem }])}
          >
            + Tambah item
          </Button>
          <p className="mt-1 text-sm text-zinc-600">
            Subtotal: <strong>{formatRupiah(subtotal)}</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pajak, service & diskon</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Pajak
            <Input
              inputMode="numeric"
              value={tax}
              onChange={(e) => setTax(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Service
            <Input
              inputMode="numeric"
              value={service}
              onChange={(e) => setService(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Diskon
            <Input
              inputMode="numeric"
              value={discount}
              onChange={(e) =>
                setDiscount(e.target.value.replace(/[^\d]/g, ""))
              }
            />
          </label>
          <p className="col-span-3 text-sm text-zinc-600">
            Grand total: <strong>{formatRupiah(grandTotal)}</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Info pembayaran</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input
            placeholder="BCA: 1234567890 a.n. Nama"
            value={payerBca}
            onChange={(e) => setPayerBca(e.target.value)}
          />
          <Input
            placeholder="URL QRIS (opsional)"
            value={payerQris}
            onChange={(e) => setPayerQris(e.target.value)}
          />
          <Input
            placeholder="Peserta awal (pisah koma, default Admin)"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
          />
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <Button disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Membuat sesi…" : "Buat Sesi & Buka Admin"}
      </Button>
    </main>
  );
}
