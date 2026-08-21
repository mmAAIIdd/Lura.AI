import { Suspense } from "react";

import { RegisterForm } from "@/components/auth-forms";

export default function RegisterPage() {
  return <Suspense fallback={null}><RegisterForm /></Suspense>;
}
