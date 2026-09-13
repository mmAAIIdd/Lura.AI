/**
 * Разбор причины отказа при подготовке схемы в Postgres.
 *
 * Тест существует из-за конкретной поломки: `create extension` — первый
 * оператор, доходящий до сервера, и его catch объявлял любую неудачу
 * отсутствием pgvector. Человек с неверным паролем в строке подключения ушёл
 * чинить Database → Extensions, где всё было в порядке. Поэтому здесь
 * проверяется не то, что сообщение вообще появилось, а то, какую именно
 * причину оно называет — и что исходный текст ошибки уцелел в каждой ветке:
 * в том случае только он и позволил разобраться.
 *
 * Ошибки строятся так же, как их собирает библиотека: серверные — через
 * postgres.PostgresError с SQLSTATE в code, транспортные — Error с errno,
 * как их отдаёт сокет Node или Errors.connection().
 *
 * Запуск: npm run test (node --test, без единой зависимости).
 */

import assert from "node:assert/strict";
import test from "node:test";

import postgres from "postgres";

const { describeSchemaFailure } = await import("@/lib/studio/store/postgres.ts");

function serverError(code, message) {
  return new postgres.PostgresError({ severity: "FATAL", code, message, file: "x.c", line: "1", routine: "x" });
}

function transportError(code, message) {
  return Object.assign(new Error(message), { code, errno: code });
}

test("неверный пароль не выдаётся за отсутствующее расширение", () => {
  const message = describeSchemaFailure(serverError("28P01", 'password authentication failed for user "postgres"'));
  assert.match(message, /пароль/i);
  assert.match(message, /квадратные скобки/);
  assert.doesNotMatch(message, /pgvector|Extensions/);
});

test("отказ авторизации (28000) разбирается так же", () => {
  const message = describeSchemaFailure(serverError("28000", "no pg_hba.conf entry for host"));
  assert.match(message, /пароль/i);
  assert.doesNotMatch(message, /pgvector/);
});

test("недоступный хост называет хост и порт, а не расширение", () => {
  for (const code of ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT"]) {
    const message = describeSchemaFailure(transportError(code, `getaddrinfo ${code} db.example.supabase.co`));
    assert.match(message, /6543/, `не назван порт пула для ${code}`);
    assert.doesNotMatch(message, /pgvector/, `транспортная ошибка ${code} выдана за расширение`);
  }
});

test("несуществующая база называет имя базы", () => {
  const message = describeSchemaFailure(serverError("3D000", 'database "postgress" does not exist'));
  assert.match(message, /Имя базы/);
  assert.doesNotMatch(message, /pgvector/);
});

test("настоящая недоступность pgvector по-прежнему ведёт в Database → Extensions", () => {
  for (const code of ["42501", "0A000", "58P01"]) {
    const message = describeSchemaFailure(serverError(code, "permission denied to create extension \"vector\""));
    assert.match(message, /pgvector/, `код ${code} перестал считаться случаем расширения`);
    assert.match(message, /Database → Extensions/);
  }
});

test("незнакомый код не получает придуманной причины", () => {
  const message = describeSchemaFailure(serverError("XX000", "internal error"));
  assert.doesNotMatch(message, /pgvector|пароль|6543|Имя базы/);
  assert.match(message, /internal error/);
});

test("исходный текст ошибки сохраняется во всех ветках", () => {
  const cases = [
    serverError("28P01", "деталь-28P01"),
    serverError("3D000", "деталь-3D000"),
    transportError("ECONNREFUSED", "деталь-ECONNREFUSED"),
    serverError("58P01", "деталь-58P01"),
    serverError("XX000", "деталь-XX000"),
    "строка вместо Error",
  ];
  for (const error of cases) {
    const detail = error instanceof Error ? error.message : String(error);
    assert.match(describeSchemaFailure(error), new RegExp(`\\(?${detail}`), `потеряна деталь: ${detail}`);
  }
});

test("ошибка без кода не роняет разбор", () => {
  assert.match(describeSchemaFailure(new Error("нет кода")), /нет кода/);
  assert.match(describeSchemaFailure(null), /null/);
});
