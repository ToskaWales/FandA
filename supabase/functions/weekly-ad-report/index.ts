// supabase/functions/weekly-ad-report/index.ts  (montags per pg_cron; Header x-cron-secret)
// Deploy: supabase functions deploy weekly-ad-report --no-verify-jwt   (pg_cron schickt keinen Supabase-JWT; Schutz = x-cron-secret)
// Secrets: ANTHROPIC_API_KEY, CRON_SECRET, AI_MODEL (optional; Standard unten. Aktuelle Modellnamen in der Anthropic-Doku prüfen)
import { createClient } from "npm:@supabase/supabase-js@2";
import { PROMPT_WEEKLY } from "./prompts.ts";   // Text steht in Abschnitt 7.4

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
// Zeitkonstanter Vergleich wie in meta-leadgen-webhook; fehlt CRON_SECRET, wird jeder Aufruf abgelehnt.
const cronOk = (req: Request) => {
  const a = req.headers.get("x-cron-secret") ?? "", b = Deno.env.get("CRON_SECRET") ?? "";
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

// Das Urteil je Ad rechnet DIESER Code, nicht die KI (gleiche Zahlen = gleiches Urteil). Die KI erklärt es nur.
// Startwerte (Annahme, hier anpassbar): belastbar ab 15 Leads oder 150 EUR; unter 7 Tage Alter nie ein Urteil;
// "skalieren" ab 10 Tagen; "pausieren" ab 14 Tagen, mindestens 10 Leads, 0 bezahlt.
const n = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));
function regelUrteil(a: any, b: { median_cpl?: number | null; median_cost_per_paid?: number | null; median_qualified_rate?: number | null }): string {
  const leads = n(a.leads) ?? 0, spend = n(a.spend) ?? 0, paid = n(a.paid_leads) ?? 0, age = n(a.age_days) ?? 0;
  if (!(leads >= 15 || spend >= 150) || age < 7) return "zu_wenig_daten";
  const cpl = n(a.cpl), cpp = n(a.cost_per_paid), qr = n(a.qualified_rate);
  const quoteBesser = paid >= 3 && cpp !== null && b.median_cost_per_paid != null
    ? cpp < b.median_cost_per_paid
    : qr !== null && b.median_qualified_rate != null && qr > b.median_qualified_rate;
  if (age >= 10 && cpl !== null && b.median_cpl != null && cpl < b.median_cpl && quoteBesser) return "skalieren";
  if (age >= 14 && spend >= 150 && leads >= 10 && paid === 0 && qr !== null && b.median_qualified_rate != null && qr < b.median_qualified_rate) return "pausieren";
  return "beobachten";
}

Deno.serve(async (req) => {
  if (!cronOk(req)) return new Response("forbidden", { status: 403 });

  const to = day(-1), from = day(-7), prevFrom = day(-14), prevTo = day(-8), from28 = day(-28);
  const [w, p, m, cr, rec, bm] = await Promise.all([
    sb.rpc("ad_performance", { p_from: from, p_to: to }),
    sb.rpc("ad_performance", { p_from: prevFrom, p_to: prevTo }),
    sb.rpc("ad_performance", { p_from: from28, p_to: to }),
    sb.rpc("creator_performance", { p_from: from28, p_to: to }),
    sb.from("v_lead_reconciliation").select("*").gte("day", from).lte("day", to),
    sb.rpc("ad_benchmarks", { p_from: from28, p_to: to }),
  ]);
  for (const r of [w, p, m, cr, rec, bm]) if (r.error) throw new Error(r.error.message);
  const bench = (bm.data?.[0] ?? {}) as { ads_belastbar?: number; median_cpl?: number | null; median_cost_per_paid?: number | null; median_qualified_rate?: number | null };

  const meta = (rec.data ?? []) as Array<{ meta_leads: number; crm_leads: number }>;
  const input = {
    zeitraum: { von: from, bis: to, vorwoche: [prevFrom, prevTo], fenster_28_tage: [from28, to] },
    richtwerte_28_tage: bench,    // Mediane über die belastbaren Ads, von der Datenbank berechnet
    ads_diese_woche: w.data, ads_vorwoche: p.data,
    ads_28_tage: (m.data ?? []).map((a: any) => ({ ...a, regel_urteil: regelUrteil(a, bench) })),
    creators_28_tage: cr.data,
    datenqualitaet: {
      leads_laut_meta: meta.reduce((s, r) => s + Number(r.meta_leads), 0),
      leads_im_crm: meta.reduce((s, r) => s + Number(r.crm_leads), 0),
    },
    bekannte_videos_ohne_creator: (m.data ?? []).filter((a: any) => !a.creator_id).length,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 6000, system: PROMPT_WEEKLY,
      messages: [{ role: "user", content: "Hier sind die Zahlen als JSON. Antworte nur mit dem verlangten JSON.\n" + JSON.stringify(input) }],
    }),
  });
  const j = await res.json();
  let report: any = null, error: string | null = null;
  try {
    if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
    const text: string = j.content?.[0]?.text ?? "";
    report = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch (e) { error = String((e as Error).message); }

  const { data: row, error: insErr } = await sb.from("ad_reports").upsert({
    period_from: from, period_to: to, kind: "weekly", input_json: input, report_json: report,
    report_md: report?.bericht_markdown ?? null, model: MODEL,
    status: error ? "failed" : "ok", error,
  }, { onConflict: "kind,period_from,period_to" }).select("id").single();
  if (insErr) throw new Error(insErr.message);

  if (report?.videoideen?.length) {
    // Erneuter Lauf für denselben Zeitraum: nur die noch nicht bearbeiteten Ideen (Status "new") dieses Berichts ersetzen.
    await sb.from("video_ideas").delete().eq("report_id", row.id).eq("status", "new");
    const metaIds = [...new Set(report.videoideen.map((v: any) => v.bezug_meta_ad_id).filter(Boolean))];
    const { data: adRows } = metaIds.length ? await sb.from("ads").select("id, meta_ad_id").in("meta_ad_id", metaIds) : { data: [] };
    const adByMeta = new Map((adRows ?? []).map((a: any) => [a.meta_ad_id, a.id]));
    const { error: viErr } = await sb.from("video_ideas").insert(report.videoideen.map((v: any) => ({
      report_id: row.id, based_on_ad: adByMeta.get(v.bezug_meta_ad_id) ?? null,
      title: String(v.titel ?? "Idee"), hook: String(v.hook ?? ""),
      script: Array.isArray(v.ablauf) ? v.ablauf.join("\n") : String(v.ablauf ?? ""),   // Spalte ist Text, die KI liefert eine Liste
      creator_hint: [v.creator_hinweis, v.bezug].filter(Boolean).join(" | ") || null,
    })));
    if (viErr) console.error("video_ideas insert", viErr.message);
  }
  return Response.json({ ok: !error, report_id: row.id, error });
});
