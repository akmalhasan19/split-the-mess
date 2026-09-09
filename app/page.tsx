import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col px-5 pt-12 pb-10">
      <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
        Split The Mess
      </p>
      <h1 className="mt-2 text-3xl leading-tight font-bold">
        Patungan makan tanpa drama.
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600">
        Foto struk di grup WhatsApp, bagikan link, tiap orang centang makanannya
        sendiri. Pajak, service &amp; diskon dibagi proporsional otomatis sampai
        rupiah terakhir pas.
      </p>

      <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold">Alur MVP</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-600">
          <li>Kirim foto struk + /split di grup WA</li>
          <li>Bot balas link sesi /s/[token]</li>
          <li>Tiap orang centang makanannya (realtime)</li>
          <li>Admin tekan Selesai &amp; Hitung → ringkasan ke grup</li>
        </ol>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-zinc-950 p-4 text-white">
          <p className="font-semibold">Fase 0</p>
          <p className="mt-1 text-xs leading-5 text-zinc-300">
            Scaffolding Next.js + Supabase + struktur folder siap.
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-600 p-4 text-white">
          <p className="font-semibold">Input manual</p>
          <p className="mt-1 text-xs leading-5 text-emerald-50">
            OCR belakangan. Matematika split-engine dulu.
          </p>
        </div>
      </div>

      <p className="mt-6 text-xs text-zinc-500">
        Status backend:{" "}
        <Link
          className="font-semibold text-emerald-700 underline"
          href="/api/health"
        >
          /api/health
        </Link>{" "}
        · <span data-testid="deploy-marker">phase0-deploy-marker</span>
      </p>
    </main>
  );
}
