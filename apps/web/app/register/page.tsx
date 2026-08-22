import { redirect } from "next/navigation";

/**
 * Google is the only provider, and a first sign-in already creates the account,
 * so there is nothing for a separate registration screen to do. The route stays
 * because the marketing site links to it.
 */
export default function RegisterPage() {
  redirect("/login");
}
