type VerifiedSession = { role: string; aal: string } | null;
/** Call only with a server-verified identity. Never infer access from email or editable metadata. */
export function sessionDestination(user: VerifiedSession) {
  if (!user) return "/login";
  if (user.role === "admin")
    return user.aal === "aal2" ? "/admin" : "/account/security";
  return "/dashboard";
}
