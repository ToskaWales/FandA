// supabase/functions/submit-lead/index.ts   (Deploy mit --no-verify-jwt: öffentliches Formular)
// Secrets: ALLOWED_ORIGINS="https://deine-domain.de,https://www.deine-domain.de"
//          TURNSTILE_SECRET (Cloudflare Turnstile gegen Bots; vor dem Livegang setzen)
//          META_SYSTEM_TOKEN, META_AD_ACCOUNT_ID, META_GRAPH_VERSION (dieselben wie beim Sync; prüfen, ob eine Ad-ID wirklich zu UNSEREM Werbekonto gehört)
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// CORS: Browser-Aufrufe (auch supabase.functions.invoke) schicken authorization, apikey, x-client-info mit.
const corsFor = (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0] ?? "",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
};
const SRC_MAP: Record<string, string> = { fbgroup: "facebook_group", indeed: "indeed" }; // alles andere = website
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
const MTOKEN = Deno.env.get("META_SYSTEM_TOKEN");
const ACCOUNT = (Deno.env.get("META_AD_ACCOUNT_ID") ?? "").replace(/^act_/, "");
const FLOOD_MAX_PER_10_MIN = 100;   // Notbremse: mehr neue Leads in 10 Minuten sind für dieses Projekt unrealistisch

