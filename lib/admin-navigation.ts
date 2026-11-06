type NavigationIdentity = { role: string; email?: string } | null;

/** Navigation visibility only. Admin routes still verify the session, role and MFA. */
export function ownerAdminNavigation(user: NavigationIdentity) {
  return (
    user?.role === "admin" &&
    user.email?.trim().toLowerCase() === "apitimran2@gmail.com"
  );
}
