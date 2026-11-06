"use server";
import { sessionDestination } from "@/lib/session-destination";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/deployment";
import { authFailureMessage } from "@/lib/auth-messages";
import { redirect } from "next/navigation";
import { identity } from "@/lib/supabase";
import { supabase, isConfigured } from "@/lib/supabase";
const message = (text: string): never =>
  redirect("/login?message=" + encodeURIComponent(text));
export async function authenticate(form: FormData) {
  if (!isConfigured())
    message(
      "Authentication is not connected. Configure Supabase to create or access an account.",
    );
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 ||
    password.length > 128
  )
    message("Use a valid email and a password between 12 and 128 characters.");
  const db = await supabase();
  if (form.get("mode") === "signup") {
    const name = String(form.get("name") ?? "")
      .trim()
      .slice(0, 60);
    const { error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name || "Member" },
        emailRedirectTo:
          publicOrigin(process.env, (await headers()).get("origin")) +
          "/auth/callback",
      },
    });
    if (error) message(authFailureMessage(error, "signup"));
    message(
      "If this address is new, check Inbox and Spam/Junk for confirmation. Already registered? Sign in instead. If no email arrives, use Resend confirmation below.",
    );
  }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) message(authFailureMessage(error, "login"));
  const user = await identity();
  redirect(sessionDestination(user));
}
export async function signOut() {
  if (isConfigured()) {
    const db = await supabase();
    await db.auth.signOut();
  }
  redirect("/");
}

export async function resendConfirmation(form: FormData) {
  if (!isConfigured()) message("Email confirmation is not configured.");
  const email = String(form.get("email") ?? "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    message("Enter a valid email address.");
  const db = await supabase();
  const { error } = await db.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo:
        publicOrigin(process.env, (await headers()).get("origin")) +
        "/auth/callback",
    },
  });
  if (error) message(authFailureMessage(error, "resend"));
  message(
    "If this address needs confirmation, a new email has been requested. Check Inbox and Spam/Junk. Wait at least 60 seconds before requesting again; a request does not guarantee inbox delivery.",
  );
}
