import { NextResponse } from "next/server";

import { studioIsOpen } from "@/lib/studio/access";
import { LOCAL_OWNER, asOwnerId, type OwnerId } from "@/lib/studio/owner";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Кто владеет рабочим пространством в текущем запросе.
 *
 * Обработчики под app/api/studio — настоящая граница Studio, а не middleware.
 * Middleware отвечает на вопрос «пускать ли к адресу», и ответ этот зависит от
 * заголовков запроса; обработчик обязан ответить на другой вопрос — «чьё это
 * пространство» — и восстановить личность заново, ничего не принимая на веру
 * от вышестоящего слоя.
 *
 * Результат — размеченное объединение, как у checkName в lib/studio/project.ts:
 * либо владелец, либо готовый ответ с ошибкой. Обработчику хватает двух строк в
 * начале метода, и ему не приходится оборачивать себя в try/catch, как это
 * пришлось бы с исключением. StorageUnavailableError сделан исключением по
 * противоположной причине: он всплывает из глубины хранилища, где вернуть
 * HTTP-ответ некому.
 */

/**
 * Владелец локальной разработки и режима STUDIO_PUBLIC=true.
 *
 * Он один на всех, и это сделано намеренно. Открытое рабочее пространство по
 * определению не знает, кто пришёл: заводить каждому посетителю отдельного
 * владельца значило бы терять его документы при каждой смене браузера, а
 * спрашивать вход — возвращать тот самый круг по OAuth, ради обхода которого
 * studioIsOpen() и существует. Поэтому оба открытых режима сходятся в одно
 * общее, ничем не разделённое пространство.
 *
 * В продакшене без STUDIO_PUBLIC сюда не попасть: там единственный путь —
 * подписанный токен Supabase.
 *
 * С разделением пространств по владельцу это уже не просто метка в логе, а
 * граница данных: «local» — такой же арендатор, как любой sub, со своей папкой
 * на диске и своим значением в owner_id. Поэтому и значение живёт теперь в
 * lib/studio/owner.ts, рядом с проверкой, а не здесь.
 */
export { LOCAL_OWNER };
export type { OwnerId };

/** Владелец запроса либо готовый 401 — разбирается через `"denied" in result`. */
export type StudioOwner = { ownerId: OwnerId } | { denied: Response };

/**
 * Владелец текущего запроса к Studio.
 *
 * Вызывается первой строкой каждого обработчика. Значение ownerId — то самое,
 * которым дальше ограничиваются выборки из хранилища.
 *
 * sub из токена проходит через asOwnerId, и не прошедший проверку получает
 * отказ, а не исправленное значение. Личность, которую нельзя записать в
 * границу, — это личность, которую нельзя изолировать; подчистить её означало
 * бы поселить неизвестно кого в чужом пространстве. Отказ честнее.
 */
export async function requireStudioOwner(): Promise<StudioOwner> {
  const sub = await signedInOwner();
  if (sub) {
    const ownerId = asOwnerId(sub);
    if (ownerId) return { ownerId };
    return { denied: NextResponse.json({ error: "Требуется вход." }, { status: 401 }) };
  }
  if (studioIsOpen()) return { ownerId: LOCAL_OWNER };
  return { denied: NextResponse.json({ error: "Требуется вход." }, { status: 401 }) };
}

/**
 * Идентификатор вошедшего пользователя или null.
 *
 * getClaims, а не getSession: он проверяет подпись токена опубликованными
 * ключами проекта, тогда как getSession возвращает содержимое cookie как есть.
 * Ровно то же соображение записано в lib/supabase/middleware.ts, и расходиться
 * этим двум местам нельзя.
 *
 * Без настроенного Supabase читать нечего — запрос считается не вошедшим, а не
 * ошибочным: решение, пускать ли такого, принимается ниже по studioIsOpen().
 */
async function signedInOwner(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub ? sub : null;
}
