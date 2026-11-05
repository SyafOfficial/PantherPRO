import "server-only";
import { supabase } from "@/lib/supabase";
export async function clientAccessAllowed() {
  const { data, error } = await (await supabase()).rpc("client_access_allowed");
  if (error)
    throw Error("Client access verification unavailable. Please retry.");
  return data === true;
}
