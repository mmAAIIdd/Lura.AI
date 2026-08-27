import Link from "next/link";
import type { ReactNode } from "react";

import { Brand, SectionHeader } from "@/components/sections/section-header";
import { SECTIONS } from "@/lib/sections";

import "./sections.css";

/**
 * Каркас публичных разделов.
 *
 * Лендинга у сайта нет: корень ведёт на регистрацию, а разделы — это то, что
 * открывается из её шапки. Поэтому каркас общий с регистрацией по смыслу, но
 * отдельный по вёрстке: там одна колонка с кнопкой, здесь длинный текст.
 */
export default function SectionsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell public-site">
      <SectionHeader />

      <main className="flex-1">{children}</main>

      <footer className="public-footer">
        <div className="site-container public-footer-main">
          <div>
            <Brand />
            <p>Lura связывает релизы, обратную связь и метрики в проверяемую историю продукта.</p>
          </div>
          <div className="public-footer-links">
            {SECTIONS.map(({ href, label }) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="public-footer-note">© 2026 Lura. Факты и гипотезы в выводах разделены.</div>
      </footer>
    </div>
  );
}
