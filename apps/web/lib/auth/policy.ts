/**
 * Account rules, kept deliberately identical to the ones `apps/api` enforces in
 * `validate_password_policy`, so an account created through Supabase can never
 * be one the backend would have rejected.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 120;

export const PASSWORD_RULE_HINT = "Минимум 12 символов, заглавная и строчная буквы, цифра.";

export function validateName(value: string): string | null {
  if (value.length < NAME_MIN_LENGTH) return "Имя должно содержать минимум 2 символа.";
  if (value.length > NAME_MAX_LENGTH) return "Имя не должно быть длиннее 120 символов.";
  return null;
}

export function validateEmail(value: string): string | null {
  // Deliberately loose: Supabase is the authority on address validity, this
  // only catches the obvious typo before a network round-trip.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Введите корректный email.";
  if (value.length > 320) return "Email слишком длинный.";
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов.`;
  if (value.length > PASSWORD_MAX_LENGTH) return `Пароль не должен быть длиннее ${PASSWORD_MAX_LENGTH} символов.`;
  if (!/[a-zа-яё]/u.test(value)) return "Пароль должен содержать строчную букву.";
  if (!/[A-ZА-ЯЁ]/u.test(value)) return "Пароль должен содержать заглавную букву.";
  if (!/\d/u.test(value)) return "Пароль должен содержать цифру.";
  return null;
}

export function validatePasswordPair(password: string, confirmation: string): string | null {
  return validatePassword(password) ?? (password === confirmation ? null : "Пароли не совпадают.");
}
