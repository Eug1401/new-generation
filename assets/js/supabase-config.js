// Configurazione backend condiviso Supabase.
// Finché ENABLED è false, l'app continua a funzionare in locale con localStorage.
window.NEW_GENERATION_SUPABASE = {
  ENABLED: true,
  URL: 'https://mcksxqtgibkazxnkdfra.supabase.co',
  ANON_KEY: 'sb_publishable_AAtoXhi2a99AyHGvDLM-CA_luXl_-PK',
  TABLE: 'app_state',
  ROW_ID: 'main',
  // Timeout (ms) per le chiamate di lettura/scrittura verso Supabase.
  REMOTE_FETCH_TIMEOUT_MS: 12000
};

// Configurazione foto squadra via Cloudinary.
// Le chiavi segrete (API key/secret Cloudinary) NON devono stare nel frontend:
// vanno messe nei Secrets della Edge Function Supabase (Project Settings > Edge Functions > Secrets).
window.NEW_GENERATION_CLOUDINARY = {
  CLOUD_NAME: 'dc17izhac',
  FOLDER: 'squadra',
  SECTION: 'foto-squadra',
  EDGE_FUNCTION: 'team-photos'
};
