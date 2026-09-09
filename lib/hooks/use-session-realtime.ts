"use client";

/**
 * useSessionRealtime — realtime sync (Task 3.1–3.2, Fase 3).
 *
 * Subscribe Supabase Realtime channel `session:{token}`:
 * - postgres_changes INSERT/DELETE `selections` → klaim/unclaim live.
 * - postgres_changes INSERT `participants` → peserta baru gabung live.
 * - postgres_changes UPDATE `sessions` → OPSIONAL (subscribeSessionUpdates).
 *   Default mati: tabel `sessions` baru masuk publication realtime lewat
 *   migration 0002 (butuh SUPABASE_DB_URL untuk di-apply). Selama belum,
 *   halaman memakai polling ringan untuk status.
 * - presence: daftar nama peserta yang online (Task 3.2).
 *
 * Desain:
 * - Callback lewat ref: re-render tidak memicu re-subscribe.
 * - Throttle event selections ~120ms (Task 3.2) supaya spam tap dari banyak
 *   HP tidak membanjiri render.
 * - Upsert `selections` dengan onConflict(item_id, participant_id) sudah
 *   ditangani server-side oleh PATCH /api/sessions/[token]/items/[itemId]
 *   (Fase 1) — hook hanya meneruskan event hasilnya.
 * - Event milik user ini sendiri tetap diteruskan; penerapan di state
 *   bersifat idempotent (add-if-missing / remove-if-present) sehingga aman
 *   bertabrakan dengan optimistic update.
 * - Cleanup: removeChannel saat unmount / token berubah.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { ParticipantDto, SessionDto } from "@/lib/api/types";

export interface RealtimeSelectionEvent {
  itemId: string;
  participantId: string;
  /** true = INSERT (claim), false = DELETE (unclaim). */
  added: boolean;
}

export interface UseSessionRealtimeOptions {
  token: string;
  sessionId: string;
  /** Nama untuk presence (kosong sebelum join → re-track otomatis). */
  displayName: string;
  /** Subscribe UPDATE sessions (butuh migration 0002 applied). */
  subscribeSessionUpdates?: boolean;
  onSelection?: (event: RealtimeSelectionEvent) => void;
  onParticipant?: (participant: ParticipantDto) => void;
  onSessionUpdate?: (session: SessionDto) => void;
}

export type RealtimeStatus = "connecting" | "live" | "offline";

const THROTTLE_MS = 120;

export function useSessionRealtime({
  token,
  sessionId,
  displayName,
  subscribeSessionUpdates = false,
  onSelection,
  onParticipant,
  onSessionUpdate,
}: UseSessionRealtimeOptions): {
  status: RealtimeStatus;
  onlineNames: string[];
} {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [onlineNames, setOnlineNames] = useState<string[]>([]);

  const onSelectionRef = useRef(onSelection);
  const onParticipantRef = useRef(onParticipant);
  const onSessionUpdateRef = useRef(onSessionUpdate);

  const displayNameRef = useRef(displayName);

  // Sinkronisasi callback & nama terbaru ke ref (setelah render, bukan saat
  // render — aturan react-hooks). Effect ini berjalan tiap render.
  useEffect(() => {
    onSelectionRef.current = onSelection;
    onParticipantRef.current = onParticipant;
    onSessionUpdateRef.current = onSessionUpdate;
    displayNameRef.current = displayName;
  });

  // Browser-only: createBrowserClient butuh `window`, jadi jangan dipanggil
  // saat SSR render (penyebab "This page couldn't load" bila langsung di
  // useMemo). Di client, useMemo = singleton per mount; channel sendiri
  // dibuat di effect (client-only) dan di-remove saat unmount.
  const client = useMemo(
    () => (typeof window === "undefined" ? null : createClient()),
    []
  );

  useEffect(() => {
    if (!sessionId || !client) return;

    const channel = client.channel(`session:${token}`, {
      config: {
        presence: { key: crypto.randomUUID?.() ?? String(Date.now()) },
      },
    });

    // ---- Throttle queue untuk event selections (Task 3.2) ----
    let queue: RealtimeSelectionEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = queue;
      queue = [];
      for (const ev of batch) onSelectionRef.current?.(ev);
    };
    const enqueue = (ev: RealtimeSelectionEvent) => {
      queue.push(ev);
      if (!timer) timer = setTimeout(flush, THROTTLE_MS);
    };

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "selections" },
        (payload) => {
          const row = payload.new as
            | { item_id: string; participant_id: string }
            | null;
          if (row?.item_id && row?.participant_id) {
            enqueue({
              itemId: row.item_id,
              participantId: row.participant_id,
              added: true,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "selections" },
        (payload) => {
          const old = payload.old as
            | { item_id: string; participant_id: string }
            | null;
          if (old?.item_id && old?.participant_id) {
            enqueue({
              itemId: old.item_id,
              participantId: old.participant_id,
              added: false,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "participants" },
        (payload) => {
          const row = payload.new as ParticipantDto | null;
          if (row?.id && row.session_id === sessionId) {
            onParticipantRef.current?.(row);
          }
        }
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string }>();
        const names = Object.values(state)
          .flat()
          .map((p) => p.name)
          .sort();
        setOnlineNames(names);
      })
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          setStatus("live");
          void channel.track({
            name: displayNameRef.current || "Tamu",
          });
        } else if (
          subscribeStatus === "CHANNEL_ERROR" ||
          subscribeStatus === "TIMED_OUT" ||
          subscribeStatus === "CLOSED"
        ) {
          setStatus("offline");
        }
      });

    // Opsional: UPDATE sessions (hanya setelah migration 0002 applied).
    // Cleanup otomatis via removeChannel di bawah.
    if (subscribeSessionUpdates) {
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions" },
        (payload) => {
          const row = payload.new as SessionDto | null;
          if (row?.id === sessionId) {
            onSessionUpdateRef.current?.(row);
          }
        }
      );
    }

    return () => {
      if (timer) clearTimeout(timer);
      queue = [];
      void client.removeChannel(channel);
    };
  }, [client, sessionId, token, subscribeSessionUpdates]);

  // Re-track presence saat nama berubah (setelah join / ganti nama).
  useEffect(() => {
    if (!displayName || !client) return;
    const channel = client
      .getChannels()
      .find((c) => c.topic === `realtime:session:${token}`);
    if (channel && channel.state === "joined") {
      void channel.track({ name: displayName });
    }
  }, [client, displayName, token]);

  return { status, onlineNames };
}
