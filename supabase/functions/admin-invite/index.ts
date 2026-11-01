// supabase/functions/admin-invite/index.ts   (Deploy mit --no-verify-jwt; die Prüfung "ist Admin" passiert unten selbst)
// Warum --no-verify-jwt: Der CORS-Preflight (OPTIONS) des Browsers trägt kein Token und muss durchkommen.
// Body: { profile_id: uuid } -> lädt die Person per E-Mail ein und verknüpft Login und Profil.
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const corsFor = (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
};

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const out = (body: string, status: number) => new Response(body, { status, headers: cors });
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: isAdmin } = await user.rpc("is_admin");
  if (isAdmin !== true) return out("forbidden", 403);

  const { profile_id } = await req.json();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: p } = await admin.from("profiles").select("id,email,auth_user_id").eq("id", profile_id).single();
  if (!p?.email) return out("Profil ohne E-Mail", 400);
  if (p.auth_user_id) return out("Login existiert schon", 409);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(p.email, { redirectTo: Deno.env.get("INVITE_REDIRECT_URL") });
  if (error) return out(error.message, 400);
  await admin.from("profiles").update({ auth_user_id: data.user.id }).eq("id", p.id);
  return Response.json({ ok: true }, { headers: cors });
});
