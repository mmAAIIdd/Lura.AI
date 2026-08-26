import { randomUUID } from "node:crypto";

/** Короткий идентификатор документа, треда и отчёта. */
export function newId(): string {
  return randomUUID().slice(0, 12);
}
