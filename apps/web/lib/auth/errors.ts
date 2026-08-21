import { AuthError, isAuthApiError } from "@supabase/supabase-js";

/**
 * Supabase returns stable machine codes; the visible copy is ours. Anything not
 * listed falls back to a generic line rather than leaking an English internal
 * message into a Russian screen.
 */
const MESSAGES_BY_CODE: Record<string, string> = {
  invalid_credentials: "Неверный email или пароль.",
  email_not_confirmed: "Email ещё не подтверждён. Откройте письмо и перейдите по ссылке.",
  email_exists: "Аккаунт с таким email уже существует.",
  user_already_exists: "Аккаунт с таким email уже существует.",
  email_address_invalid: "Этот адрес электронной почты недействителен.",
  email_address_not_authorized: "На этот адрес отправка писем не разрешена в текущей конфигурации проекта.",
  weak_password: "Пароль слишком простой. Выберите более надёжный.",
  same_password: "Новый пароль совпадает с текущим. Придумайте другой.",
  signup_disabled: "Регистрация новых аккаунтов сейчас отключена.",
  otp_expired: "Ссылка устарела или уже была использована. Запросите новую.",
  over_email_send_rate_limit: "Слишком много писем за короткое время. Подождите минуту и попробуйте снова.",
  over_request_rate_limit: "Слишком много попыток. Подождите немного и попробуйте снова.",
  validation_failed: "Проверьте правильность заполнения полей.",
  session_expired: "Сессия истекла. Войдите заново.",
  user_not_found: "Аккаунт не найден.",
  user_banned: "Доступ к аккаунту временно заблокирован.",
};

export function describeAuthError(error: unknown, fallback: string): string {
  if (error instanceof AuthError) {
    if (error.code && MESSAGES_BY_CODE[error.code]) return MESSAGES_BY_CODE[error.code];
    // A 429 without a specific code is still a rate limit worth naming.
    if (isAuthApiError(error) && error.status === 429) return MESSAGES_BY_CODE.over_request_rate_limit;
    return fallback;
  }
  if (error instanceof TypeError) {
    // fetch() rejects with TypeError when the Supabase host cannot be reached.
    return "Не удалось связаться с сервисом аутентификации. Проверьте подключение к сети.";
  }
  if (error instanceof Error && error.message.startsWith("Supabase не настроен")) return error.message;
  return fallback;
}
