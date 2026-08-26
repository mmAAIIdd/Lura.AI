"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LuraLogo } from "@/components/lura-logo";
import { ApiError, authApi, getLoginPath, type User, type UserSession } from "@/lib/api";

const NAVIGATION = [
  ["/settings/account", "Аккаунт"],
  ["/settings/security", "Безопасность"],
] as const;

export function AccountScreen({ section }: { section: "account" | "security" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [status, setStatus] = useState("Загружаем аккаунт...");
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAccount() {
      try {
        const currentUser = await authApi.getCurrentUser();
        setUser(currentUser);
        if (section === "security") setSessions(await authApi.getSessions());
      } catch (error: unknown) {
        if (error instanceof ApiError && error.status === 401) {
          setStatus("Войдите в аккаунт, чтобы продолжить.");
          router.replace(getLoginPath(pathname));
          return;
        }
        setStatus("Не удалось загрузить аккаунт.");
      }
    }
    void loadAccount();
  }, [pathname, router, section]);

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
    }
  }

  async function revokeSession(session: UserSession) {
    setSessionError(null);
    try {
      await authApi.revokeSession(session.id);
      if (session.current) {
        router.replace("/login");
        return;
      }
      setSessions((currentSessions) => currentSessions.filter(({ id }) => id !== session.id));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Не удалось завершить сессию.");
    }
  }

  if (!user) {
    return (
      <main className="settings-page settings-loading">
        <p>{status} <Link href="/login">Войти</Link></p>
      </main>
    );
  }

  const title = section === "account" ? "Аккаунт" : "Безопасность";

  return (
    <main className="settings-page">
      <header className="settings-header">
        <Link href="/workspace" className="settings-brand" aria-label="Lura — в рабочее пространство">
          <LuraLogo />
          <span>Lura</span>
        </Link>
        <div className="settings-header-actions">
          <Link href="/workspace" className="settings-workspace-link">Рабочее пространство</Link>
          <button className="settings-signout" onClick={logout}>Выйти</button>
        </div>
      </header>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <p>Настройки</p>
          <nav aria-label="Настройки аккаунта">
            {NAVIGATION.map(([href, label]) => (
              <Link key={href} href={href} className={pathname === href ? "is-active" : undefined}>{label}</Link>
            ))}
          </nav>
        </aside>

        <section className="settings-content">
          <p className="settings-kicker">Lura</p>
          <h1>{title}</h1>

          {section === "account" && (
            <dl className="settings-details">
              <div><dt>Имя</dt><dd>{user.name}</dd></div>
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Роль</dt><dd>{user.role}</dd></div>
            </dl>
          )}

          {section === "security" && (
            <>
              <p className="settings-intro">
                Аккаунт использует серверные сессии. Завершите любую сессию, которую не узнаёте.
              </p>
              {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
              <div className="settings-sessions">
                {sessions.map((session) => (
                  <article className="settings-session" key={session.id}>
                    <div>
                      <strong>{session.current ? "Это устройство" : "Активная сессия"}</strong>
                      <p>{session.user_agent ?? "Неизвестный браузер"}</p>
                      <small>Последняя активность: {new Date(session.last_used_at).toLocaleString("ru-RU")}</small>
                    </div>
                    <button className="settings-revoke" onClick={() => void revokeSession(session)}>
                      {session.current ? "Выйти" : "Завершить"}
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
