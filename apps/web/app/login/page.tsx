import { Suspense } from "react";

import { GoogleSignIn } from "@/components/google-sign-in";

export default function LoginPage() {
  return <Suspense fallback={null}><GoogleSignIn /></Suspense>;
}
