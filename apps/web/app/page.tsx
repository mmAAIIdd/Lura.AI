import { redirect } from "next/navigation";

/* Лендинга нет: первая страница Lura — регистрация через Google. Для уже
   вошедшего посетителя middleware разворачивает /register в /workspace, так
   что отдельная развилка здесь не нужна. */
export default function Home() {
  redirect("/register");
}
