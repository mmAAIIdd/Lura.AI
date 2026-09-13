/**
 * Границы рабочего пространства: форма идентификатора, форма владельца и
 * изоляция файлового хранилища.
 *
 * Тест существует из-за конкретной поломки: обход каталога через id проехал в
 * рабочую ветку и нашёлся только руками, на живом сервере. Запрос с
 * ../../чужой отвечал 200 и при этом сносил чужой файл — поэтому здесь
 * проверяется диск, а не то, что вернул метод. Ответ в том случае был
 * правильный; неправильным было состояние папки после него.
 *
 * Правила не переписаны здесь заново, а импортированы: тест со своей копией
 * регулярного выражения проверяет копию и остаётся зелёным ровно тогда, когда
 * исходное правило разошлось с ним.
 *
 * Запуск: npm run test (node --test, без единой зависимости).
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/* Папка задаётся до импорта хранилища: корень разрешается один раз за процесс
   и запоминается, поэтому задать его после первого обращения уже нечем. */
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lura-studio-test-"));
process.env.STUDIO_DATA_DIR = root;

const { asOwnerId } = await import("@/lib/studio/owner.ts");
const { createFileStore, isSafeId } = await import("@/lib/studio/store/files.ts");
const { newId } = await import("@/lib/studio/store/ids.ts");

/* ---------- Форма идентификатора ---------- */

test("идентификатор: выход из каталога отвергается", () => {
  const rejected = [
    "../../other/threads/x",
    "..%2F..%2Fx",
    "..\\..\\x",
    "../".repeat(12) + "other/threads/x",
    "%2e%2e%2fx",
    ".",
    "..",
    "",
    "a".repeat(65),
  ];
  for (const id of rejected) assert.equal(isSafeId(id), false, `принят опасный id: ${JSON.stringify(id)}`);
});

test("идентификатор: обычные значения принимаются", () => {
  const accepted = ["87a5a598-b9d", "ok_id-12", "a".repeat(64)];
  for (const id of accepted) assert.equal(isSafeId(id), true, `отвергнут обычный id: ${JSON.stringify(id)}`);
});

test("идентификатор: то, что выдаёт newId(), проходит проверку", () => {
  /* Иначе хранилище отказывает на собственной записи, а не на чужом запросе. */
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const id = newId();
    assert.equal(isSafeId(id), true, `newId() выдал непригодное значение: ${id}`);
  }
});

/* ---------- Форма владельца ---------- */

test("владелец: путь и пустое значение отвергаются", () => {
  for (const raw of ["..", "a/b", "a\\b", "", "a".repeat(65)]) {
    assert.equal(asOwnerId(raw), null, `принят опасный владелец: ${JSON.stringify(raw)}`);
  }
});

test("владелец: регистр не приводится, а отвергается", () => {
  /* Приведение регистра свело бы «A1B2» и «a1b2» в одно пространство. */
  assert.equal(asOwnerId("A1B2"), null);
});

test("владелец: обычные значения принимаются", () => {
  assert.equal(asOwnerId("local"), "local");
  const uuid = "3f2b9c1e-7a4d-4e6f-8b21-0c9d5a7e1f34";
  assert.equal(asOwnerId(uuid), uuid);
});

/* ---------- Изоляция владельцев на файловом хранилище ---------- */

const OWNER_A = asOwnerId("alpha");
const OWNER_B = asOwnerId("beta");

async function fixture() {
  const alpha = createFileStore(OWNER_A);
  const beta = createFileStore(OWNER_B);

  const document = await alpha.saveDocument(
    { title: "План альфы", kind: "business", origin: { type: "text" } },
    "секрет альфы",
  );
  const now = new Date().toISOString();
  const thread = { id: newId(), title: "Разговор альфы", createdAt: now, updatedAt: now, messages: [] };
  await alpha.saveThread(thread);

  return {
    alpha,
    beta,
    document,
    thread,
    files: {
      documentJson: path.join(root, "alpha", "documents", `${document.id}.json`),
      documentText: path.join(root, "alpha", "documents", `${document.id}.txt`),
      thread: path.join(root, "alpha", "threads", `${thread.id}.json`),
    },
  };
}

test("списки чужого владельца пусты", async () => {
  const { beta } = await fixture();
  assert.deepEqual(await beta.listDocuments(), []);
  assert.deepEqual(await beta.listThreads(), []);
});

test("чужой идентификатор читается как несуществующий", async () => {
  const { beta, document, thread } = await fixture();
  assert.equal(await beta.readDocumentText(document.id), "");
  assert.equal(await beta.readThread(thread.id), null);
});

test("удаление с обходом каталога не трогает файлы другого владельца", async () => {
  const { alpha, beta, document, thread, files } = await fixture();

  /* Из beta/documents наверх два уровня — ровно в alpha. Именно эта форма id и
     срабатывала. */
  const escapes = (folder, id) => [
    `../../alpha/${folder}/${id}`,
    `..\\..\\alpha\\${folder}\\${id}`,
    `${"../".repeat(12)}alpha/${folder}/${id}`,
  ];
  for (const id of escapes("documents", document.id)) await beta.deleteDocument(id);
  for (const id of escapes("threads", thread.id)) await beta.deleteThread(id);

  /* Проверяется диск. Методы выше вернули то же самое и тогда, когда файл
     исчезал: их ответ доказательством не является. */
  assert.equal(await fs.readFile(files.documentText, "utf8"), "секрет альфы");
  assert.equal(JSON.parse(await fs.readFile(files.documentJson, "utf8")).id, document.id);
  assert.equal(JSON.parse(await fs.readFile(files.thread, "utf8")).id, thread.id);

  /* И владелец по-прежнему видит своё через обычный путь. */
  assert.equal(await alpha.readDocumentText(document.id), "секрет альфы");
  assert.equal((await alpha.readThread(thread.id))?.id, thread.id);
});

test("запись с непригодным идентификатором отказывает, а не чинит значение", async () => {
  const { beta, document } = await fixture();
  await assert.rejects(() =>
    beta.saveDocument(
      { id: `../../alpha/documents/${document.id}`, title: "подмена", kind: "source", origin: { type: "text" } },
      "чужое",
    ),
  );
  assert.equal(await fs.readFile(path.join(root, "alpha", "documents", `${document.id}.txt`), "utf8"), "секрет альфы");
});

test.after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
