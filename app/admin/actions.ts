"use server";
import { identity, supabase } from "@/lib/supabase";
import { signalSchema } from "@/lib/signals";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
async function admin() {
  const user = await identity();
  if (user?.role !== "admin" || user.aal !== "aal2")
    throw new Error("Administrator access required");
  return supabase();
}
function result(error: boolean) {
  revalidatePath("/");
  revalidatePath("/admin");
  redirect(
    "/admin?message=" +
      encodeURIComponent(
        error
          ? "Operation rejected. Check validation, current state and audit logs."
          : "Change saved.",
      ),
  );
}
export async function createSignal(form: FormData) {
  const db = await admin();
  const parsed = signalSchema.safeParse({
    instrument: "XAUUSD",
    strategy: form.get("strategy") || null,
    timeframe: form.get("timeframe") || null,
    higher_timeframe: form.get("higher_timeframe") || null,
    direction: form.get("direction"),
    entry: Number(form.get("entry")),
    stop_loss: Number(form.get("stop_loss")),
    tp1: Number(form.get("tp1")),
    tp2: Number(form.get("tp2")),
    tp3: Number(form.get("tp3")),
    reasoning: form.get("reasoning"),
    access: form.get("access"),
  });
  if (!parsed.success) result(true);
  const { error } = await db
    .from("signals")
    .insert({ ...parsed.data, source: "manual", status: "draft" });
  result(Boolean(error));
}
export async function transitionSignal(form: FormData) {
  const db = await admin();
  const { error } = await db.rpc("transition_signal", {
    signal_id: String(form.get("id")),
    next_status: String(form.get("status")),
  });
  result(Boolean(error));
}
export async function changeMemberRole(form: FormData) {
  const db = await admin();
  const role = String(form.get("role"));
  if (!["public", "vip"].includes(role)) result(true);
  const { error } = await db.rpc("set_member_role", {
    member_id: String(form.get("id")),
    new_role: role,
  });
  result(Boolean(error));
}
export async function reviseSignal(form: FormData) {
  const db = await admin();
  const parsed = signalSchema.safeParse({
    instrument: "XAUUSD",
    strategy: form.get("strategy") || null,
    timeframe: form.get("timeframe") || null,
    higher_timeframe: form.get("higher_timeframe") || null,
    direction: form.get("direction"),
    entry: Number(form.get("entry")),
    stop_loss: Number(form.get("stop_loss")),
    tp1: Number(form.get("tp1")),
    tp2: Number(form.get("tp2")),
    tp3: Number(form.get("tp3")),
    reasoning: form.get("reasoning"),
    access: form.get("access"),
  });
  const version = Number(form.get("version")),
    reason = String(form.get("revision_reason") ?? "").trim();
  if (
    !parsed.success ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    reason.length < 10 ||
    reason.length > 500
  )
    result(true);
  const { error } = await db.rpc("revise_signal", {
    signal_id: String(form.get("id")),
    expected_version: version,
    changes: parsed.data,
    revision_reason: reason,
  });
  result(Boolean(error));
}
export async function publishAnnouncement(form: FormData) {
  const db = await admin();
  const title = String(form.get("title") ?? "").trim(),
    body = String(form.get("body") ?? "").trim(),
    access = String(form.get("access") ?? "");
  if (
    !title ||
    title.length > 150 ||
    !body ||
    body.length > 5000 ||
    !["public", "vip"].includes(access)
  )
    result(true);
  const { error } = await db.rpc("publish_announcement", {
    heading: title,
    content: body,
    audience: access,
  });
  result(Boolean(error));
}

export async function startObservation(form: FormData) {
  const db = await admin();
  const { error } = await db.rpc("start_signal_observation", {
    signal_id: String(form.get("id")),
    quote_id: String(form.get("quote_id")),
  });
  result(Boolean(error));
}

export async function setAutomaticEngine(form: FormData) {
  const db = await admin();
  const { error } = await db.rpc("set_automatic_engine", {
    enabled_value: form.get("enabled") === "true",
  });
  result(Boolean(error));
}
