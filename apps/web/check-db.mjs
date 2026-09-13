/**
 * Проверка строки подключения STUDIO_DATABASE_URL.
 *
 * Запуск из apps/web:
 *   node <этот файл> "postgresql://..."
 *
 * Пароль нигде не печатается: ни целиком, ни частями. Выводится только разбор
 * строки и то, что ответила база.
 */
import postgres from "postgres";

const raw = process.argv[2];

if (!raw) {
  console.log("Передайте строку в кавычках:  node check-db.mjs \"postgresql://...\"");
  process.exit(1);
}

console.log("\n=== РАЗБОР СТРОКИ ===");

let url;
try {
  url = new URL(raw);
} catch {
  console.log("  ✗ Строка не разбирается как URL.");
  console.log("    Чаще всего это значит, что в пароле есть @ : / ? # и его надо");
  console.log("    привести к percent-кодировке, либо проще — сбросить пароль на");
  console.log("    буквенно-цифровой в Supabase → Settings → Database.");
  process.exit(1);
}

const password = decodeURIComponent(url.password || "");
const problems = [];

console.log("  протокол:  " + url.protocol.replace(":", ""));
console.log("  хост:      " + url.hostname);
console.log("  порт:      " + (url.port || "(не указан)"));
console.log("  польз.:    " + url.username);
console.log("  база:      " + url.pathname.replace("/", ""));
console.log("  пароль:    " + (password ? `задан, длина ${password.length}` : "ПУСТОЙ"));

if (!password) problems.push("Пароль пустой — в строке между ':' и '@' ничего нет.");

if (/^\[.*\]$/.test(password)) {
  problems.push(
    'Пароль обёрнут в квадратные скобки. Это заглушка из шаблона Supabase: ' +
      'скобки надо убрать вместе с текстом [YOUR-PASSWORD] и вписать пароль без них.',
  );
} else if (password.includes("[") || password.includes("]")) {
  problems.push("В пароле есть квадратная скобка — похоже, часть шаблона осталась.");
}

if (/YOUR|PASSWORD|password/.test(password) && password.length < 20) {
  problems.push('Пароль похож на текст заглушки, а не на настоящий пароль.');
}

const risky = [...new Set([...password].filter((c) => "@:/?#[]&= ".includes(c)))];
if (risky.length) {
  problems.push(
    `В пароле есть символы, которые ломают разбор URL: ${risky.join(" ")} . ` +
      "Либо привести к percent-кодировке, либо сбросить пароль на буквенно-цифровой.",
  );
}

if (url.port !== "6543") {
  problems.push(
    `Порт ${url.port || "не указан"}, а для Vercel нужен 6543 — transaction pooler. ` +
      "На 5432 соединения кончатся при первой же нагрузке. " +
      "Supabase → Connect → Transaction pooler.",
  );
}

if (problems.length) {
  console.log("\n=== ЗАМЕЧАНИЯ ПО СТРОКЕ ===");
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
} else {
  console.log("\n  Строка выглядит корректно.");
}

console.log("\n=== ПРОБА ПОДКЛЮЧЕНИЯ ===");

const db = postgres(raw, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });

try {
  const [row] = await db`select current_user as who, current_database() as db, version() as v`;
  console.log("  ✓ Подключение прошло");
  console.log("    пользователь: " + row.who);
  console.log("    база:         " + row.db);
  console.log("    сервер:       " + String(row.v).split(" ").slice(0, 2).join(" "));

  const ext = await db`select extname from pg_extension where extname = 'vector'`;
  console.log(
    ext.length
      ? "  ✓ Расширение vector включено"
      : "  ✗ Расширения vector НЕТ → Supabase → Database → Extensions → vector",
  );
  console.log("\n  ИТОГ: строку можно ставить в STUDIO_DATABASE_URL.");
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  console.log("  ✗ Подключиться не удалось");
  console.log("    код:      " + (code || "нет"));
  console.log("    сообщение: " + (error instanceof Error ? error.message : String(error)));
  console.log("");
  if (code === "28P01" || code === "28000") {
    console.log("  ПРИЧИНА: неверный пароль или пользователь.");
    console.log("  Сбросьте пароль: Supabase → Settings → Database → Reset database password,");
    console.log("  задайте буквенно-цифровой, затем возьмите строку заново в Connect →");
    console.log("  Transaction pooler и подставьте пароль ВМЕСТО [YOUR-PASSWORD], без скобок.");
  } else if (code === "3D000") {
    console.log("  ПРИЧИНА: базы с таким именем нет. У Supabase это postgres — последний");
    console.log("  сегмент строки после «/».");
  } else if (["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(code)) {
    console.log("  ПРИЧИНА: сервер недоступен по этому адресу. Проверьте хост и порт 6543.");
  } else {
    console.log("  Причина не опознана — смотрите сообщение выше.");
  }
} finally {
  await db.end({ timeout: 5 });
}
