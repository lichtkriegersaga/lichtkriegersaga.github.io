/*
 * Lichtkrieger · Sterne — Zugang zur geteilten Bewertung (Supabase)
 *
 * Nur diese zwei Werte eintragen, sonst nichts ändern:
 *   SUPABASE_URL       = Project URL, z. B. "https://abcdefghijklmnop.supabase.co"
 *   SUPABASE_ANON_KEY  = öffentlicher Schlüssel: "Publishable key" (sb_publishable_…)
 *                        oder der ältere "anon public" Key (eyJ…)
 * Beide stehen im Supabase-Dashboard unter  Project Settings → API (bzw. "Connect").
 * NIE den secret / service_role Key hier eintragen — diese Datei ist öffentlich.
 *
 * Leer gelassen = Sterne funktionieren nur lokal im Browser (keine Durchschnitte, keine Fehler).
 */
window.STERNE_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
