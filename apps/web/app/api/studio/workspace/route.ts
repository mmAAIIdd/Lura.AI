import { NextResponse } from "next/server";

import { requireStudioOwner } from "@/lib/studio/auth";
import { LURA_MODELS, geminiKey } from "@/lib/studio/config";
import { currentProvider } from "@/lib/studio/search";
import { StorageUnavailableError, storageIsEphemeral, studioStore, type StudioStore } from "@/lib/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Всё, что нужно рабочему пространству при открытии: документы, треды, готовность. */
export async function GET() {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;
  const store = studioStore(owner.ownerId);

  let documents: Awaited<ReturnType<StudioStore["listDocuments"]>>;
  let threads: Awaited<ReturnType<StudioStore["listThreads"]>>;
  try {
    [documents, threads] = await Promise.all([store.listDocuments(), store.listThreads()]);
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
      storage: store.label,
      ephemeral: storageIsEphemeral(),
    },
  });
}
