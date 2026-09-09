/**
 * Apply semua file .sql di supabase/migrations (urut nama file) ke database
 * Supabase live. File migrasi ditulis idempotent (IF NOT EXISTS / DO blocks),
 * sehingga script ini aman dijalankan berulang.
 *
 * Pemakaian:
 *   SUPABASE_DB_URL="postgresql://..." node scripts/db-push.mjs [--verify-only]
 *
 * Windows PowerShell:
 *   $env:SUPABASE_DB_URL="..."; node scripts/db-push.mjs
 *
 * --verify-only: hanya jalankan query verifikasi, tanpa apply DDL.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL tidak diset. Lihat header script ini.");
  process.exit(1);
}

const verifyOnly = process.argv.includes("--verify-only");
const migrationsDir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres(url, {
  ssl: "prefer",
  max: 1,
  prepare: false, // wajib untuk transaction pooler (PgBouncer)
});

async function main() {
  console.log(`Migrations directory: ${migrationsDir}`);
  console.log(`Files (${files.length}): ${files.join(", ")}`);

  if (!verifyOnly) {
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      try {
        await sql.unsafe(content);
        console.log("OK");
      } catch (err) {
        console.log("FAILED");
        console.error(err.message ?? err);
        await sql.end({ timeout: 5 });
        process.exit(1);
      }
    }
  }

  // ---- Verifikasi skema ----
  const expected = {
    sessions: [
      "token",
      "receipt_image_url",
      "subtotal",
      "tax",
      "service_charge",
      "discount",
      "payer_bca",
      "payer_qris_url",
      "status",
      "raw_ocr_json",
      "expires_at",
    ],
    items: ["id", "session_id", "name", "price", "qty"],
    participants: ["id", "session_id", "display_name"],
    selections: ["item_id", "participant_id"],
    settlements: [
      "session_id",
      "participant_id",
      "amount_subtotal",
      "amount_tax",
      "amount_service",
      "amount_discount",
      "amount_final",
      "is_paid",
    ],
  };

  let failures = 0;
  for (const [table, cols] of Object.entries(expected)) {
    const rows = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${table}
      order by ordinal_position`;
    const have = new Set(rows.map((r) => r.column_name));
    const missing = cols.filter((c) => !have.has(c));
    if (rows.length === 0 || missing.length > 0) {
      failures++;
      console.log(
        `FAIL  table ${table}: ${rows.length === 0 ? "TIDAK ADA" : `kolom kurang: ${missing.join(", ")}`}`
      );
    } else {
      console.log(`PASS  table ${table} (${rows.length} kolom)`);
    }
  }

  // RLS aktif di semua tabel?
  const rls = await sql`
    select tablename, rowsecurity from pg_tables
    where schemaname = 'public'
      and tablename in ('sessions','items','participants','selections','settlements')`;
  for (const r of rls) {
    const ok = r.rowsecurity === true;
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  RLS ${r.tablename}: ${r.rowsecurity}`
    );
  }

  console.log(
    failures === 0
      ? "\nVERIFIKASI DB: SEMUA PASS ✔"
      : `\nVERIFIKASI DB: ${failures} gagal ✘`
  );
  await sql.end({ timeout: 5 });
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Fatal:", err.message ?? err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
