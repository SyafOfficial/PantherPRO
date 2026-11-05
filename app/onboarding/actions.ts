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

export async function updateConnection(form: FormData) {
  const user = await identity();
  if (!user) redirect("/login");
  const revision = String(form.get("revision") ?? "");
  const password = String(form.get("investor_password") ?? "");
  const confirmation = String(form.get("confirm_password") ?? "");
  let message =
    "Please enter matching investor passwords and reload this page.";
  if (
    /^[a-f0-9-]{36}$/i.test(revision) &&
    password.length >= 1 &&
    password.length <= 128 &&
    password === confirmation &&
    credentialReady()
  ) {
    const { data, error } = await serviceDb().rpc("update_client_connection", {
      owner: user.id,
      expected_revision: revision,
      server_name: "Vestrado-Server",
      encrypted: encryptCredential(password, user.id),
    });
    message =
      !error && data === true
        ? "Investor connection updated. Verification will retry when the monitor is running."
        : "Could not update. Reload the page and retry, or contact the administrator.";
  }
  redirect("/onboarding?message=" + encodeURIComponent(message));
}
