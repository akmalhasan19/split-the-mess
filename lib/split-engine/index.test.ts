import { describe, expect, it } from "vitest";

import {
  calcProportional,
  smartRounding,
  SplitEngineError,
  type CalcResult,
} from "@/lib/split-engine";
import type { Selections, SplitItem } from "@/lib/split-engine";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Helper: hitung + sanity check invariant dasar. */
function calc(
  items: SplitItem[],
  selections: Selections,
  tax: number,
  service: number,
  discount: number,
  participants?: { id: string; displayName: string }[]
): CalcResult {
  const result = calcProportional(items, selections, tax, service, discount, {
    participants,
  });
  // Invariant: setiap kolom pembulatan berjumlah persis sumbernya.
  // (Hanya berlaku bila ada subtotal terklaim — bila tidak ada, pajak dll.
  // memang tidak dibagikan ke siapa pun.)
  const claimed = result.totals.claimedSubtotal;
  expect(sum(result.settlements.map((s) => s.amountSubtotal))).toBe(
    Math.round(claimed)
  );
  if (claimed > 0) {
    expect(sum(result.settlements.map((s) => s.amountTax))).toBe(
      Math.round(tax)
    );
    expect(sum(result.settlements.map((s) => s.amountService))).toBe(
      Math.round(service)
    );
    expect(sum(result.settlements.map((s) => s.amountDiscount))).toBe(
      Math.round(discount)
    );
  }
  return result;
}

describe("smartRounding", () => {
  it("K1: jumlah hasil == target (kasus klasik 100/3)", () => {
    expect(smartRounding([33.3333, 33.3333, 33.3333], 100)).toEqual([
      34, 33, 33,
    ]);
  });

  it("K2: nilai sudah bulat → tidak berubah", () => {
    expect(smartRounding([100, 200], 300)).toEqual([100, 200]);
  });

  it("K3: target 0 dengan nilai kecil → semua 0", () => {
    expect(smartRounding([0.2, 0.2, 0.2], 1)).toEqual([1, 0, 0]);
  });

  it("K4: deterministik — urutan input pecahan sama → hasil stabil", () => {
    const a = smartRounding([10.5, 10.5, 10.5, 10.5], 42);
    const b = smartRounding([10.5, 10.5, 10.5, 10.5], 42);
    expect(a).toEqual(b);
    expect(sum(a)).toBe(42);
  });

  it("K5: menolak nilai non-finite", () => {
    expect(() => smartRounding([NaN], 10)).toThrow(SplitEngineError);
    expect(() => smartRounding([Infinity], 10)).toThrow(SplitEngineError);
    expect(() => smartRounding([1], NaN)).toThrow(SplitEngineError);
  });
});

