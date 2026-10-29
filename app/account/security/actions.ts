"use server";
import { identity, supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export type EnrollmentState = {
  error?: string;
  factorId?: string;
  qrCode?: string;
  secret?: string;
};
async function ownSession() {
  const user = await identity();
  if (!user) throw new Error("Sign in required");
  return { user, db: await supabase() };
}
export async function enrollTotp(
  previous: EnrollmentState,
  form: FormData,
): Promise<EnrollmentState> {
  void previous;
  void form;
  const { user, db } = await ownSession();
  const { data: factors, error: factorError } = await db.auth.mfa.listFactors();
  if (factorError) return { error: "Factors could not be loaded." };
  if (factors.totp.some((f) => f.status === "verified") && user.aal !== "aal2")
    return { error: "Verify an existing factor before adding another." };
  if (
    factors.all.some(
      (f) => f.factor_type === "totp" && f.status === "unverified",
    )
  )
    return {
      error: "Remove the unfinished factor before starting a new enrollment.",
    };
  const { data, error } = await db.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Panther FX authenticator",
  });
  if (error)
    return { error: "Enrollment could not be started. Try again later." };
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}
export async function verifyTotp(form: FormData) {
  const { db } = await ownSession();
  const factorId = String(form.get("factor_id") ?? ""),
    code = String(form.get("code") ?? "");
  if (!/^[0-9]{6}$/.test(code))
    redirect("/account/security?message=Enter+a+six-digit+authenticator+code.");
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code });
  if (error)
    redirect(
      "/account/security?message=Verification+failed.+Check+the+code+and+device+clock.",
    );
  revalidatePath("/admin");
  redirect(
    "/account/security?message=Authenticator+verified.+Your+session+has+been+upgraded.",
  );
}
export async function removeTotp(form: FormData) {
  const { user, db } = await ownSession();
  const factorId = String(form.get("factor_id") ?? "");
  const { data } = await db.auth.mfa.listFactors();
  const factor = data?.all.find(
    (f) => f.factor_type === "totp" && f.id === factorId,
  );
  if (!factor || (factor.status === "verified" && user.aal !== "aal2"))
    redirect(
      "/account/security?message=Verify+your+authenticator+before+removing+a+verified+factor.",
    );
  const { error } = await db.auth.mfa.unenroll({ factorId });
  redirect(
    "/account/security?message=" +
      encodeURIComponent(
        error
          ? "Factor could not be removed."
          : "Factor removed. Administrators must enroll and verify a factor before using admin tools.",
      ),
  );
}
