import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "split-the-mess",
    phase: 0,
    time: new Date().toISOString(),
  });
}
