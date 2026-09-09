export default function SessionTokenPage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <main className="flex flex-1 flex-col px-5 pt-12 pb-10">
      <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
        Sesi {params.token}
      </p>
      <h1 className="mt-2 text-2xl font-bold">Placeholder Fase 0</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Route dinamis /s/[token] sudah terdaftar. UI peserta dibangun di Fase 2
        dan split-engine di Fase 1.
      </p>
    </main>
  );
}
