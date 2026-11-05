"use server";
import { identity, supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
export async function setGate(form: FormData) {
  const user = await identity();
  if (user?.role !== "admin" || user.aal !== "aal2")
    redirect("/account/security");
  const { error } = await (
    await supabase()
  ).rpc("set_client_gate", { enabled: form.get("enabled") === "true" });
  redirect(
    "/admin/clients?message=" +
      encodeURIComponent(
        error
          ? "A recently verified client account is required before enforcing onboarding."
          : "Access policy updated.",
      ),
  );
}
