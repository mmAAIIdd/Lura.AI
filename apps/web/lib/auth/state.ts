/** Shared shape for every auth form driven by `useActionState`. */
export type AuthActionState = {
  status: "idle" | "error" | "success";
  message: string | null;
  /** Echoed back so a failed submit does not clear what was typed. */
  email: string;
};

export const initialAuthState: AuthActionState = { status: "idle", message: null, email: "" };

export function authError(message: string, email = ""): AuthActionState {
  return { status: "error", message, email };
}

export function authSuccess(message: string | null, email = ""): AuthActionState {
  return { status: "success", message, email };
}
