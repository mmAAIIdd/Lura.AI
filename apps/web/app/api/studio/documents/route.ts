import { NextResponse } from "next/server";

import { requireStudioOwner } from "@/lib/studio/auth";
import { LIMITS } from "@/lib/studio/config";
import { fetchPublic } from "@/lib/studio/net";
import { indexDocument } from "@/lib/studio/rag";
import {
  StorageUnavailableError,
  listDocuments,
  saveDocument,
  setBusinessDocument,
  type DocumentKind,
  type StudioDocument,
} from "@/lib/studio/store";
import { htmlToText, looksTextual } from "@/lib/studio/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка документов: файлы, ссылка или вставленный текст.
 *
 * Индексация идёт здесь же, а не в фоне: пока документ не разобран на
 * фрагменты, он для агента не существует, и «загружено» на экране означало бы
 * не то, что есть на самом деле.
 */

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function store(
  title: string,
  text: string,
  kind: DocumentKind,
  origin: StudioDocument["origin"],
): Promise<StudioDocument> {
  const document = await saveDocument({ title, kind, origin }, text);
  const index = await indexDocument(document.id, title, text);
  if (kind === "business") await setBusinessDocument(document.id);
  return { ...document, chunks: index.chunks, indexed: index.vectors ? "embeddings" : "keywords" };
}

export async function GET() {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  return NextResponse.json({ documents: await listDocuments() });
}

export async function POST(request: Request) {
  const owner = await requireStudioOwner();
  if ("denied" in owner) return owner.denied;

  try {
    return await handleUpload(request);
  } catch (error) {
    if (error instanceof StorageUnavailableError) return fail(error.message, 503);
    throw error;
  }
}

async function handleUpload(request: Request) {
  const type = request.headers.get("content-type") || "";

  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as
      | { url?: string; text?: string; title?: string; kind?: DocumentKind }
      | null;
    if (!body) return fail("Тело запроса не разобралось.");
    const kind: DocumentKind = body.kind === "business" ? "business" : "source";

    if (body.url) {
      /* Та же проверка, что у инструмента агента: адрес приходит снаружи, и
         без неё форма загрузки становится способом постучаться во внутреннюю
         сеть чужими руками. */
      let response: Response;
      let url: URL;
      try {
        ({ response, url } = await fetchPublic(body.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; LuraStudio/1.0)" },
        }));
      } catch (error) {
        return fail(error instanceof Error ? error.message : "Ссылка не открылась.");
      }
      if (!response.ok) return fail(`Страница не открылась (${response.status}).`);

      const raw = (await response.text()).slice(0, 900_000);
      const parsed = htmlToText(raw);
      const text = parsed.text || raw;
      if (!text.trim()) return fail("На странице не нашлось текста.");

      const document = await store(body.title?.trim() || parsed.title || url.hostname, text, kind, {
        type: "url",
        url: url.href,
      });
      return NextResponse.json({ documents: [document] }, { status: 201 });
    }

    if (body.text?.trim()) {
      const document = await store(body.title?.trim() || "Вставленный текст", body.text.trim(), kind, { type: "text" });
      return NextResponse.json({ documents: [document] }, { status: 201 });
    }

    return fail("Нужен файл, ссылка или текст.");
  }

  if (!type.includes("multipart/form-data")) return fail("Ожидается multipart/form-data или JSON.");

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Форма не разобралась.");

  const kind: DocumentKind = form.get("kind") === "business" ? "business" : "source";
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (!files.length) return fail("В запросе нет файлов.");

  const created: StudioDocument[] = [];
  for (const file of files) {
    if (file.size > LIMITS.uploadBytes) return fail(`Файл «${file.name}» больше ${LIMITS.uploadBytes / 1024 / 1024} МБ.`);

    const raw = await file.text();
    const isHtml = /\.html?$/i.test(file.name) || /^\s*<(!doctype|html)/i.test(raw);
    const text = isHtml ? htmlToText(raw).text : raw;

    if (!text.trim()) return fail(`Файл «${file.name}» пустой.`);
    if (!looksTextual(text.slice(0, 4000))) {
      return fail(`Файл «${file.name}» не текстовый. Подойдут txt, md, csv, json, log, html.`);
    }

    created.push(await store(file.name.replace(/\.[^.]+$/, ""), text, kind, { type: "file", name: file.name }));
    /* Основной документ ровно один: второй файл в той же загрузке идёт источником. */
    if (kind === "business") break;
  }

  return NextResponse.json({ documents: created }, { status: 201 });
}
