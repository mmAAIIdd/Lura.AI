"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ApiError, authApi, getLoginPath, type User, type UserSession } from "@/lib/api";

export function AccountScreen({ section }: { section: "account" | "security" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [status, setStatus] = useState("Loading your workspace...");
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
      setSessionError(error instanceof Error ? error.message : "Unable to revoke the session.");
    }
  }

  if (!user) {
    return <main className="app-shell"><p className="status-message">{status} <Link href="/login">Sign in</Link></p></main>;
  }

  const title = section === "account" ? "Аккаунт" : "Безопасность";
  return (
    <main className="app-shell">
      <header className="app-header"><Link href="/workspace" className="brand"><span className="brand-mark">L</span>Lura</Link><button className="button button-quiet" onClick={logout}>Sign out</button></header>
      <div className="app-layout">
        <nav className="app-nav" aria-label="Account navigation"><Link href="/workspace">Рабочее пространство</Link><Link href="/settings/account">Аккаунт</Link><Link href="/settings/security">Безопасность</Link></nav>
        <section className="content-panel">
          <p className="eyebrow">{title}</p>
          <h1>{title}</h1>
          {section === "account" && <dl className="detail-list"><div><dt>Name</dt><dd>{user.name}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd>{user.role}</dd></div></dl>}
          {section === "security" && <>
            <p>Your account uses server-side sessions. Resetting your password revokes all other active sessions.</p>
            {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
            <div className="session-list">
              {sessions.map((session) => (
                <article className="session-row" key={session.id}>
                  <div>
                    <strong>{session.current ? "This device" : "Active session"}</strong>
                    <p>{session.user_agent ?? "Unknown browser"}</p>
                    <small>Last used {new Date(session.last_used_at).toLocaleString()}</small>
                  </div>
                  <button className="button button-danger" onClick={() => void revokeSession(session)}>
                    {session.current ? "Sign out" : "Revoke"}
                  </button>
                </article>
              ))}
            </div>
          </>}
        </section>
      </div>
    </main>
  );
}
