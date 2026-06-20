// Supabase Edge Function: team-photos
// Cloudinary signed upload/list/delete without using the app DB.
// Required secrets:
//   CLOUDINARY_CLOUD_NAME=dc17izhac
//   CLOUDINARY_API_KEY=...
//   CLOUDINARY_API_SECRET=...
// Optional:
//   CLOUDINARY_TEAM_FOLDER=squadra
//   CLOUDINARY_SECTION_TAG=foto-squadra

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function env(name: string, fallback = '') {
  return Deno.env.get(name) || fallback;
}

function cleanSegment(value: FormDataEntryValue | string | null | undefined, fallback = 'default') {
  const s = String(value || fallback)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

function baseName(filename: string) {
  return cleanSegment(filename.replace(/\.[^.]+$/, ''), 'photo').slice(0, 50);
}

function cloudinaryConfig() {
  const cloudName = env('CLOUDINARY_CLOUD_NAME', 'dc17izhac');
  const apiKey = env('CLOUDINARY_API_KEY');
  const apiSecret = env('CLOUDINARY_API_SECRET');
  const rootFolder = env('CLOUDINARY_TEAM_FOLDER', 'squadra');
  const sectionTag = env('CLOUDINARY_SECTION_TAG', 'foto-squadra');
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary non configurato: aggiungi CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET nei secrets Supabase.');
  }
  return { cloudName, apiKey, apiSecret, rootFolder, sectionTag };
}

async function sha1Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signParams(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return sha1Hex(toSign + apiSecret);
}

function deliveryUrls(resource: any, cloudName: string) {
  const publicId = resource.public_id;
  const version = resource.version ? `v${resource.version}/` : '';
  const format = resource.format ? `.${resource.format}` : '';
  const base = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  const encodedPublicId = String(publicId).split('/').map(encodeURIComponent).join('/');
  return {
    thumbUrl: `${base}c_fill,w_600,h_420,g_auto,q_auto,f_auto/${version}${encodedPublicId}${format}`,
    mediumUrl: `${base}c_limit,w_1200,q_auto,f_auto/${version}${encodedPublicId}${format}`,
    largeUrl: `${base}c_limit,w_2200,q_auto,f_auto/${version}${encodedPublicId}${format}`,
    originalUrl: `${base}${version}${encodedPublicId}${format}`,
    downloadUrl: `${base}fl_attachment/${version}${encodedPublicId}${format}`,
  };
}

function normalizeResource(resource: any, cloudName: string, rootFolder: string) {
  const urls = deliveryUrls(resource, cloudName);
  const publicId = resource.public_id || '';
  const parts = String(publicId).split('/');
  const teamId = parts[0] === rootFolder ? (parts[1] || '') : '';
  const createdAt = resource.created_at || '';
  return {
    id: publicId,
    publicId,
    path: publicId,
    teamId,
    name: `${parts[parts.length - 1] || 'photo'}.${resource.format || 'jpg'}`,
    format: resource.format || '',
    width: resource.width || 0,
    height: resource.height || 0,
    size: resource.bytes || 0,
    originalSize: resource.bytes || 0,
    bytes: resource.bytes || 0,
    ts: createdAt ? Date.parse(createdAt) || Date.now() : Date.now(),
    createdAt,
    ...urls,
    url: urls.thumbUrl,
    previewUrl: urls.thumbUrl,
  };
}

async function listResources(req: Request) {
  const { cloudName, apiKey, apiSecret, rootFolder } = cloudinaryConfig();
  const url = new URL(req.url);
  const teamIdRaw = url.searchParams.get('teamId') || '';
  const requestedFolder = cleanSegment(url.searchParams.get('folder') || rootFolder, rootFolder);
  const safeTeamId = teamIdRaw ? cleanSegment(teamIdRaw) : '';
  const prefix = safeTeamId ? `${requestedFolder}/${safeTeamId}/` : `${requestedFolder}/`;
  const all: any[] = [];
  let nextCursor = '';

  do {
    const qs = new URLSearchParams({
      prefix,
      max_results: '500',
      type: 'upload',
      resource_type: 'image',
    });
    if (nextCursor) qs.set('next_cursor', nextCursor);
    const apiUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${qs.toString()}`;
    const res = await fetch(apiUrl, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:${apiSecret}`) },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return json({ error: data?.error?.message || 'Lista Cloudinary non disponibile' }, res.status);
    all.push(...(data.resources || []));
    nextCursor = data.next_cursor || '';
  } while (nextCursor);

  const photos = all
    .filter(r => r && r.public_id && !r.placeholder && Number(r.bytes || 0) > 0)
    .map(r => normalizeResource(r, cloudName, requestedFolder))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return json({ photos, count: photos.length });
}

async function uploadResource(req: Request) {
  const { cloudName, apiKey, apiSecret, rootFolder, sectionTag } = cloudinaryConfig();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'File mancante' }, 400);
  if (!file.type.startsWith('image/')) return json({ error: 'Sono accettate solo immagini' }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ error: 'Cloudinary Free accetta immagini fino a 10 MB' }, 413);

  const requestedFolder = cleanSegment(form.get('folder') || rootFolder, rootFolder);
  const teamId = cleanSegment(form.get('teamId'), 'team');
  const section = cleanSegment(form.get('section') || sectionTag, sectionTag);
  const folder = `${requestedFolder}/${teamId}`;
  const publicId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${baseName(file.name || 'photo')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const tags = `${section},team_${teamId}`;

  const signedParams: Record<string, string> = {
    folder,
    public_id: publicId,
    timestamp,
    tags,
    overwrite: 'false',
    invalidate: 'true',
  };
  const signature = await signParams(signedParams, apiSecret);

  const uploadForm = new FormData();
  uploadForm.set('file', file);
  uploadForm.set('api_key', apiKey);
  uploadForm.set('signature', signature);
  Object.entries(signedParams).forEach(([k, v]) => uploadForm.set(k, v));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: uploadForm,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error?.message || 'Upload Cloudinary fallito' }, res.status);

  const photo = normalizeResource(data, cloudName, requestedFolder);
  photo.name = file.name || photo.name;
  return json({ photo }, 201);
}

async function deleteResource(req: Request) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const body = await req.json().catch(() => ({}));
  const publicId = String(body.publicId || body.path || '').trim();
  if (!publicId) return json({ error: 'publicId mancante' }, 400);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams: Record<string, string> = {
    public_id: publicId,
    timestamp,
    invalidate: 'true',
  };
  const signature = await signParams(signedParams, apiSecret);
  const form = new FormData();
  form.set('api_key', apiKey);
  form.set('signature', signature);
  Object.entries(signedParams).forEach(([k, v]) => form.set(k, v));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return json({ error: data?.error?.message || 'Eliminazione Cloudinary fallita' }, res.status);
  return json({ ok: true, result: data?.result || 'ok' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    if (req.method === 'GET') return await listResources(req);
    if (req.method === 'POST') return await uploadResource(req);
    if (req.method === 'DELETE') return await deleteResource(req);
    return json({ error: 'Metodo non supportato' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Errore funzione team-photos' }, 500);
  }
});
