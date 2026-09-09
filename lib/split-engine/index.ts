/**
 * Split-engine — matematika inti Split The Mess.
 *
 * Aturan pembagian:
 * 1. Setiap item dibagi rata ke semua peserta yang memilihnya (per-eater share).
 *    1 item dimakan berdua → harga / 2 per orang.
 * 2. Pajak, service charge, dan diskon dibagi proporsional terhadap subtotal
 *    masing-masing peserta (rasio peserta terhadap total subtotal terklaim).
 * 3. Pembulatan memakai largest remainder (smartRounding) per komponen
 *    (subtotal, pajak, service, diskon) sehingga:
 *      - sum(amount_subtotal) == subtotal terklaim
 *      - sum(amount_tax) == pajak, dst.
 *      - amount_final per orang = jumlah komponennya (konsisten untuk DB).
 *      - sum(amount_final) == total struk sampai rupiah terakhir.
 * 4. Item tanpa pemilih TIDAK dibagi ke siapa pun; dilaporkan di `unclaimedItems`
 *    supaya admin memperbaiki seleksi sebelum finalize (finalize API menolak
 *    bila masih ada item tanpa pemilih).
 *
 * Semua fungsi murni (pure) — tanpa I/O — agar mudah dites dan dipakai ulang
 * di API route maupun bot WhatsApp.
 */

/** Error khusus split-engine agar API route bisa membedakan input invalid. */
export class SplitEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitEngineError";
  }
}

export interface SplitItem {
  id: string;
  name: string;
  /** Harga total baris (harga satuan × qty) dalam rupiah, bilangan bulat. */
  price: number;
  /** Jumlah unit yang dipesan (informasional; price sudah total baris). */
  qty: number;
}

export interface SplitParticipant {
  id: string;
  displayName: string;
}

/** itemId → daftar participantId yang makan item tersebut. */
export type Selections = Record<string, string[]>;

export interface SettlementRow {
  participantId: string;
  displayName: string;
  amountSubtotal: number;
  amountTax: number;
  amountService: number;
  /** Selalu angka positif; dikurangkan dari amount_final. */
  amountDiscount: number;
  amountFinal: number;
}

export interface CalcTotals {
  /** subtotal struk (semua item). */
  subtotal: number;
  /** bagian subtotal yang sudah diklaim minimal 1 peserta. */
  claimedSubtotal: number;
  /** bagian subtotal yang belum diklaim siapa pun. */
  unclaimedSubtotal: number;
  tax: number;
  service: number;
  discount: number;
  /** subtotal + tax + service − discount (total struk). */
  grandTotal: number;
  /** sum(amount_final) seluruh peserta. */
  settledTotal: number;
  /** grandTotal − settledTotal; 0 berarti semua biaya terbagi 100%. */
  diff: number;
}

export interface CalcResult {
  settlements: SettlementRow[];
  totals: CalcTotals;
  unclaimedItems: Array<{ id: string; name: string; price: number }>;
  /** true bila tidak ada item tanpa pemilih (settledTotal == grandTotal). */
  isFullyClaimed: boolean;
}

export interface CalcProportionalOptions {
  /**
   * Daftar peserta sesi. Peserta yang tidak memilih item apa pun tetap masuk
   * hasil dengan nominal 0. participantId di `selections` harus ada di sini.
   */
  participants?: SplitParticipant[];
}

/**
 * smartRounding — pembulatan largest remainder.
 *
 * Membulatkan setiap nilai ke bilangan bulat sedemikian rupa sehingga
 * sum(hasil) == target. Kekurangan dari pembulatan ke bawah ("chips" +1)
 * dibagikan ke nilai dengan bagian pecahan terbesar (tie → urutan input yang
 * lebih awal, agar deterministik).
 */
export function smartRounding(values: number[], target: number): number[] {
  if (!Number.isFinite(target)) {
    throw new SplitEngineError("target smartRounding harus finite");
  }
  if (values.some((v) => !Number.isFinite(v))) {
    throw new SplitEngineError("nilai smartRounding harus finite");
  }

  const result = values.map((v) => Math.floor(v));
  let diff = Math.round(target) - result.reduce((a, b) => a + b, 0);

  // Urutan stabil: frac terbesar dulu (untuk menambah), terkecil dulu (untuk mengurangi).
  const byFracDesc = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  while (diff > 0) {
    for (const { i } of byFracDesc) {
      if (diff <= 0) break;
      result[i] += 1;
      diff -= 1;
    }
    if (diff > 0) break; // guard anti infinite-loop untuk target di luar kontrak
  }
  while (diff < 0) {
    for (const { i } of [...byFracDesc].reverse()) {
      if (diff >= 0) break;
      result[i] -= 1;
      diff += 1;
    }
    if (diff < 0) break;
  }
  return result;
}

function assertNonNegativeNumber(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SplitEngineError(`${name} harus angka finite (dapat ${value})`);
  }
  if (value < 0) {
    throw new SplitEngineError(`${name} tidak boleh negatif (dapat ${value})`);
  }
}

/**
 * calcProportional — hitung tagihan per peserta secara proporsional.
 *
 * @param items       daftar item struk
 * @param selections  itemId → participantId[] yang makan item itu
 * @param tax         pajak struk (nominal rupiah)
 * @param service     service charge (nominal rupiah)
 * @param discount    diskon promo (nominal rupiah, angka positif)
 */
