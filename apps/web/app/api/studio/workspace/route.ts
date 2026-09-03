import { NextResponse } from "next/server";

import { LURA_MODELS, geminiKey } from "@/lib/studio/config";
import { currentProvider } from "@/lib/studio/search";
import { StorageUnavailableError, listDocuments, listThreads, storageIsEphemeral, storeLabel } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Всё, что нужно рабочему пространству при открытии: документы, треды, готовность. */
export async function GET() {
  let documents: Awaited<ReturnType<typeof listDocuments>>;
  let threads: Awaited<ReturnType<typeof listThreads>>;
  try {
    [documents, threads] = await Promise.all([listDocuments(), listThreads()]);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  return NextResponse.json({
    documents,
    threads,
    runtime: {
      ready: Boolean(geminiKey()),
      models: LURA_MODELS,
      search: currentProvider(),
      storage: storeLabel(),
      ephemeral: storageIsEphemeral(),
    },
  });
}
