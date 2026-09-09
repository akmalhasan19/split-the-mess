"use client";

/**
 * /s/[token] — halaman peserta (Task 2.1, Fase 2).
 *
 * Alur:
 * 1. Nama peserta disimpan sekali di localStorage (key per token) → saat
 *    membuka ulang link yang sama, otomatis dikenali lagi tanpa login.
 * 2. Tap item untuk claim/unclaim dengan optimistic UI: state lokal diubah
 *    dulu, request jalan di belakang, rollback + toast bila gagal.
 * 3. Avatar pemilih live per item (initial 1–2 huruf, warna deterministik).
 *
 * Catatan teknis:
 * - Nama dibaca via useSyncExternalStore (localStorage = external store).
 * - meId = derived state dari participants + nama tersimpan, bukan state
 *   terpisah, supaya tidak ada sinkronisasi effect yang rawan lint error.
 * - Realtime (Fase 3) akan menggantikan refetch manual; sekarang cukup
 *   refresh setelah aksi.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSessionRealtime } from "@/lib/hooks/use-session-realtime";
import type {
  ItemDto,
  ParticipantDto,
  SessionDetailDto,
  SessionDto,
} from "@/lib/api/types";
import type { RealtimeSelectionEvent } from "@/lib/hooks/use-session-realtime";
import { cn, formatRupiah } from "@/lib/utils";

// ---------------------------------------------------------------
// localStorage sebagai external store (nama peserta).
// ---------------------------------------------------------------
const NAME_EVENT = "stm:name-changed";

function storageKey(token: string): string {
  return `stm:name:${token}`;
}

function readStoredName(token: string): string {
  try {
    return window.localStorage.getItem(storageKey(token)) ?? "";
  } catch {
    return "";
  }
}

function writeStoredName(token: string, name: string): void {
  try {
    window.localStorage.setItem(storageKey(token), name);
    window.dispatchEvent(new Event(NAME_EVENT));
  } catch {
    /* private mode / storage penuh — abaikan */
  }
}

function useStoredName(token: string): string {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("storage", onChange);
    window.addEventListener(NAME_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(NAME_EVENT, onChange);
    };
  }, []);
  const getSnapshot = useCallback(() => readStoredName(token), [token]);
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "" // server snapshot: SSR selalu anggap belum ada nama
  );
}

// ---------------------------------------------------------------
// Avatar pemilih.
// ---------------------------------------------------------------
const AVATAR_COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-teal-600",
  "bg-orange-600",
  "bg-indigo-600",
];

/** Warna avatar deterministik dari nama (nama sama → warna sama). */
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Initial avatar: huruf pertama 1–2 kata, max 2 char. */
function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type Phase = "loading" | "error" | "ready";

