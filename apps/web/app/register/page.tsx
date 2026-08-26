import { Suspense } from "react";

import { GoogleSignIn } from "@/components/google-sign-in";

export default function RegisterPage() {
  return <Suspense fallback={null}><GoogleSignIn mode="register" /></Suspense>;
}