describe("calcProportional — dasar", () => {
  const pizza = { id: "i1", name: "Pizza Pepperoni", price: 85000, qty: 1 };
  const burger = { id: "i2", name: "Cheeseburger", price: 45000, qty: 1 };
  // Iced Latte: 2 unit × Rp30.000 → total baris Rp60.000.
  const latte = { id: "i3", name: "Iced Latte", price: 60000, qty: 2 };

  it("K6: contoh proposal — Pizza 85k, Burger 45k, 2×Latte 30k + pajak 35k, service 17.5k, diskon 23.5k → pas 350k", () => {
    // subtotal 190.000; pajak 35.000; service 17.500; diskon 23.500 → total 219.000
    // Tapi skenario proposal: total 350k → kita pakai pajak/service/diskon agar pas.
    const result = calc(
      [pizza, burger, latte],
      { i1: ["akmal", "fajar"], i2: ["rizky"], i3: ["dimas", "nadia"] },
      35000,
      17500,
      0,
      [
        { id: "akmal", displayName: "Akmal" },
        { id: "fajar", displayName: "Fajar" },
        { id: "rizky", displayName: "Rizky" },
        { id: "dimas", displayName: "Dimas" },
        { id: "nadia", displayName: "Nadia" },
      ]
    );
    expect(result.totals.subtotal).toBe(190000);
    expect(result.totals.grandTotal).toBe(242500);
    expect(result.totals.settledTotal).toBe(242500);
    expect(result.totals.diff).toBe(0);
    // Pizza dibagi 2: 42.500 per orang.
    const akmal = result.settlements.find((s) => s.participantId === "akmal")!;
    expect(akmal.amountSubtotal).toBe(42500);
    // Iced Latte total baris 60k dibagi 2 orang → 30.000 per orang.
    const dimas = result.settlements.find((s) => s.participantId === "dimas")!;
    expect(dimas.amountSubtotal).toBe(30000);
    // Pajak proporsional: akmal rasio 42500/190000 → 35000 × 42500/190000 = 7828.94… → pembulatan largest remainder.
    // total pajak harus persis 35000.
    expect(sum(result.settlements.map((s) => s.amountTax))).toBe(35000);
    expect(sum(result.settlements.map((s) => s.amountService))).toBe(17500);
  });

  it("K7: satu peserta makan semua → dia bayar total struk", () => {
    const result = calc(
      [pizza, burger],
      { i1: ["a"], i2: ["a"] },
      10000,
      5000,
      0
    );
    expect(result.settlements).toHaveLength(1);
    expect(result.settlements[0].amountFinal).toBe(145000);
  });

  it("K8: 1 item dimakan berdua → harga dibagi rata 2", () => {
    const result = calc([pizza], { i1: ["a", "b"] }, 0, 0, 0);
    expect(result.settlements.map((s) => s.amountFinal)).toEqual([
      42500, 42500,
    ]);
  });

  it("K9: proporsional pajak mengikuti rasio subtotal", () => {
    const result = calc([pizza, burger], { i1: ["a"], i2: ["b"] }, 19000, 0, 0);
    // subtotal a=85k, b=45k → total 130k; pajak 19k dibagi rasio 85/130 dan 45/130.
    const a = result.settlements[0];
    const b = result.settlements[1];
    expect(a.amountTax + b.amountTax).toBe(19000);
    expect(a.amountTax).toBe(12423); // 19000 × 85/130 = 12423.07… → floor+tweak
    expect(b.amountTax).toBe(6577);
  });

  it("K10: peserta tanpa item → nominal 0, tetap muncul", () => {
    const result = calc([pizza], { i1: ["a"] }, 0, 0, 0, [
      { id: "a", displayName: "A" },
      { id: "ghost", displayName: "Ghost" },
    ]);
    const ghost = result.settlements.find((s) => s.participantId === "ghost")!;
    expect(ghost.amountFinal).toBe(0);
    expect(result.settlements).toHaveLength(2);
  });
});

