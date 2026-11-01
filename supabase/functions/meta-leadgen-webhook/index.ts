// supabase/functions/meta-leadgen-webhook/index.ts
// Deploy:  supabase functions deploy meta-leadgen-webhook --no-verify-jwt
// (Meta schickt keinen Supabase-JWT. Geschützt wird über Verify-Token und Signatur.)
//
// Secrets (supabase secrets set ...):
//   META_APP_SECRET        App-Geheimnis der Meta-App (für Signatur und appsecret_proof)
//   META_VERIFY_TOKEN      frei gewählter Text, derselbe wie im Meta-Dashboard beim Webhook
//   META_PAGE_TOKENS       JSON: {"<page_id>":"<page access token>"}  (oder META_PAGE_TOKEN für nur eine Seite)
//   META_GRAPH_VERSION     optional, Standard v23.0 (aktuelle Version in der Meta-Doku prüfen)
//   CRON_SECRET            für den Wiederholungslauf (?retry=1)
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
const MAX_ATTEMPTS = 8;

const sb: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------- Hilfsfunktionen ----------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256Hex(key: string, data: Uint8Array | string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function pageToken(pageId?: string): string | undefined {
  try {
    const map = JSON.parse(Deno.env.get("META_PAGE_TOKENS") ?? "{}");
    if (pageId && map[pageId]) return map[pageId];
  } catch { /* ungültiges JSON -> Fallback */ }
  return Deno.env.get("META_PAGE_TOKEN") ?? undefined;
}

// Meta field_data -> unsere Felder. Unbekannte Fragen landen in "extra".
function mapFieldData(fieldData: Array<{ name: string; values: string[] }> = []) {
  const flat: Record<string, string> = {};
  for (const f of fieldData) flat[f.name.toLowerCase()] = (f.values?.[0] ?? "").trim();
  const known = new Set(["full_name", "first_name", "last_name", "email", "phone_number", "phone", "city"]);
  let first = flat.first_name, last = flat.last_name;
  if (!first && !last && flat.full_name) {
    const parts = flat.full_name.split(/\s+/);
    first = parts.shift() ?? "";
    last = parts.join(" ");
  }
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) if (!known.has(k) && v) extra[k] = v;
  if (flat.city) extra.city = flat.city;
  return {
    first_name: first || null,
    last_name: last || null,
    email: flat.email || null,
    phone: flat.phone_number || flat.phone || null,
    extra,
  };
}

// ---------- Kern: ein Event verarbeiten ----------
type EventRow = { id: number; leadgen_id: string; page_id: string | null; ad_id: string | null; attempts: number };

