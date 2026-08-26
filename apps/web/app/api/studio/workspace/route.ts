import { NextResponse } from "next/server";

import { geminiKey, modelChain } from "@/lib/studio/config";
import { currentProvider } from "@/lib/studio/search";
import { listDocuments, listThreads } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Всё, что нужно рабочему пространству при открытии: документы, треды, готовность. */
export async function GET() {
  const [documents, threads] = await Promise.all([listDocuments(), listThreads()]);
  return NextResponse.json({
    documents,
    threads,
    runtime: {
      ready: Boolean(geminiKey()),
      models: modelChain(),
      search: currentProvider(),
    },
  });
}