export function calcProportional(
  items: SplitItem[],
  selections: Selections,
  tax: number,
  service: number,
  discount: number,
  options: CalcProportionalOptions = {}
): CalcResult {
  assertNonNegativeNumber("tax", tax);
  assertNonNegativeNumber("service", service);
  assertNonNegativeNumber("discount", discount);

  if (!Array.isArray(items)) {
    throw new SplitEngineError("items harus array");
  }
  for (const item of items) {
    if (!item || typeof item.id !== "string" || item.id.length === 0) {
      throw new SplitEngineError("setiap item butuh id string");
    }
    assertNonNegativeNumber(`price item "${item.name ?? item.id}"`, item.price);
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new SplitEngineError(`qty item "${item.name}" harus integer ≥ 1`);
    }
  }

  const knownParticipantIds = new Set<string>();
  const participantNames = new Map<string, string>();
  for (const p of options.participants ?? []) {
    if (knownParticipantIds.has(p.id)) {
      throw new SplitEngineError(`participant id duplikat: ${p.id}`);
    }
    knownParticipantIds.add(p.id);
    participantNames.set(p.id, p.displayName);
  }

  // Validasi seleksi + kumpulkan semua peserta yang muncul.
  const itemIds = new Set(items.map((i) => i.id));
  if (itemIds.size !== items.length) {
    throw new SplitEngineError("ada item dengan id duplikat");
  }
  const eaterIds = new Set<string>();
  for (const [itemId, pids] of Object.entries(selections)) {
    if (!itemIds.has(itemId)) {
      throw new SplitEngineError(
        `seleksi merujuk item tidak dikenal: ${itemId}`
      );
    }
    if (!Array.isArray(pids)) {
      throw new SplitEngineError(`seleksi item ${itemId} harus array`);
    }
    for (const pid of pids) {
      if (options.participants && !knownParticipantIds.has(pid)) {
        throw new SplitEngineError(
          `seleksi merujuk peserta tidak dikenal: ${pid}`
        );
      }
      eaterIds.add(pid);
    }
  }
  for (const pid of eaterIds) {
    if (!participantNames.has(pid)) participantNames.set(pid, pid);
  }

  // Subtotal presisi per peserta (bagian rata dari tiap item yang dimakan).
  const preciseSubtotal = new Map<string, number>();
  for (const pid of participantNames.keys()) preciseSubtotal.set(pid, 0);

  const unclaimedItems: CalcResult["unclaimedItems"] = [];
  let subtotal = 0;
  let claimedSubtotal = 0;

  for (const item of items) {
    subtotal += item.price;
    const eaters = [...new Set(selections[item.id] ?? [])];
    if (eaters.length === 0) {
      unclaimedItems.push({ id: item.id, name: item.name, price: item.price });
      continue;
    }
    claimedSubtotal += item.price;
    const share = item.price / eaters.length;
    for (const pid of eaters) {
      preciseSubtotal.set(pid, (preciseSubtotal.get(pid) ?? 0) + share);
    }
  }

  // Rasio tiap peserta terhadap subtotal terklaim.
  const ratio = (pid: string): number =>
    claimedSubtotal > 0 ? (preciseSubtotal.get(pid) ?? 0) / claimedSubtotal : 0;

  const orderedIds = [...participantNames.keys()];
  const preciseTax = orderedIds.map((pid) => tax * ratio(pid));
  const preciseService = orderedIds.map((pid) => service * ratio(pid));
  const preciseDiscount = orderedIds.map((pid) => discount * ratio(pid));

  // smartRounding per komponen → tiap kolom berjumlah persis nominal sumber.
  const amountSubtotal = smartRounding(
    orderedIds.map((pid) => preciseSubtotal.get(pid) ?? 0),
    Math.round(claimedSubtotal)
  );
  const amountTax = smartRounding(preciseTax, Math.round(tax));
  const amountService = smartRounding(preciseService, Math.round(service));
  const amountDiscount = smartRounding(preciseDiscount, Math.round(discount));

  const settlements: SettlementRow[] = orderedIds.map((pid, i) => {
    const amountFinal =
      amountSubtotal[i] + amountTax[i] + amountService[i] - amountDiscount[i];
    return {
      participantId: pid,
      displayName: participantNames.get(pid) ?? pid,
      amountSubtotal: amountSubtotal[i],
      amountTax: amountTax[i],
      amountService: amountService[i],
      amountDiscount: amountDiscount[i],
      amountFinal,
    };
  });

  const settledTotal = settlements.reduce((a, s) => a + s.amountFinal, 0);
  const grandTotal = subtotal + tax + service - discount;
  const unclaimedSubtotal = unclaimedItems.reduce((a, u) => a + u.price, 0);

  return {
    settlements,
    totals: {
      subtotal,
      claimedSubtotal,
      unclaimedSubtotal,
      tax,
      service,
      discount,
      grandTotal,
      settledTotal,
      diff: Math.round(grandTotal) - settledTotal,
    },
    unclaimedItems,
    isFullyClaimed: unclaimedItems.length === 0,
  };
}
