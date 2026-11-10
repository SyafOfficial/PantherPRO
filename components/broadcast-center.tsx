"use client";
import { useState } from "react";
import { publishAnnouncement } from "@/app/admin/actions";

export default function BroadcastCenter({ disabled = false }: { disabled?: boolean }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [access, setAccess] = useState("public");
  const [preview, setPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const valid = title.trim().length > 0 && title.length <= 150 && body.trim().length > 0 && body.length <= 5000;
  return (
    <section className="panel content-panel" id="broadcast-center">
      <div className="eyebrow">PANTHER FX · BROADCAST CENTER</div>
      <h2>Send a community announcement</h2>
      <p>Compose a message, preview it, then confirm publishing to opted-in members.</p>
      <form action={publishAnnouncement} className="form" onSubmit={(event) => {
        if (!valid || !confirmed || !window.confirm("Publish this announcement and queue push notifications?")) event.preventDefault();
      }}>
        <label>Notification title
          <input name="title" value={title} onChange={(event) => { setTitle(event.target.value); setConfirmed(false); }} required maxLength={150} disabled={disabled} />
        </label>
        <label>Announcement message
          <textarea name="body" value={body} onChange={(event) => { setBody(event.target.value); setConfirmed(false); }} required maxLength={5000} rows={5} disabled={disabled} />
        </label>
        <label>Audience
          <select name="access" value={access} onChange={(event) => { setAccess(event.target.value); setConfirmed(false); }} disabled={disabled}>
            <option value="public">Public audience (includes eligible VIP members)</option>
            <option value="vip">VIP members only</option>
          </select>
        </label>
        <button type="button" className="secondary-button" disabled={!valid || disabled} onClick={() => setPreview(!preview)}>
          {preview ? "Hide preview" : "Preview notification"}
        </button>
        {preview && <div className="panel" role="status" aria-label="Notification preview" style={{ padding: "1rem", overflowWrap: "anywhere" }}>
          <div className="eyebrow">PANTHER FX · PREVIEW</div>
          <strong>{title || "Notification title"}</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{body || "Your announcement will appear here."}</p>
          <small>Push display may vary by device. Current worker uses a generic push summary.</small>
        </div>}
        <label style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!valid || disabled} />
          I have reviewed the message and audience.
        </label>
        <button className="primary-button" disabled={disabled || !valid || !confirmed}>Publish & queue notifications</button>
        <small>Announcements are saved and eligible opted-in subscriptions are queued. Push-service acceptance does not guarantee device display.</small>
      </form>
    </section>
  );
}