export default function ParticipantSessionPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  // Data sesi dari GET /api/sessions/[token].
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDto | null>(null);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  // Bump untuk memicu refetch dari event handler (tombol refresh, join, dll).
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Identitas peserta.
  const storedName = useStoredName(token);
  const [joinedId, setJoinedId] = useState<string | null>(null); // hasil join fresh
  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [joiningError, setJoiningError] = useState<string | null>(null);

  // Optimistic toggles in-flight: itemId → claim (true) / unclaim (false).
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [toast, setToast] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((kind: "error" | "info", text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ---------------------------------------------------------------
  // Load sesi — pola fetching React docs (ignore flag, cleanup).
  // ---------------------------------------------------------------
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
          setPhase("error");
          setErrorMessage(json.error ?? "Gagal memuat sesi.");
          return;
        }
        const detail = json as SessionDetailDto;
        setSession(detail.session);
        setItems(detail.items);
        setParticipants(detail.participants);
        setPhase("ready");
      } catch (e) {
        if (ignore) return;
        setPhase("error");
        setErrorMessage(e instanceof Error ? e.message : "Gagal memuat sesi.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [token, refreshKey]);

  // ---------------------------------------------------------------
  // meId = derived (peserta dengan nama tersimpan), fallback joinedId.
  // ---------------------------------------------------------------
  const meId = useMemo(() => {
    if (joinedId) return joinedId;
    if (!storedName) return null;
    const exact = participants.find((p) => p.display_name === storedName);
    if (exact) return exact.id;
    const ci = participants.find(
      (p) => p.display_name.toLowerCase() === storedName.toLowerCase()
    );
    return ci?.id ?? null;
  }, [joinedId, participants, storedName]);

  // ---------------------------------------------------------------
  // Join sesi (event handler submit form).
  // ---------------------------------------------------------------
  const joinAs = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setJoining(true);
      setJoiningError(null);
      try {
        const res = await fetch(`/api/sessions/${token}/participants`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: trimmed }),
        });
        const json = await res.json();
        if (res.ok) {
          setJoinedId(json.id as string);
          writeStoredName(token, (json.displayName as string) ?? trimmed);
          refresh();
          return;
        }
        if (res.status === 409) {
          // Nama sudah dipakai (user buka di HP lain / data lama) —
          // cukup pakai participant yang sudah ada.
          const existing = participants.find(
            (p) => p.display_name.toLowerCase() === trimmed.toLowerCase()
          );
          if (existing) {
            setJoinedId(existing.id);
            writeStoredName(token, existing.display_name);
            refresh();
            return;
          }
        }
        setJoiningError(json.error ?? "Gagal gabung sesi.");
      } catch (e) {
        setJoiningError(e instanceof Error ? e.message : "Gagal gabung sesi.");
      } finally {
        setJoining(false);
      }
    },
    [participants, refresh, token]
  );

  // ---------------------------------------------------------------
  // Toggle claim/unclaim dengan optimistic UI + rollback.
  // ---------------------------------------------------------------
  const toggleItem = useCallback(
    async (item: ItemDto) => {
      if (!meId || !session) return;
      if (session.status !== "draft") {
        showToast("info", "Sesi sudah selesai — pilihan terkunci.");
        return;
      }
      const currentlyMine = item.selections.includes(meId);
      const wanted = !currentlyMine;

      // 1. Optimistic update lokal.
      const prevItems = items;
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? {
                ...it,
                selections: wanted
                  ? [...it.selections, meId]
                  : it.selections.filter((id) => id !== meId),
              }
            : it
        )
      );
      setPending((prev) => new Map(prev).set(item.id, wanted));

      try {
        const res = await fetch(`/api/sessions/${token}/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ participantId: meId, selected: wanted }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error ?? `Gagal (HTTP ${res.status}).`);
        }
        // 2. Sinkronkan dengan state server (selections terbaru).
        const json = (await res.json()) as {
          ok: boolean;
          selected: boolean;
          selections: string[];
        };
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, selections: json.selections } : it
          )
        );
      } catch (e) {
        // 3. Rollback bila gagal + sinkron ulang dari server.
        setItems(prevItems);
        showToast(
          "error",
          e instanceof Error ? e.message : "Gagal menyimpan pilihan."
        );
        refresh();
      } finally {
        setPending((prev) => {
          const next = new Map(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [items, meId, refresh, session, showToast, token]
  );

  // ---------------------------------------------------------------
  // Realtime (Fase 3): apply event idempotent — aman bertabrakan dengan
  // optimistic update milik sendiri.
  // ---------------------------------------------------------------
  const applySelection = useCallback((ev: RealtimeSelectionEvent) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== ev.itemId) return it;
        const has = it.selections.includes(ev.participantId);
        if (ev.added && !has) {
          return { ...it, selections: [...it.selections, ev.participantId] };
        }
        if (!ev.added && has) {
          return {
            ...it,
            selections: it.selections.filter((id) => id !== ev.participantId),
          };
        }
        return it;
      })
    );
  }, []);

  const applyParticipant = useCallback((p: ParticipantDto) => {
    setParticipants((prev) =>
      prev.some((x) => x.id === p.id) ? prev : [...prev, p]
    );
  }, []);

  const applySessionUpdate = useCallback((s: SessionDto) => {
    setSession((prev) => (prev && prev.id === s.id ? s : prev));
  }, []);

  const { status: rtStatus, onlineNames } = useSessionRealtime({
    token,
    sessionId: session?.id ?? "",
    displayName: meId ? storedName : "",
    subscribeSessionUpdates: true,
    onSelection: applySelection,
    onParticipant: applyParticipant,
    onSessionUpdate: applySessionUpdate,
  });

  // ---------------------------------------------------------------
  // Derived untuk render.
  // ---------------------------------------------------------------
  const participantsById = useMemo(() => {
    const map = new Map<string, ParticipantDto>();
    for (const p of participants) map.set(p.id, p);
    return map;
  }, [participants]);

  const myClaimed = useMemo(() => {
    if (!meId) return { count: 0, subtotal: 0 };
    const mine = items.filter((i) => i.selections.includes(meId));
    return {
      count: mine.length,
      subtotal: mine.reduce((a, i) => a + i.price, 0),
    };
  }, [items, meId]);

  const claimProgress = useMemo(
    () => items.filter((i) => i.selections.length > 0).length,
    [items]
  );

  // ---------------------------------------------------------------
  // Render: loading skeleton.
  // ---------------------------------------------------------------
  if (phase === "loading") {
    return (
      <main className="flex flex-1 flex-col gap-4 px-5 pt-10 pb-10">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-zinc-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-zinc-200" />
        <div className="h-20 animate-pulse rounded-2xl bg-zinc-200" />
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Render: error state.
  // ---------------------------------------------------------------
  if (phase === "error" || !session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="text-5xl" aria-hidden>
          🧾
        </span>
        <h1 className="text-xl font-bold">Sesi tidak bisa dibuka</h1>
        <p className="max-w-xs text-sm text-zinc-600">
          {errorMessage ??
            "Link tidak valid atau sesi sudah lewat masa berlaku (7 hari)."}
        </p>
        <Link
          className="min-h-[44px] pt-3 text-sm text-emerald-700 underline"
          href="/"
        >
          Kembali ke halaman utama
        </Link>
      </main>
    );
  }

  const isFinalized = session.status !== "draft";

  // ---------------------------------------------------------------
  // Render: finalized tapi belum "join" — arahkan ke hasil, bukan form.
  // ---------------------------------------------------------------
  if (!meId && isFinalized) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 text-center">
        <span className="text-5xl" aria-hidden>
          ✅
        </span>
        <h1 className="text-xl font-bold">Sesi sudah selesai dihitung</h1>
        <p className="max-w-xs text-sm text-zinc-600">
          Pemilihan menu sudah ditutup admin. Lihat rincian tagihan per orang
          di halaman hasil.
        </p>
        <Button onClick={() => router.push(`/s/${token}/result`)}>
          Lihat Hasil Split
        </Button>
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Render: belum join → minta nama sekali.
  // ---------------------------------------------------------------
  if (!meId) {
    return (
      <main className="flex flex-1 flex-col justify-center gap-5 px-5 py-10">
        <div className="text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
            Split The Mess
          </p>
          <h1 className="mt-2 text-2xl font-bold">Siapa nama kamu?</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Supaya temanmu tahu siapa yang makan apa. Nama disimpan di HP kamu
            — nggak perlu login.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <Input
              aria-label="Nama kamu"
              autoFocus
              maxLength={40}
              placeholder="cth. Akmal"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameInput.trim() && !joining) {
                  void joinAs(nameInput);
                }
              }}
            />
            {joiningError && (
              <p className="text-sm text-red-600" role="alert">
                {joiningError}
              </p>
            )}
            <Button
              disabled={joining || !nameInput.trim()}
              onClick={() => void joinAs(nameInput)}
            >
              {joining ? "Gabung…" : "Gabung Sesi"}
            </Button>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-zinc-500">
          {participants.length} peserta sudah gabung · total struk{" "}
          {formatRupiah(session.subtotal)}
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------
  // Render: sudah join → daftar menu + claim.
  // ---------------------------------------------------------------
  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-8 pb-10">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-700 uppercase">
          Sesi {session.token}
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          Hai, <span data-testid="my-name">{storedName}</span>! 👋
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Tap item yang kamu makan. Tap lagi untuk batal.
        </p>
      </header>

      {isFinalized && (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Sesi sudah finalized — pilihan terkunci. Lihat hasil di{" "}
          <Link className="font-semibold underline" href={`/s/${token}/result`}>
            /s/{token}/result
          </Link>
          .
        </div>
      )}

      {toast && (
        <p
          className={cn(
            "rounded-xl px-3 py-2 text-sm",
            toast.kind === "error"
              ? "bg-red-50 text-red-700"
              : "bg-zinc-100 text-zinc-700"
          )}
          role="status"
        >
          {toast.text}
        </p>
      )}

      {/* Ringkasan claim saya */}
      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardContent className="flex items-center justify-between gap-3 py-3">
          <div className="text-sm">
            <p className="font-semibold text-emerald-900">Klaim kamu</p>
            <p className="text-xs text-emerald-700">
              {myClaimed.count} dari {items.length} item
            </p>
          </div>
          <p className="text-lg font-bold text-emerald-900">
            {formatRupiah(myClaimed.subtotal)}
          </p>
        </CardContent>
      </Card>

      {/* Daftar menu */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="text-4xl" aria-hidden>
              🍽️
            </span>
            <p className="font-semibold">Belum ada item</p>
            <p className="text-sm text-zinc-500">
              Admin belum menambahkan item struk. Coba refresh sebentar.
            </p>
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onClick={refresh}
            >
              Refresh
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="item-list">
          {items.map((item) => {
            const mine = meId !== null && item.selections.includes(meId);
            const choosers = item.selections
              .map((id) => participantsById.get(id))
              .filter((p): p is ParticipantDto => Boolean(p));
            const isPending = pending.has(item.id);
            return (
              <li key={item.id}>
                <button
                  aria-pressed={mine}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors active:scale-[0.99]",
                    mine
                      ? "border-emerald-500 bg-emerald-50 shadow-sm"
                      : "border-zinc-200 bg-white",
                    isPending && "opacity-70"
                  )}
                  disabled={isFinalized || isPending}
                  data-mine={mine ? "true" : "false"}
                  data-testid={`item-${item.id}`}
                  type="button"
                  onClick={() => void toggleItem(item)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                      mine
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-zinc-300 text-transparent"
                    )}
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.name}
                      {item.qty > 1 && (
                        <span className="ml-1 text-xs font-normal text-zinc-400">
                          ×{item.qty}
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-zinc-500">
                      {formatRupiah(item.price)}
                    </span>
                  </span>
                  {/* Avatar pemilih live */}
                  <span className="flex shrink-0 -space-x-1.5">
                    {choosers.map((p) => (
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white",
                          colorFor(p.display_name)
                        )}
                        key={p.id}
                        title={p.display_name}
                      >
                        {initialsFor(p.display_name)}
                      </span>
                    ))}
                    {choosers.length === 0 && (
                      <span className="text-xs text-zinc-300">belum ada</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Presence + status realtime (Task 3.2) */}
      <p className="text-center text-xs text-zinc-500">
        {claimProgress}/{items.length} item sudah diklaim · {participants.length}{" "}
        peserta
      </p>
      <div
        className="flex flex-wrap items-center justify-center gap-1 text-xs"
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
        <span className="text-zinc-500">
          {rtStatus === "live"
            ? `live · online: ${onlineNames.length > 0 ? onlineNames.join(", ") : "—"}`
            : rtStatus === "connecting"
              ? "menghubungkan realtime…"
              : "realtime terputus — coba refresh"}
        </span>
      </div>

      {/* Footer status */}
      <footer className="mt-auto space-y-1 pt-4 text-center text-xs text-zinc-400">
        <p>
          Total struk {formatRupiah(session.subtotal)} · pajak{" "}
          {formatRupiah(session.tax)} · service{" "}
          {formatRupiah(session.service_charge)}
          {session.discount > 0 && (
            <> · diskon −{formatRupiah(session.discount)}</>
          )}
        </p>
        <p>Pajak & service dibagi proporsional setelah admin finalize.</p>
      </footer>
    </main>
  );
}
