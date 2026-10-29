import Link from "next/link";
import NotificationSettings from "@/components/notification-settings";
import { identity, isConfigured, supabase } from "@/lib/supabase";
export const dynamic = "force-dynamic";
export default async function Account() {
  const user = await identity();
  const db = user ? await supabase() : null;
  const announcements = db
    ? (
        await db
          .from("announcements")
          .select("id,title,body,access,published_at")
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(20)
      ).data
    : [];
  const preferences = db
    ? (
        await db
          .from("notification_preferences")
          .select("signals,targets,news,announcements,push_enabled")
          .eq("user_id", user!.id)
          .maybeSingle()
      ).data
    : null;
  return (
    <main className="account-page">
      <Link href="/" className="text-button">
        ← Return to terminal
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
          <h1>Profile & notifications</h1>
          <p>
            {user
              ? `${user.name} · ${user.email}`
              : "Demo preview · sign in to a configured workspace to make changes."}
          </p>
        </div>
        <Link href="/login" className="secondary-button">
          {user ? "Account & sign out" : "Sign in"}
        </Link>
      </div>
      <Link
        href="/install"
        className="secondary-button"
        style={{ marginBottom: 20 }}
      >
        Install on your phone · setup guide →
      </Link>
      <div className="settings-actions" style={{ marginBottom: 20 }}>
        <Link href="/account/security" className="secondary-button">
          Two-factor authentication
        </Link>
        <Link href="/account/password" className="secondary-button">
          Change password
        </Link>
      </div>
      <NotificationSettings
        initial={preferences}
        enabled={Boolean(user && isConfigured())}
      />
      <section id="announcements" className="panel content-panel">
        <h2>Member announcements</h2>
        {!announcements?.length && (
          <p>No announcements available for your account.</p>
        )}
        {announcements?.map((a) => (
          <article className="announcement-item" key={a.id}>
            <h3>
              {a.title} <span className="outline-tag">{a.access}</span>
            </h3>
            <p>{a.body}</p>
            <small>
              {new Intl.DateTimeFormat("en-MY", {
                timeZone: "Asia/Kuala_Lumpur",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(a.published_at))}{" "}
              MYT
            </small>
          </article>
        ))}
      </section>
    </main>
  );
}
