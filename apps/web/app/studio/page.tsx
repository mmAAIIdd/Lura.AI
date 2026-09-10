import type { Metadata } from "next";

import { StudioScreen } from "@/components/studio/studio-screen";

import "./studio.css";
import "./explorer.css";

export const metadata: Metadata = {
  title: "Lura — рабочее пространство",
  description: "Разбор релизов, отзывов и метрик агентом Lura.",
};

/* Страница целиком занимает экран и не прокручивается: прокручиваются панели
   внутри. Иначе командная строка уезжает вниз вместе с длинным отчётом. */
export default function StudioPage() {
  return <StudioScreen />;
}
