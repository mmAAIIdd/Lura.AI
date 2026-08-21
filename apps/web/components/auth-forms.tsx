"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { requestPasswordReset } from "@/app/forgot-password/actions";
import { signInWithEmail } from "@/app/login/actions";
import { resendConfirmationEmail, signUpWithEmail } from "@/app/register/actions";
import { updatePassword } from "@/app/reset-password/actions";
import { getSafeNextPath } from "@/lib/api";
import {
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE_HINT,
} from "@/lib/auth/policy";
import { initialAuthState, type AuthActionState } from "@/lib/auth/state";

function FormFeedback({ state }: { state: AuthActionState }) {
  if (!state.message) return null;
  return state.status === "error" ? (
    <p className="form-error" role="alert">{state.message}</p>
  ) : (
    <p className="form-success" role="status">{state.message}</p>
  );
}

function SubmitButton({
  pending,
  children,
  variant = "button-primary",
}: {
  pending: boolean;
  children: string;
  variant?: "button-primary" | "button-secondary";
}) {
  return (
    <button className={"button " + variant} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Подождите..." : children}
    </button>
  );
}

/**
 * Signing in. Separate from registration on purpose: this screen never creates
 * an account, and an unknown address gets the same answer as a wrong password.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = getSafeNextPath(params.get("next"));
  const [state, formAction, pending] = useActionState(signInWithEmail, initialAuthState);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (state.status !== "success") return;
    let cancelled = false;
    setFinishing(true);

    void (async () => {
      // Opens the backend session that the workspace runs on. A failure here is
      // not fatal — the workspace asks for it again on its first denied call.
      await fetch("/auth/backend-session", { method: "POST" }).catch(() => undefined);
      if (cancelled) return;
      router.replace(nextPath);
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [state, nextPath, router]);

  return (
    <AuthShell
      title="Вернитесь к истории продукта"
      subtitle="Войдите, чтобы продолжить работу с релизами, обратной связью и доказательствами."
    >
      <form className="auth-form" action={formAction}>
        <label>
          <span>Email</span>
          <input
            required
            type="email"
            name="email"
            autoComplete="email"
            defaultValue={state.email}
            placeholder="you@company.com"
          />
        </label>
        <label>
          <span>Пароль</span>
          <input
            required
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Введите пароль"
          />
        </label>
        <Link className="text-link align-end" href="/forgot-password">Забыли пароль?</Link>
        <FormFeedback state={state} />
        <SubmitButton pending={pending || finishing}>Войти</SubmitButton>
      </form>
      <p className="legal-copy">
        Продолжая, вы соглашаетесь с обработкой данных, необходимой для безопасной авторизации.
      </p>
      <p className="form-footer">Нет аккаунта? <Link href="/register">Создать аккаунт</Link></p>
    </AuthShell>
  );
}

/**
 * Creating an account. Everything the account needs is collected here — name,
 * address and password — and the address is proved by the emailed link before
 * the account can be used.
 */
export function RegisterForm() {
  const params = useSearchParams();
  const nextPath = getSafeNextPath(params.get("next"));
  const [state, formAction, pending] = useActionState(signUpWithEmail, initialAuthState);
  const submitted = state.status === "success";

  return (
    <AuthShell
      title="Создайте аккаунт Lura"
      subtitle="Укажите рабочий email и пароль. Мы отправим письмо, чтобы подтвердить адрес."
    >
      {submitted ? (
        <ConfirmationSent email={state.email} />
      ) : (
        <form className="auth-form" action={formAction}>
          <input type="hidden" name="next" value={nextPath} />
          <label>
            <span>Имя</span>
            <input
              required
              name="name"
              minLength={NAME_MIN_LENGTH}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="name"
              placeholder="Как к вам обращаться"
            />
          </label>
          <label>
            <span>Email</span>
            <input
              required
              type="email"
              name="email"
              autoComplete="email"
              defaultValue={state.email}
              placeholder="you@company.com"
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              required
              type="password"
              name="password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Повторите пароль</span>
            <input
              required
              type="password"
              name="passwordConfirmation"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
            />
          </label>
          <p className="field-note">{PASSWORD_RULE_HINT}</p>
          <FormFeedback state={state} />
          <SubmitButton pending={pending}>Создать аккаунт</SubmitButton>
        </form>
      )}
      <p className="form-footer">Уже есть аккаунт? <Link href="/login">Войти</Link></p>
    </AuthShell>
  );
}

/** Shown after registration, and on /verify-email for someone who lost the letter. */
export function ConfirmationSent({ email = "" }: { email?: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmationEmail, {
    ...initialAuthState,
    email,
  });

  return (
    <div className="auth-form">
      <p className="form-success" role="status">
        Мы отправили письмо со ссылкой подтверждения{email ? " на " + email : ""}. Перейдите по ней,
        чтобы завершить создание аккаунта.
      </p>
      <p className="field-note">
        Письмо не пришло? Проверьте папку «Спам», затем запросите его повторно.
      </p>
      <form className="auth-form" action={formAction}>
        <label>
          <span>Email</span>
          <input
            required
            type="email"
            name="email"
            autoComplete="email"
            defaultValue={state.email || email}
            placeholder="you@company.com"
          />
        </label>
        <FormFeedback state={state} />
        <SubmitButton pending={pending} variant="button-secondary">Отправить письмо снова</SubmitButton>
      </form>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialAuthState);

  return (
    <AuthShell
      title="Восстановление доступа"
      subtitle="Введите email, и мы отправим ссылку для смены пароля."
    >
      <form className="auth-form" action={formAction}>
        <label>
          <span>Email</span>
          <input
            required
            type="email"
            name="email"
            autoComplete="email"
            defaultValue={state.email}
            placeholder="you@company.com"
          />
        </label>
        <FormFeedback state={state} />
        <SubmitButton pending={pending}>Отправить ссылку</SubmitButton>
      </form>
      <p className="form-footer"><Link href="/login">Назад ко входу</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updatePassword, initialAuthState);
  const changed = state.status === "success";

  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => {
      router.replace("/workspace");
      router.refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [changed, router]);

  return (
    <AuthShell
      title="Новый пароль"
      subtitle="Ссылка из письма подтвердила ваш адрес. Задайте новый пароль для входа."
    >
      <form className="auth-form" action={formAction}>
        <label>
          <span>Новый пароль</span>
          <input
            required
            name="password"
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Повторите пароль</span>
          <input
            required
            name="passwordConfirmation"
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
          />
        </label>
        <p className="field-note">{PASSWORD_RULE_HINT}</p>
        <FormFeedback state={state} />
        <SubmitButton pending={pending || changed}>Сменить пароль</SubmitButton>
      </form>
      <p className="form-footer"><Link href="/login">Назад ко входу</Link></p>
    </AuthShell>
  );
}
