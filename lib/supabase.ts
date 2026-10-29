import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export function isConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
export async function supabase() {
  if (!isConfigured())
    throw new Error("Supabase is not configured. Demo is read-only.");
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            /* Server components cannot write cookies; proxy refreshes them. */
          }
        },
      },
    },
  );
}
export async function identity() {
  if (!isConfigured()) return null;
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db
    .from("profiles")
    .select("role,display_name")
    .eq("id", user.id)
    .single();
  const assurance = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    aal: assurance.data?.currentLevel ?? "aal1",
    id: user.id,
    email: user.email,
    role: data?.role ?? "public",
    name: data?.display_name ?? "Member",
  };
}
