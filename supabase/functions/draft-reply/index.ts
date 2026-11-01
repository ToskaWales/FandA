// supabase/functions/draft-reply/index.ts   (Deploy: supabase functions deploy draft-reply --no-verify-jwt; Login-Prüfung unten)
// Body: { comment_text: string, group_post_id?: uuid }  ->  { id, draft }
// Es wird NICHTS auf Facebook gepostet. Der Mensch kopiert den Entwurf und postet selbst.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PROMPT_REPLY } from "./prompts.ts";    // Text steht in Abschnitt 8.3

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";   // Standard; per Secret AI_MODEL überschreibbar

const redact = (t: string) =>   // Kontaktdaten gehen nie an die KI
  t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[E-Mail]").replace(/\+?\d[\d\s\/().-]{6,}\d/g, "[Telefon]").slice(0, 1500);

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
  const auth = req.headers.get("Authorization") ?? "";
  // Client mit dem JWT des Nutzers: Row Level Security gilt, der Nutzer kann nur für sich selbst speichern.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: me } = await sb.rpc("current_profile_id");
  if (!me) return out("unauthorized", 401);

  const { comment_text, group_post_id } = await req.json();
  if (typeof comment_text !== "string" || !comment_text.trim()) return out("comment_text fehlt", 400);

  let postText = "";
  if (group_post_id) {
    const { data: gp } = await sb.from("group_posts").select("post_text").eq("id", group_post_id).maybeSingle();
    postText = gp?.post_text ?? "";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 500, system: PROMPT_REPLY,
      messages: [{ role: "user", content: `Mein Beitrag in der Gruppe:\n${redact(postText)}\n\nKommentar der Person:\n${redact(comment_text)}` }],
    }),
  });
  const j = await res.json();
  if (!res.ok) return out("KI-Fehler: " + (j?.error?.message ?? res.status), 502);
  const draft: string = j.content?.[0]?.text ?? "";

  const { data, error } = await sb.from("reply_drafts").insert({
    recruiter_id: me, group_post_id: group_post_id ?? null, comment_text: redact(comment_text),
    ai_draft: draft, model: MODEL,
  }).select("id").single();
  if (error) return out(error.message, 500);
  return Response.json({ id: data.id, draft }, { headers: cors });
});
