// supabase/functions/sync-meta-insights/index.ts  (täglich per pg_cron; Header x-cron-secret)
// Deploy: supabase functions deploy sync-meta-insights --no-verify-jwt   (pg_cron schickt keinen Supabase-JWT; Schutz = x-cron-secret)
// Secrets: META_SYSTEM_TOKEN (System-User-Token, Recht ads_read), META_AD_ACCOUNT_ID (z. B. act_1234567890),
//          META_GRAPH_VERSION (optional), CRON_SECRET
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
// Zeitkonstanter Vergleich wie in meta-leadgen-webhook; fehlt CRON_SECRET, wird jeder Aufruf abgelehnt.
const cronOk = (req: Request) => {
  const a = req.headers.get("x-cron-secret") ?? "", b = Deno.env.get("CRON_SECRET") ?? "";
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v23.0"}`;
const TOKEN = Deno.env.get("META_SYSTEM_TOKEN")!;
const ACCOUNT = Deno.env.get("META_AD_ACCOUNT_ID")!;
const act = (list?: Array<{ action_type: string; value: string }>, type = "") =>
  Number(list?.find((a) => a.action_type === type)?.value ?? 0);

async function* pages(url: string) {                 // folgt paging.next bis zum Ende
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(`Meta ${res.status}: ${j?.error?.message ?? "Fehler"}`);
    yield j.data ?? [];
    url = j.paging?.next ?? "";
  }
}

Deno.serve(async (req) => {
  if (!cronOk(req)) return new Response("forbidden", { status: 403 });

  // Letzte 7 Tage jedes Mal neu ziehen: Meta korrigiert Zahlen nachträglich.
  const until = new Date(); const since = new Date(Date.now() - 7 * 86400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const q = new URLSearchParams({
    level: "ad", time_increment: "1", limit: "500",
    time_range: JSON.stringify({ since: d(since), until: d(until) }),
    fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,date_start,spend,impressions,reach,inline_link_clicks,actions,video_thruplay_watched_actions",
  });

  let rows = 0;
  for await (const batch of pages(`${GRAPH}/${ACCOUNT}/insights?${q}`)) {
    // 1) Ads anlegen/aktualisieren. Creator und Recruiter der Ad werden dabei NICHT überschrieben (neue Ads belegt der Datenbank-Trigger vor, siehe 3.2).
    const ads = [...new Map<string, { meta_ad_id: string }>(batch.map((r: any) => [r.ad_id, {
      meta_ad_id: r.ad_id, name: r.ad_name, adset_name: r.adset_name, campaign_name: r.campaign_name,
      meta_adset_id: r.adset_id, meta_campaign_id: r.campaign_id,
    }])).values()];
    const { error: e1 } = await sb.from("ads").upsert(ads, { onConflict: "meta_ad_id" });
    if (e1) throw new Error(e1.message);
    const { data: idMap } = await sb.from("ads").select("id, meta_ad_id").in("meta_ad_id", ads.map((a) => a.meta_ad_id));
    const uuid = new Map((idMap ?? []).map((a) => [a.meta_ad_id, a.id]));

    // 2) Tageswerte
    const stats = batch.map((r: any) => ({
      ad_id: uuid.get(r.ad_id), day: r.date_start, spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), link_clicks: Number(r.inline_link_clicks ?? 0),
      meta_leads: act(r.actions, "lead") || act(r.actions, "onsite_conversion.lead_grouped"),
      video_3s: act(r.actions, "video_view"), thruplays: act(r.video_thruplay_watched_actions, "video_view"),
      raw: r, synced_at: new Date().toISOString(),
    })).filter((s: any) => s.ad_id);
    const { error: e2 } = await sb.from("ad_stats").upsert(stats, { onConflict: "ad_id,day" });
    if (e2) throw new Error(e2.message);
    rows += stats.length;
  }

  // 3) Status und Vorschaubild der Ads (für die Ad-Übersicht)
  const meta = new URLSearchParams({ fields: "id,effective_status,created_time,creative{thumbnail_url,video_id}", limit: "200" });
  for await (const batch of pages(`${GRAPH}/${ACCOUNT}/ads?${meta}`)) {
    for (const a of batch) {
      await sb.from("ads").update({
        status: a.effective_status, thumbnail_url: a.creative?.thumbnail_url ?? null, video_id: a.creative?.video_id ?? null,
        meta_created_at: a.created_time ?? null,    // Alter der Ad für die Auswertung (keine Urteile über junge Ads)
      }).eq("meta_ad_id", a.id);
    }
  }
  return Response.json({ ok: true, rows });
});