// Ad-ID aus dem Link: nur übernehmen, wenn die Ad bekannt ist ODER Meta bestätigt, dass sie zu unserem Werbekonto gehört.
// Erfundene oder fremde IDs erzeugen so weder eine Ad-Zeile noch eine Zuordnung (der Lead bleibt ein normaler Website-Lead).
async function resolveMetaAd(metaAd: string): Promise<string | null> {
  const { data: known } = await sb.from("ads").select("id").eq("meta_ad_id", metaAd).maybeSingle();
  if (known) return known.id;
  if (!MTOKEN || !ACCOUNT) return null;
  try {
    const r = await fetch(`${GRAPH}/${metaAd}?fields=id,name,adset_id,campaign_id,account_id`, { headers: { Authorization: `Bearer ${MTOKEN}` } });
    if (!r.ok) return null;
    const j = await r.json();
    if (String(j.account_id) !== ACCOUNT) return null;                  // fremdes Werbekonto
    // Der Datenbank-Trigger füllt Recruiter/Creator per Namensregel [ref:..] [cr:..] oder erbt sie von Schwester-Ads.
    await sb.from("ads").upsert({ meta_ad_id: String(j.id), name: j.name ?? null, meta_adset_id: j.adset_id ?? null, meta_campaign_id: j.campaign_id ?? null },
      { onConflict: "meta_ad_id", ignoreDuplicates: true });
    const { data: ad } = await sb.from("ads").select("id").eq("meta_ad_id", String(j.id)).maybeSingle();
    return ad?.id ?? null;
  } catch { return null; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
// Weitere Formularantworten (z. B. Vertriebserfahrung): nur flache Text-Paare, begrenzt, damit niemand beliebige Daten ablegt.
const extraFields = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, val] of Object.entries(v).slice(0, 20)) {
    const key = clip(k, 60), txt = clip(val, 2000);
    if (key && txt) out[key] = txt;
  }
  return out;
};

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (obj: unknown, status = 200) => Response.json(obj, { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply({ error: "bad_json" }, 400); }

  if (b.company) return reply({ ok: true });                      // Honeypot-Feld: Bots füllen es aus, Menschen sehen es nicht
  if (b.consent !== true) return reply({ error: "consent_required" }, 400);
  const email = clip(b.email, 200)?.toLowerCase() ?? null;
  const phone = clip(b.phone, 40);
  if (!email && !phone) return reply({ error: "contact_required" }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: "email_invalid" }, 400);

  const ts = Deno.env.get("TURNSTILE_SECRET");
  if (ts) {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: new URLSearchParams({ secret: ts, response: String(b.turnstile_token ?? "") }),
    });
    if (!(await r.json()).success) return reply({ error: "captcha" }, 400);
  }

  // Partner-Anfrage von bAV-Vermittlern (index.html): kein Bewerber, darum eigene Tabelle statt leads (siehe 000150_migrate_legacy.sql).
  if (b.kind === "partner") {
    const name = clip(b.name, 200);
    if (!name) return reply({ error: "name_required" }, 400);
    const { error } = await sb.from("partner_requests").insert({
      name, email, phone, company: clip(b.firma, 200), message: clip(b.message, 4000), data: extraFields(b.data),
    });
    if (error) { console.error("partner", error.message); return reply({ error: "server" }, 500); }
    return reply({ ok: true });
  }

  // Notbremse gegen Flutung (zusätzlich zu Turnstile): zu viele neue Leads in kurzer Zeit -> 429, der Besucher kann es später nochmal versuchen.
  {
    const { data: n } = await sb.rpc("recent_lead_count", { p_minutes: 10 });
    if (typeof n === "number" && n > FLOOD_MAX_PER_10_MIN) return reply({ error: "busy" }, 429);
  }

  // Gleiche E-Mail ODER Telefonnummer in den letzten 24 h? Dann nicht doppelt anlegen (Doppelklick, Spam).
  // Die Prüfung läuft in der Datenbank (recent_duplicate_lead), damit die Telefonnummer gleich normalisiert wird wie beim Speichern.
  {
    const { data: isDup, error: dupErr } = await sb.rpc("recent_duplicate_lead", { p_email: email, p_phone: phone, p_hours: 24 });
    if (dupErr) console.error("dup-check", dupErr.message);   // Prüfung fehlgeschlagen: lieber einen Lead zu viel als einen verlieren
    else if (isDup) {
      // Kein zweiter Lead, aber auch nicht spurlos verschwinden: Der zweite Versuch wird im Verlauf des bestehenden Leads vermerkt
      // (mit ref/src/ad_id) und kann einen noch OFFENEN Lead dem Recruiter des neuen Links zuteilen.
      const { error: rErr } = await sb.rpc("note_repeat_submission", {
        p_email: email, p_phone: phone, p_ref: clip(b.ref, 40), p_src: clip(b.src, 40), p_ad_id: clip(b.ad_id, 40), p_hours: 24,
      });
      if (rErr) console.error("repeat-note", rErr.message);
      return reply({ ok: true });
    }
  }

  // Tracking: ref (Recruiter), src (Kanal), post (Gruppen-Post)
  let ref = clip(b.ref, 40)?.toLowerCase() ?? null;
  const postId = typeof b.post === "string" && UUID.test(b.post) ? b.post : null;
  let groupPostId: string | null = null;
  if (postId) {
    const { data: gp } = await sb.from("group_posts").select("id, recruiter:profiles(ref_code)").eq("id", postId).maybeSingle();
    if (gp) { groupPostId = gp.id; ref = ref ?? (gp as any).recruiter?.ref_code ?? null; }
  }

  // Optional: Website-Anzeige mit {{ad.id}} in der URL -> Lead der Ad (und damit dem Creator) zuordnen.
  // Ist die Ad im CRM noch unbekannt (Anzeige ist heute erst gestartet), fragt resolveMetaAd bei Meta nach, ob sie zu unserem Werbekonto gehört.
  // Die rohe Meta-ID steht zusätzlich immer am Lead (meta_ad_id_raw), damit nichts verloren geht.
  // Unbestätigte IDs (erfunden, fremd, Meta nicht erreichbar) legen keine Ad an; der Lead bleibt ein normaler Website-Lead und der Admin sieht die Roh-ID.
  let adId: string | null = null;
  const rawAd = clip(b.ad_id, 40);
  const metaAd = rawAd && /^\d{5,30}$/.test(rawAd) ? rawAd : null;
  if (metaAd) adId = await resolveMetaAd(metaAd);

  const row: Record<string, unknown> = {
    first_name: clip(b.first_name, 80), last_name: clip(b.last_name, 80), email, phone,
    extra: { ...extraFields(b.data), ...(clip(b.message, 4000) ? { message: clip(b.message, 4000) } : {}) },
    source: adId ? "meta_ad" : SRC_MAP[String(b.src ?? "")] ?? "website",
    ref_code: ref, ad_id: adId, meta_ad_id_raw: rawAd,
    utm_source: clip(b.utm_source, 80), utm_medium: clip(b.utm_medium, 80), utm_campaign: clip(b.utm_campaign, 120),
    consent_at: new Date().toISOString(),
  };
  if (groupPostId) row.group_post_id = groupPostId;   // Spalte kommt erst mit 004_groups.sql
  const { error } = await sb.from("leads").insert(row);
  if (error) { console.error("submit-lead", error.message); return reply({ error: "server" }, 500); }
  return reply({ ok: true });     // Die Zuteilung zum Recruiter macht der Datenbank-Trigger.
});
