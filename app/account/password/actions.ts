"use server";
import { redirect } from "next/navigation";
import { identity, supabase } from "@/lib/supabase";
export async function updatePassword(form: FormData) {
  const user = await identity();
  if (!user) redirect("/login");
  if (user.role === "admin" && user.aal !== "aal2")
    redirect("/account/security");
  const password = String(form.get("password") ?? ""),
    confirm = String(form.get("confirm") ?? "");
  if (password.length < 12 || password.length > 128 || password !== confirm)
    redirect(
      "/account/password?message=Use+matching+passwords+between+12+and+128+characters.",
    );
  const db = await supabase();
  const { error } = await db.auth.updateUser({ password });
  if (error)
    redirect(
      "/account/password?message=Password+could+not+be+updated.+Sign+in+again+and+complete+any+required+verification.",
    );
  await db.auth.signOut({ scope: "others" });
  redirect(
    "/account/password?message=Password+updated.+Other+sessions+were+requested+to+sign+out.",
  );
}
