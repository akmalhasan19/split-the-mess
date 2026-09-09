import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = createServiceClient();
    const bucket = "receipts";

    const { data: buckets, error: listError } =
      await supabase.storage.listBuckets();
    if (listError) throw listError;

    let bucketState = buckets?.find((b) => b.name === bucket) ?? null;

    if (!bucketState) {
      const { data, error } = await supabase.storage.createBucket(bucket, {
        public: true,
      });
      if (error) throw error;
      bucketState = data as unknown as typeof bucketState;
    }

    // Write + read + delete roundtrip (file kecil, aman untuk verifikasi).
    const probeName = `phase0-probe-${Date.now()}.txt`;
    const probeBody = `split-the-mess phase-0 storage probe ${new Date().toISOString()}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(probeName, probeBody, { contentType: "text/plain" });
    if (uploadError) throw uploadError;

    const { data: downloaded, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(probeName);
    if (downloadError) throw downloadError;
    const text = await downloaded.text();

    await supabase.storage.from(bucket).remove([probeName]);

    return NextResponse.json({
      ok: text === probeBody,
      bucket,
      public: bucketState?.public ?? true,
      roundtrip: text === probeBody ? "write+read+delete OK" : "mismatch",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "storage check failed",
      },
      { status: 503 }
    );
  }
}
