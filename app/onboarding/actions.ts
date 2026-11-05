"use server";
import { identity } from "@/lib/supabase";
import { serviceDb } from "@/lib/service-db";
import { applicationSchema } from "@/lib/clients/rules";
import { credentialReady, encryptCredential } from "@/lib/clients/crypto";
import { redirect } from "next/navigation";
export async function submitApplication(form: FormData) {
  const user = await identity();
  if (!user?.email) redirect("/login");
  const parsed = applicationSchema.safeParse(
    Object.fromEntries(
      [
        "full_name",
        "client_id",
        "phone",
        "mt5_login",
        "server",
        "investor_password",
        "consent",
      ].map((k) => [k, form.get(k)]),
    ),
  );
  let message = "Please check your details and consent before submitting.";
  if (parsed.success && credentialReady()) {
    const { investor_password, ...details } = parsed.data;
    const { error } = await serviceDb().rpc("submit_client_application", {
      owner: user.id,
      details: { ...details, email: user.email },
      encrypted: encryptCredential(investor_password, user.id),
    });
    message = error
      ? "Could not submit. This trading account may already be registered, or your application is already under review."
      : "Application received. Your account is awaiting verification.";
  } else if (!credentialReady())
    message = "Secure registration is being prepared. Please retry later.";
  redirect("/onboarding?message=" + encodeURIComponent(message));
}
