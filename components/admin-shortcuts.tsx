import Link from "next/link";
import { ownerAdminNavigation } from "@/lib/admin-navigation";

export default function AdminShortcuts({
  user,
}: {
  user: { role: string; email?: string } | null;
}) {
  if (!ownerAdminNavigation(user)) return null;
  return (
    <nav
      aria-label="Administrator shortcuts"
      className="settings-actions"
      style={{ marginBlock: 20 }}
    >
      <Link href="/admin" className="secondary-button">
        Admin panel
      </Link>
      <Link href="/admin/performance" className="secondary-button">
        Performance statistics
      </Link>
      <Link href="/admin/clients" className="secondary-button">
        Client directory
      </Link>
    </nav>
  );
}
