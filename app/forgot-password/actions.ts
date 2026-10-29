"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabase, isConfigured } from "@/lib/supabase";
import { publicOrigin } from "@/lib/deployment";
export async function requestReset(form: FormData) {
  if (!isConfigured())
    redirect("/forgot-password?message=Recovery+is+not+configured.");
  const email = String(form.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    redirect("/forgot-password?message=Enter+a+valid+email+address.");
  const origin = publicOrigin(process.env, (await headers()).get("origin"));
  const db = await supabase();
  try {
    await db.auth.resetPasswordForEmail(email, {
      redirectTo: origin + "/auth/callback?next=/account/password",
    });
  } catch {
    /* Avoid account enumeration and provider-error disclosure. */
  }
  redirect(
    "/forgot-password?message=" +
      encodeURIComponent(
        "If this address can receive a recovery link, follow it to continue. Retry later if no email arrives.",
      ),
  );
}
