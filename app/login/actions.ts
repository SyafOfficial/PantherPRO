"use server";
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
      options: { data: { display_name: name || "Member" } },
    });
    if (error)
      message(
        "Unable to create an account. Try again later or contact support.",
      );
    message("Check your email to confirm your account, then sign in.");
  }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error)
    message(
      "Unable to sign in. Check your credentials and email confirmation, or try again later.",
    );
  const user = await identity();
  if (user?.role === "admin") redirect("/account/security");
  redirect("/");
}
export async function signOut() {
  if (isConfigured()) {
    const db = await supabase();
    await db.auth.signOut();
  }
  redirect("/");
}