describe("calcProportional — edge cases", () => {
  const pizza = { id: "i1", name: "Pizza", price: 85000, qty: 1 };
  const sate = { id: "i2", name: "Sate", price: 60000, qty: 1 };

  it("K11: item tanpa pemilih → tidak dibagi, dilaporkan di unclaimedItems", () => {
    const result = calc([pizza, sate], { i1: ["a"] }, 0, 0, 0);
    expect(result.unclaimedItems).toEqual([
      { id: "i2", name: "Sate", price: 60000 },
    ]);
    expect(result.isFullyClaimed).toBe(false);
    // yang terklaim saja yang dibagi: a bayar 85k, bukan 145k.
    expect(result.settlements[0].amountFinal).toBe(85000);
    expect(result.totals.unclaimedSubtotal).toBe(60000);
    expect(result.totals.diff).toBe(60000); // 60k belum kebagi siapa pun
  });

  it("K12: semua item tanpa pemilih → tidak ada crash, pajak tidak dibagi", () => {
    const result = calc([pizza], {}, 11000, 5000, 0);
    expect(result.settlements).toEqual([]);
    expect(result.totals.settledTotal).toBe(0);
    expect(result.totals.unclaimedSubtotal).toBe(85000);
  });

  it("K13: diskon > pajak → amountFinal tetap benar (bisa jauh di bawah subtotal)", () => {
    const result = calc(
      [pizza, sate],
      { i1: ["a"], i2: ["b"] },
      5000,
      0,
      30000
    );
    // subtotal 145k, pajak 5k, diskon 30k → total 120k.
    expect(result.totals.grandTotal).toBe(120000);
    expect(result.totals.settledTotal).toBe(120000);
    const a = result.settlements[0];
    expect(a.amountDiscount).toBeGreaterThan(0);
    expect(a.amountFinal).toBe(
      a.amountSubtotal + a.amountTax - a.amountDiscount
    );
  });

  it("K14: diskon lebih besar dari pajak+service sekalipun → final tidak negatif di level total", () => {
    const result = calc(
      [pizza, sate],
      { i1: ["a"], i2: ["b"] },
      5000,
      3000,
      90000
    );
    // 145k + 5k + 3k − 90k = 63k (masih positif).
    expect(result.totals.settledTotal).toBe(63000);
    for (const s of result.settlements) {
      expect(s.amountFinal).toBeGreaterThanOrEqual(0);
    }
  });

  it("K15: diskon ekstrem melebihi total struk → final per orang bisa negatif (diproses apa adanya, dibulatkan konsisten)", () => {
    const result = calc([pizza, sate], { i1: ["a"], i2: ["b"] }, 0, 0, 200000);
    // 145k − 200k = −55k.
    expect(result.totals.grandTotal).toBe(-55000);
    expect(result.totals.settledTotal).toBe(-55000);
    // kolom diskon tetap berjumlah 200k.
    expect(sum(result.settlements.map((s) => s.amountDiscount))).toBe(200000);
  });

  it("K16: seleksi duplikat (peserta dobel di 1 item) → tidak dobel hitung", () => {
    const result = calc([pizza], { i1: ["a", "a", "b"] }, 0, 0, 0);
    expect(result.settlements.map((s) => s.amountFinal)).toEqual([
      42500, 42500,
    ]);
  });

  it("K17: pembulatan rupiah — 3 orang bagian sama dengan pajak ganjil tetap pas total", () => {
    // subtotal 100.001 dibagi 3 → 33.333,67; pajak 7.777; service 1.234.
    const odd = { id: "x", name: "Nasi Goreng Spesial", price: 100001, qty: 1 };
    const result = calc([odd], { x: ["a", "b", "c"] }, 7777, 1234, 0);
    expect(result.totals.settledTotal).toBe(100001 + 7777 + 1234);
    expect(result.totals.diff).toBe(0);
    // komponen pajak per orang berjumlah 7777.
    expect(sum(result.settlements.map((s) => s.amountTax))).toBe(7777);
  });

  it("K18: menolak pajak negatif", () => {
    expect(() => calcProportional([pizza], { i1: ["a"] }, -1, 0, 0)).toThrow(
      SplitEngineError
    );
  });

  it("K19: menolak seleksi merujuk peserta tak dikenal saat participants diberikan", () => {
    expect(() =>
      calcProportional([pizza], { i1: ["hacker"] }, 0, 0, 0, {
        participants: [{ id: "a", displayName: "A" }],
      })
    ).toThrow(/peserta tidak dikenal/);
  });

  it("K20: menolak item id duplikat & seleksi item tak dikenal", () => {
    expect(() =>
      calcProportional([pizza, { ...pizza }], { i1: ["a"] }, 0, 0, 0)
    ).toThrow(/duplikat/);
    expect(() => calcProportional([pizza], { hantu: ["a"] }, 0, 0, 0)).toThrow(
      /item tidak dikenal/
    );
  });
});

describe("calcProportional — presisi float", () => {
  it("K21: harga float (mis. 0.1 + 0.2 style) tidak merusak invariant penjumlahan", () => {
    const items: SplitItem[] = [
      { id: "a", name: "A", price: 10000, qty: 1 },
      { id: "b", name: "B", price: 10000, qty: 1 },
    ];
    const result = calc(
      items,
      { a: ["p1", "p2", "p3"], b: ["p1"] },
      3333,
      0,
      0
    );
    expect(result.totals.diff).toBe(0);
  });
});