async function processEvent(ev: EventRow): Promise<void> {
  try {
    const token = pageToken(ev.page_id ?? undefined);
    if (!token) throw new Error("Kein Page Access Token für page_id " + ev.page_id);

    // 1) Lead-Daten bei Meta holen (Webhook enthält nur IDs)
    const fields = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform";
    const proof = await hmacSha256Hex(APP_SECRET, token); // appsecret_proof (nötig, wenn "App-Secret verlangen" aktiv ist)
    const res = await fetch(
      `${GRAPH}/${ev.leadgen_id}?fields=${fields}&appsecret_proof=${proof}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = body?.error ?? {};
      throw new Error(`Graph ${res.status} code=${e.code ?? "?"} sub=${e.error_subcode ?? "-"}: ${e.message ?? "unbekannt"}`);
    }

    // 2) Ad finden oder anlegen. Recruiter/Creator setzt der Datenbank-Trigger per Namensregel [ref:..] [cr:..] oder Vererbung (4.4)
    const metaAdId: string | null = body.ad_id ?? ev.ad_id ?? null;
    let adUuid: string | null = null;
    if (metaAdId) {
      await sb.from("ads").upsert(
        {
          meta_ad_id: metaAdId, name: body.ad_name ?? null, adset_name: body.adset_name ?? null,
          campaign_name: body.campaign_name ?? null, meta_adset_id: body.adset_id ?? null,
          meta_campaign_id: body.campaign_id ?? null,
        },
        { onConflict: "meta_ad_id", ignoreDuplicates: true },
      );
      const { data: ad, error: adErr } = await sb.from("ads").select("id").eq("meta_ad_id", metaAdId).single();
      if (adErr) throw new Error("Ad-Suche: " + adErr.message);
      adUuid = ad.id;
    }

    // 3) Lead anlegen. Die Zuteilung (Ad -> Recruiter, sonst offen) macht der Datenbank-Trigger.
    const f = mapFieldData(body.field_data);
    const { data: lead, error: insErr } = await sb.from("leads").insert({
      ...f,
      source: "meta_ad",
      ad_id: adUuid,
      meta_lead_id: ev.leadgen_id,
      meta_form_id: body.form_id ?? null,
      consent_at: body.created_time ?? new Date().toISOString(), // Formular enthält Meta-Datenschutzhinweis (Annahme)
      utm_source: "meta",
      utm_medium: body.platform ?? null,   // fb / ig
      utm_campaign: body.campaign_name ?? null,
      extra: { ...f.extra, is_organic: body.is_organic ?? false },
    }).select("id").single();

    let leadId: string | undefined = lead?.id;
    if (insErr) {
      if (insErr.code === "23505") {         // meta_lead_id gibt es schon -> Doppelung, kein Fehler
        const { data: ex } = await sb.from("leads").select("id").eq("meta_lead_id", ev.leadgen_id).single();
        leadId = ex?.id;
      } else throw new Error("Lead-Insert: " + insErr.message);
    }

    await sb.from("meta_webhook_events").update({
      status: "processed", lead_id: leadId, processed_at: new Date().toISOString(),
      attempts: ev.attempts + 1, last_error: null,
    }).eq("id", ev.id);
  } catch (err) {
    const attempts = ev.attempts + 1;
    const delayMin = Math.min(2 ** attempts, 360); // 2, 4, 8 ... max. 6 Stunden
    await sb.from("meta_webhook_events").update({
      status: attempts >= MAX_ATTEMPTS ? "dead" : "failed",
      attempts, last_error: String((err as Error).message).slice(0, 500),
      next_retry_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
    }).eq("id", ev.id);
    console.error("leadgen failed", ev.leadgen_id, (err as Error).message);
  }
}

// ---------- Wiederholungslauf (von pg_cron alle 10 Minuten aufgerufen) ----------
async function retryFailed(req: Request): Promise<Response> {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) {
    return new Response("forbidden", { status: 403 });
  }
  const { data } = await sb.from("meta_webhook_events")
    .select("id,leadgen_id,page_id,ad_id,attempts")
    .in("status", ["received", "failed"]).lte("next_retry_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS).order("received_at").limit(50);
  for (const ev of data ?? []) await processEvent(ev as EventRow);
  return Response.json({ retried: data?.length ?? 0 });
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;   // von Supabase Edge Functions bereitgestellt

// ---------- Einstieg ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // A) Einrichtung: Meta ruft GET mit hub.challenge auf
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      VERIFY_TOKEN !== "" && safeEqual(url.searchParams.get("hub.verify_token") ?? "", VERIFY_TOKEN);
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (url.searchParams.get("retry") === "1") return retryFailed(req);

  // B) Signatur über die ROHEN Bytes prüfen (nicht über neu serialisiertes JSON)
  const raw = new Uint8Array(await req.arrayBuffer());
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + await hmacSha256Hex(APP_SECRET, raw);
  if (!APP_SECRET || !safeEqual(sig, expected)) return new Response("invalid signature", { status: 401 });

  let payload: any;
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("bad json", { status: 400 }); }
  if (payload.object !== "page") return new Response("ignored", { status: 200 });

  // C) Jedes leadgen-Event zuerst speichern (Posteingang), dann verarbeiten
  const toProcess: EventRow[] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "leadgen" || !ch.value?.leadgen_id) continue;
      const v = ch.value;
      const { data, error } = await sb.from("meta_webhook_events").upsert({
        leadgen_id: String(v.leadgen_id), page_id: String(v.page_id ?? entry.id ?? ""),
        form_id: v.form_id ? String(v.form_id) : null, ad_id: v.ad_id ? String(v.ad_id) : null, payload: v,
      }, { onConflict: "leadgen_id", ignoreDuplicates: true }).select("id,leadgen_id,page_id,ad_id,attempts");
      if (error) {
        console.error("inbox insert failed", error.message);
        return new Response("storage error", { status: 500 });   // 500 -> Meta wiederholt die Zustellung
      }
      if (data?.length) toProcess.push(data[0] as EventRow);     // leer = Meta hat dasselbe Event schon einmal geschickt
    }
  }
  // D) Sofort antworten, sobald alles gespeichert ist. Die Verarbeitung (Graph API, Ad, Lead) läuft danach im Hintergrund weiter
  //    (EdgeRuntime.waitUntil); so wartet Meta nie auf die Graph API, auch nicht bei vielen Events in einer Zustellung.
  //    Schlägt etwas fehl, steht der Fehler im Posteingang und der Wiederholungslauf holt es nach.
  const work = (async () => {
    for (const ev of toProcess) {
      try { await processEvent(ev); } catch (e) { console.error("processEvent crashed", ev.leadgen_id, String(e)); }
    }
  })();
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;   // ohne waitUntil (z. B. lokaler Test): warten
  return new Response("ok", { status: 200 });
});
