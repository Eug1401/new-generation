// Supabase Edge Function: team-photos
// Flusso separato dalle immagini articolo: Cloudinary folder/tag e tabella dedicati.
// Deploy con verify_jwt=false (config.toml): GET/download/ZIP sono pubblici,
// mentre upload, modifica, sostituzione ed eliminazione validano manualmente
// la sessione Supabase dell'amministratore.

import JSZip from 'npm:jszip@3.10.1';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_SIZE = 80 * 1024 * 1024;
const MAX_ZIP_FILES = 100;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 120 * 1000 * 1000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
const ADMIN_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type PhotoRecord = Record<string, any>;

class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function env(name: string, fallback = '') {
  return Deno.env.get(name) || fallback;
}

function normalizeOrigin(value: string) {
  return String(value || '').trim().replace(/\/$/, '');
}

function allowedOrigins() {
  return env('PHOTO_ALLOWED_ORIGINS')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

function isOriginAllowed(origin: string) {
  const configured = allowedOrigins();
  const normalized = normalizeOrigin(origin);
  return !normalized || !configured.length || configured.includes('*') || configured.includes(normalized);
}

function corsHeaders(req: Request) {
  const origin = normalizeOrigin(req.headers.get('origin') || '');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  // La route resta bloccata da ensureOriginAllowed, ma il browser può leggere
  // il JSON 403 e mostrare ORIGIN_NOT_ALLOWED invece di "Failed to fetch".
  headers['Access-Control-Allow-Origin'] = origin || '*';
  return headers;
}

function ensureOriginAllowed(req: Request) {
  const origin = normalizeOrigin(req.headers.get('origin') || '');
  if (!isOriginAllowed(origin)) {
    throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origine non autorizzata per la sezione Foto. Aggiorna PHOTO_ALLOWED_ORIGINS con il dominio esatto del sito.');
  }
}

function json(req: Request, body: JsonValue, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

function binary(req: Request, body: BodyInit, status: number, headers: HeadersInit) {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(req),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function cleanSegment(value: FormDataEntryValue | string | null | undefined, fallback = 'default') {
  const clean = String(value || fallback)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function safeText(value: unknown, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function safeFileName(value: unknown, fallback = 'foto.jpg') {
  const name = String(value || fallback).split(/[\\/]/).pop() || fallback;
  return name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || fallback;
}

function baseName(filename: string) {
  return cleanSegment(filename.replace(/\.[^.]+$/, ''), 'photo').slice(0, 50);
}

function fileExtension(filename: string) {
  return String(filename || '').split('.').pop()?.toLowerCase() || '';
}

function cloudinaryUrlConfig() {
  const raw = env('CLOUDINARY_URL').trim();
  if (!raw) return { cloudName: '', apiKey: '', apiSecret: '' };
  try {
    const parsed = new URL(raw.replace(/^cloudinary:\/\//i, 'https://'));
    const result = {
      cloudName: decodeURIComponent(parsed.hostname || ''),
      apiKey: decodeURIComponent(parsed.username || ''),
      apiSecret: decodeURIComponent(parsed.password || ''),
    };
    if (Object.values(result).some((value) => /<|>|your_|placeholder/i.test(value))) {
      return { cloudName: '', apiKey: '', apiSecret: '' };
    }
    return result;
  } catch {
    return { cloudName: '', apiKey: '', apiSecret: '' };
  }
}

function cloudinaryConfig() {
  const fromUrl = cloudinaryUrlConfig();
  const cloudName = env('CLOUDINARY_CLOUD_NAME', fromUrl.cloudName || 'dc17izhac');
  const apiKey = env('CLOUDINARY_API_KEY', fromUrl.apiKey);
  const apiSecret = env('CLOUDINARY_API_SECRET', fromUrl.apiSecret);
  const rootFolder = cleanSegment(env('CLOUDINARY_TEAM_FOLDER', 'squadra'), 'squadra');
  const sectionTag = cleanSegment(env('CLOUDINARY_SECTION_TAG', 'foto-squadra'), 'foto-squadra');
  if (!cloudName || !apiKey || !apiSecret) {
    throw new HttpError(500, 'CLOUDINARY_CONFIG', 'Cloudinary non configurato per la sezione Foto.');
  }
  return { cloudName, apiKey, apiSecret, rootFolder, sectionTag };
}

function configurationHealth(req: Request) {
  const fromUrl = cloudinaryUrlConfig();
  const cloudName = env('CLOUDINARY_CLOUD_NAME', fromUrl.cloudName || 'dc17izhac');
  const cloudinaryConfigured = Boolean(
    cloudName &&
    (env('CLOUDINARY_API_KEY') || fromUrl.apiKey) &&
    (env('CLOUDINARY_API_SECRET') || fromUrl.apiSecret)
  );
  const supabaseConfigured = Boolean(env('SUPABASE_URL') && env('SUPABASE_ANON_KEY') && env('SUPABASE_SERVICE_ROLE_KEY'));
  const origin = normalizeOrigin(req.headers.get('origin') || '');
  return {
    ok: cloudinaryConfigured && supabaseConfigured && isOriginAllowed(origin),
    service: 'team-photos',
    version: 'v126.17',
    origin: origin || null,
    originAllowed: isOriginAllowed(origin),
    configuredOrigins: allowedOrigins().length,
    cloudinary: {
      configured: cloudinaryConfigured,
      cloudName: cloudName || null,
      source: env('CLOUDINARY_API_KEY') ? 'separate-secrets' : (fromUrl.apiKey ? 'CLOUDINARY_URL' : 'missing'),
    },
    supabase: { configured: supabaseConfigured },
  };
}

function supabaseConfig() {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new HttpError(500, 'SUPABASE_CONFIG', 'Configurazione Supabase incompleta nella Edge Function.');
  }
  return { url: url.replace(/\/$/, ''), anonKey, serviceRoleKey };
}

async function requireAdmin(req: Request) {
  const { url, anonKey } = supabaseConfig();
  const authorization = req.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.startsWith('sb_publishable_') || token === anonKey) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Sessione amministratore assente o scaduta.');
  }
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Sessione amministratore non valida o scaduta.');
  }
  return user;
}

async function dbRequest(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

function metadataUnavailable(status: number, data: any) {
  return status === 404 || data?.code === '42P01' || /team_photos.*does not exist/i.test(String(data?.message || data || ''));
}

async function listMetadata(teamId = '') {
  const query = new URLSearchParams({ select: '*' });
  if (teamId) query.set('team_id', `eq.${teamId}`);
  query.set('order', 'display_order.asc,created_at.desc');
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`);
  if (metadataUnavailable(response.status, data)) return { available: false, rows: [] as PhotoRecord[] };
  if (!response.ok) throw new HttpError(502, 'DB_READ_FAILED', 'Impossibile leggere i metadati delle foto.', data);
  return { available: true, rows: Array.isArray(data) ? data : [] };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findMetadata(photoId: string) {
  const safeId = String(photoId || '').trim();
  if (!safeId) return null;
  const field = isUuid(safeId) ? 'id' : 'public_id';
  const query = new URLSearchParams({ select: '*', limit: '1' });
  query.set(field, `eq.${safeId}`);
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`);
  if (metadataUnavailable(response.status, data)) return null;
  if (!response.ok) throw new HttpError(502, 'DB_READ_FAILED', 'Impossibile verificare la foto richiesta.', data);
  return Array.isArray(data) ? data[0] || null : null;
}

async function insertMetadata(record: PhotoRecord) {
  const { response, data } = await dbRequest('team_photos?on_conflict=public_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new HttpError(502, 'DB_SAVE_FAILED', 'Cloudinary ha risposto, ma il salvataggio dei metadati è fallito.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function patchMetadata(id: string, patch: PhotoRecord) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new HttpError(502, 'DB_SAVE_FAILED', 'Aggiornamento dei metadati non riuscito.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function deleteMetadata(id: string) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  const { response, data } = await dbRequest(`team_photos?${query.toString()}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!response.ok) throw new HttpError(502, 'DB_DELETE_FAILED', 'Eliminazione del record foto non riuscita.', data);
  return Array.isArray(data) ? data[0] : data;
}

async function sha1Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signParams(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return sha1Hex(toSign + apiSecret);
}

function encodedPublicId(publicId: string) {
  return String(publicId).split('/').map(encodeURIComponent).join('/');
}

function deliveryUrls(resource: any, cloudName: string) {
  const publicId = resource.public_id || resource.publicId || '';
  const versionNumber = resource.version || '';
  const version = versionNumber ? `v${versionNumber}/` : '';
  const formatValue = resource.format || '';
  const format = formatValue ? `.${formatValue}` : '';
  const base = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  const id = encodedPublicId(publicId);
  return {
    thumbUrl: `${base}a_auto,c_fill,w_600,h_420,g_auto,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    mediumUrl: `${base}a_auto,c_limit,w_1200,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    largeUrl: `${base}a_auto,c_limit,w_2200,q_auto,f_auto,dpr_auto/${version}${id}${format}`,
    originalUrl: resource.secure_url || `${base}${version}${id}${format}`,
    downloadUrl: `${base}fl_attachment:${encodeURIComponent(safeFileName(resource.original_filename || resource.originalName || `foto.${formatValue || 'jpg'}`))}/${version}${id}${format}`,
  };
}

function normalizeResource(resource: any, cloudName: string, rootFolder: string, metadata: PhotoRecord | null = null) {
  const urls = deliveryUrls({ ...resource, original_filename: metadata?.original_name || resource.original_filename }, cloudName);
  const publicId = resource.public_id || metadata?.public_id || '';
  const parts = String(publicId).split('/');
  const teamId = metadata?.team_id || (parts[0] === rootFolder ? parts[1] || '' : '');
  const createdAt = metadata?.created_at || resource.created_at || '';
  const format = metadata?.format || resource.format || '';
  const originalName = metadata?.original_name || `${parts[parts.length - 1] || 'photo'}.${format || 'jpg'}`;
  return {
    id: publicId,
    dbId: metadata?.id || '',
    publicId,
    path: publicId,
    teamId,
    name: originalName,
    originalName,
    title: metadata?.title || '',
    description: metadata?.description || '',
    caption: metadata?.caption || '',
    altText: metadata?.alt_text || '',
    album: metadata?.album || '',
    order: Number(metadata?.display_order || 0),
    version: Number(metadata?.version || resource.version || 0),
    format,
    mimeType: metadata?.mime_type || (format ? `image/${format === 'jpg' ? 'jpeg' : format}` : ''),
    width: Number(metadata?.width || resource.width || 0),
    height: Number(metadata?.height || resource.height || 0),
    size: Number(metadata?.bytes || resource.bytes || 0),
    originalSize: Number(metadata?.bytes || resource.bytes || 0),
    bytes: Number(metadata?.bytes || resource.bytes || 0),
    ts: createdAt ? Date.parse(createdAt) || Date.now() : Date.now(),
    createdAt,
    updatedAt: metadata?.updated_at || createdAt,
    ...urls,
    url: urls.thumbUrl,
    previewUrl: urls.thumbUrl,
  };
}

function resourceToRecord(resource: any, teamId: string, originalName: string, metadata: PhotoRecord = {}) {
  const { cloudName } = cloudinaryConfig();
  const normalizedResource = {
    ...resource,
    public_id: resource.public_id || resource.publicId || resource.path,
    secure_url: resource.secure_url || resource.originalUrl || resource.original_url,
    bytes: resource.bytes || resource.size || resource.originalSize,
    original_filename: originalName,
  };
  const urls = deliveryUrls(normalizedResource, cloudName);
  return {
    public_id: normalizedResource.public_id,
    team_id: teamId,
    original_url: urls.originalUrl,
    download_url: urls.downloadUrl,
    thumb_url: urls.thumbUrl,
    medium_url: urls.mediumUrl,
    large_url: urls.largeUrl,
    version: Number(normalizedResource.version || 0),
    format: normalizedResource.format || '',
    width: Number(normalizedResource.width || 0),
    height: Number(normalizedResource.height || 0),
    bytes: Number(normalizedResource.bytes || 0),
    mime_type: normalizedResource.mimeType || normalizedResource.mime_type || (normalizedResource.format ? `image/${normalizedResource.format === 'jpg' ? 'jpeg' : normalizedResource.format}` : ''),
    original_name: safeFileName(originalName),
    title: safeText(metadata.title, 160),
    description: safeText(metadata.description, 2000),
    caption: safeText(metadata.caption, 1000),
    alt_text: safeText(metadata.altText || metadata.alt_text, 300),
    album: safeText(metadata.album, 120),
    display_order: Number.isFinite(Number(metadata.order ?? metadata.display_order)) ? Number(metadata.order ?? metadata.display_order) : 0,
    updated_at: new Date().toISOString(),
  };
}

async function validateFile(file: File) {
  if (!file.size) throw new HttpError(400, 'EMPTY_FILE', `Il file ${safeFileName(file.name)} è vuoto.`);
  if (file.size > MAX_FILE_SIZE) throw new HttpError(413, 'FILE_TOO_LARGE', `${safeFileName(file.name)} supera il limite di 10 MB.`);
  if (!ALLOWED_MIME.has(file.type)) throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Sono supportati soltanto JPEG, PNG e WebP.');
  if (!ALLOWED_EXT.has(fileExtension(file.name))) throw new HttpError(415, 'UNSUPPORTED_EXTENSION', 'Estensione non supportata. Usa JPG, JPEG, PNG o WebP.');
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isWebp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const matches = (file.type === 'image/jpeg' && isJpeg) || (file.type === 'image/png' && isPng) || (file.type === 'image/webp' && isWebp);
  if (!matches) throw new HttpError(415, 'CORRUPT_FILE', `${safeFileName(file.name)} non contiene un'immagine valida del formato dichiarato.`);
}

async function cloudinaryUpload(file: File, teamId: string) {
  const { cloudName, apiKey, apiSecret, rootFolder, sectionTag } = cloudinaryConfig();
  const folder = `${rootFolder}/${cleanSegment(teamId, 'team')}`;
  const publicId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${baseName(file.name || 'photo')}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedParams: Record<string, string> = {
    folder,
    public_id: publicId,
    timestamp,
    tags: `${sectionTag},team_${cleanSegment(teamId, 'team')}`,
    overwrite: 'false',
    invalidate: 'true',
  };
  const signature = await signParams(signedParams, apiSecret);
  const uploadForm = new FormData();
  uploadForm.set('file', file);
  uploadForm.set('api_key', apiKey);
  uploadForm.set('signature', signature);
  Object.entries(signedParams).forEach(([key, value]) => uploadForm.set(key, value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: uploadForm,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status, 'CLOUDINARY_UPLOAD', data?.error?.message || 'Upload Cloudinary fallito.');
    if (!data?.public_id || !Number(data?.width) || !Number(data?.height) || !Number(data?.bytes)) {
      throw new HttpError(502, 'CLOUDINARY_INVALID_RESPONSE', 'Cloudinary non ha restituito metadati validi per l’originale.');
    }
    if (Number(data.width) * Number(data.height) > MAX_IMAGE_PIXELS) {
      await cloudinaryDestroy(data.public_id).catch(() => undefined);
      throw new HttpError(415, 'INVALID_DIMENSIONS', 'La risoluzione della foto supera il limite di 120 megapixel.');
    }
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new HttpError(504, 'CLOUDINARY_TIMEOUT', 'Cloudinary non ha risposto entro il tempo previsto.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function cloudinaryDestroy(publicId: string) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { public_id: publicId, timestamp, invalidate: 'true' };
  const signature = await signParams(params, apiSecret);
  const form = new FormData();
  form.set('api_key', apiKey);
  form.set('signature', signature);
  Object.entries(params).forEach(([key, value]) => form.set(key, value));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !['ok', 'not found'].includes(data?.result)) {
    throw new HttpError(response.status || 502, 'CLOUDINARY_DELETE', data?.error?.message || 'Eliminazione Cloudinary fallita.');
  }
  return data?.result || 'ok';
}

async function listCloudinary(teamId = '') {
  const { cloudName, apiKey, apiSecret, rootFolder } = cloudinaryConfig();
  const safeTeam = teamId ? cleanSegment(teamId) : '';
  const prefix = safeTeam ? `${rootFolder}/${safeTeam}/` : `${rootFolder}/`;
  const resources: any[] = [];
  let cursor = '';
  do {
    const query = new URLSearchParams({ prefix, max_results: '500', type: 'upload', resource_type: 'image' });
    if (cursor) query.set('next_cursor', cursor);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${query.toString()}`, {
      headers: { Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}` },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status, 'CLOUDINARY_LIST', data?.error?.message || 'Lista Cloudinary non disponibile.');
    resources.push(...(data?.resources || []));
    cursor = data?.next_cursor || '';
  } while (cursor);
  return resources.filter((resource) => resource?.public_id?.startsWith(`${rootFolder}/`) && !resource.placeholder && Number(resource.bytes || 0) > 0);
}

async function resolvePhoto(photoId: string) {
  const { cloudName, rootFolder } = cloudinaryConfig();
  const metadata = await findMetadata(photoId);
  if (metadata) {
    if (!String(metadata.public_id || '').startsWith(`${rootFolder}/`)) throw new HttpError(403, 'PHOTO_SCOPE', 'La risorsa non appartiene alla galleria Foto.');
    return normalizeResource({
      public_id: metadata.public_id,
      version: metadata.version,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      bytes: metadata.bytes,
      secure_url: metadata.original_url,
      created_at: metadata.created_at,
    }, cloudName, rootFolder, metadata);
  }
  const resources = await listCloudinary();
  const resource = resources.find((item) => item.public_id === photoId);
  if (!resource) throw new HttpError(404, 'PHOTO_NOT_FOUND', 'Foto non trovata.');
  return normalizeResource(resource, cloudName, rootFolder, null);
}

async function ensureMetadata(photoId: string) {
  const existing = await findMetadata(photoId);
  if (existing) return existing;
  const photo = await resolvePhoto(photoId);
  const record = resourceToRecord(photo, photo.teamId, photo.originalName || photo.name, {
    title: photo.title,
    description: photo.description,
    caption: photo.caption,
    altText: photo.altText,
    album: photo.album,
    order: photo.order,
  });
  return insertMetadata(record);
}

async function listResources(req: Request) {
  const url = new URL(req.url);
  const teamId = safeText(url.searchParams.get('teamId'), 80);
  const { cloudName, rootFolder } = cloudinaryConfig();
  const [resources, metadataResult] = await Promise.all([listCloudinary(teamId), listMetadata(teamId)]);
  const byPublicId = new Map(metadataResult.rows.map((row) => [row.public_id, row]));
  const photos = resources
    .map((resource) => normalizeResource(resource, cloudName, rootFolder, byPublicId.get(resource.public_id) || null))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || (b.ts || 0) - (a.ts || 0));
  return json(req, { ok: true, photos, count: photos.length, metadataSource: metadataResult.available ? 'database' : 'cloudinary-fallback' });
}

function metadataFromForm(form: FormData) {
  return {
    title: form.get('title'),
    description: form.get('description'),
    caption: form.get('caption'),
    altText: form.get('altText'),
    album: form.get('album'),
    order: form.get('order'),
  };
}

async function uploadResources(req: Request) {
  const form = await req.formData();
  const files = [...form.getAll('files'), form.get('file')].filter((entry): entry is File => entry instanceof File);
  const uniqueFiles = files.filter((file, index) => files.indexOf(file) === index);
  if (!uniqueFiles.length) throw new HttpError(400, 'FILE_MISSING', 'Nessun file ricevuto nel campo multipart "file" o "files".');
  if (uniqueFiles.length > MAX_BATCH_FILES) throw new HttpError(413, 'BATCH_TOO_LARGE', `Puoi caricare al massimo ${MAX_BATCH_FILES} foto per batch.`);
  const totalBytes = uniqueFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BATCH_SIZE) throw new HttpError(413, 'BATCH_TOO_LARGE', 'Il batch supera il limite totale di 80 MB.');
  const teamId = cleanSegment(form.get('teamId'), 'team');
  const metadata = metadataFromForm(form);
  const created: any[] = [];
  const failed: any[] = [];
  for (const file of uniqueFiles) {
    let uploaded: any = null;
    try {
      await validateFile(file);
      uploaded = await cloudinaryUpload(file, teamId);
      const record = resourceToRecord(uploaded, teamId, file.name, metadata);
      const saved = await insertMetadata(record);
      created.push(normalizeResource(uploaded, cloudinaryConfig().cloudName, cloudinaryConfig().rootFolder, saved));
    } catch (error) {
      if (uploaded?.public_id) await cloudinaryDestroy(uploaded.public_id).catch(() => undefined);
      const httpError = error instanceof HttpError ? error : new HttpError(500, 'UPLOAD_FAILED', error instanceof Error ? error.message : 'Upload fallito.');
      failed.push({ name: safeFileName(file.name), code: httpError.code, message: httpError.message, status: httpError.status });
    }
  }
  const status = created.length && failed.length ? 207 : created.length ? 201 : failed[0]?.status || 400;
  return json(req, {
    ok: failed.length === 0,
    partial: created.length > 0 && failed.length > 0,
    created,
    failed,
    photo: created.length === 1 ? created[0] : undefined,
    message: failed.length ? `${created.length} foto caricate, ${failed.length} fallite.` : `${created.length} foto caricate.`,
  }, status);
}

async function updateMetadata(req: Request) {
  const body = await req.json().catch(() => ({}));
  const record = await ensureMetadata(String(body.photoId || body.publicId || body.id || ''));
  const patch = {
    title: safeText(body.title, 160),
    description: safeText(body.description, 2000),
    caption: safeText(body.caption, 1000),
    alt_text: safeText(body.altText, 300),
    album: safeText(body.album, 120),
    display_order: Number.isFinite(Number(body.order)) ? Number(body.order) : Number(record.display_order || 0),
  };
  const saved = await patchMetadata(record.id, patch);
  const photo = await resolvePhoto(saved.public_id);
  return json(req, { ok: true, photo, message: 'Metadati aggiornati.' });
}

async function replaceResource(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'FILE_MISSING', 'File sostitutivo mancante.');
  await validateFile(file);
  const old = await ensureMetadata(String(form.get('photoId') || form.get('publicId') || ''));
  const { rootFolder, cloudName } = cloudinaryConfig();
  if (!String(old.public_id).startsWith(`${rootFolder}/`)) throw new HttpError(403, 'PHOTO_SCOPE', 'La risorsa non appartiene alla galleria Foto.');
  const uploaded = await cloudinaryUpload(file, old.team_id);
  try {
    const record = resourceToRecord(uploaded, old.team_id, file.name, {
      title: form.get('title') ?? old.title,
      description: form.get('description') ?? old.description,
      caption: form.get('caption') ?? old.caption,
      altText: form.get('altText') ?? old.alt_text,
      album: form.get('album') ?? old.album,
      order: form.get('order') ?? old.display_order,
    });
    const saved = await patchMetadata(old.id, record);
    let oldResourceDeleted = true;
    try { await cloudinaryDestroy(old.public_id); } catch { oldResourceDeleted = false; }
    return json(req, {
      ok: true,
      photo: normalizeResource(uploaded, cloudName, rootFolder, saved),
      warning: oldResourceDeleted ? '' : 'La nuova foto è salvata, ma la vecchia risorsa Cloudinary richiede pulizia manuale.',
    });
  } catch (error) {
    await cloudinaryDestroy(uploaded.public_id).catch(() => undefined);
    throw error;
  }
}

async function deleteResource(req: Request) {
  const body = await req.json().catch(() => ({}));
  const photoId = String(body.photoId || body.publicId || body.path || '').trim();
  const photo = await resolvePhoto(photoId);
  const metadata = await findMetadata(photo.publicId);
  if (metadata) await deleteMetadata(metadata.id);
  try {
    await cloudinaryDestroy(photo.publicId);
  } catch (error) {
    if (metadata) await insertMetadata(metadata).catch(() => undefined);
    throw error;
  }
  return json(req, { ok: true, publicId: photo.publicId, message: 'Foto eliminata.' });
}

async function downloadOriginal(req: Request) {
  const url = new URL(req.url);
  const photo = await resolvePhoto(url.searchParams.get('photoId') || '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(photo.originalUrl, { signal: controller.signal });
    if (!response.ok) throw new HttpError(response.status, 'ORIGINAL_UNAVAILABLE', 'Originale non disponibile su Cloudinary.');
    const bytes = await response.arrayBuffer();
    return binary(req, bytes, 200, {
      'Content-Type': photo.mimeType || response.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(photo.name))}`,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new HttpError(504, 'DOWNLOAD_TIMEOUT', 'Download dell’originale scaduto.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueZipName(name: string, used: Set<string>) {
  const safe = safeFileName(name);
  if (!used.has(safe)) { used.add(safe); return safe; }
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let index = 2;
  let candidate = `${stem}_${index}${ext}`;
  while (used.has(candidate)) candidate = `${stem}_${++index}${ext}`;
  used.add(candidate);
  return candidate;
}

async function downloadZip(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((value: unknown) => String(value || '').trim()).filter(Boolean))] : [];
  const teamId = safeText(body.teamId, 80);
  if (!ids.length) throw new HttpError(400, 'ZIP_EMPTY', 'Seleziona almeno una foto per lo ZIP.');
  if (ids.length > MAX_ZIP_FILES) throw new HttpError(413, 'ZIP_TOO_LARGE', `Lo ZIP può contenere al massimo ${MAX_ZIP_FILES} foto.`);
  const photos = await Promise.all(ids.map((id: string) => resolvePhoto(id)));
  const expectedBytes = photos.reduce((sum, photo) => sum + Number(photo.originalSize || photo.size || photo.bytes || 0), 0);
  if (expectedBytes > MAX_ZIP_BYTES) throw new HttpError(413, 'ZIP_TOO_LARGE', 'La selezione supera il limite ZIP di 150 MB. Riduci il numero di foto.');
  if (teamId && photos.some((photo) => photo.teamId !== teamId)) throw new HttpError(403, 'ZIP_SCOPE', 'La selezione contiene foto di una squadra differente.');
  const zip = new JSZip();
  const used = new Set<string>();
  const failures: string[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < photos.length) {
      const photo = photos[cursor++];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch(photo.originalUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        zip.file(uniqueZipName(photo.name, used), bytes, { binary: true, compression: 'STORE' });
      } catch {
        failures.push(photo.name);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker));
  if (failures.length) throw new HttpError(502, 'ZIP_INCOMPLETE', `ZIP non creato: ${failures.length} originali non sono disponibili.`, { failures });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  const archiveName = safeFileName(`${safeText(body.teamName, 80) || 'foto-squadra'}-originali.zip`, 'foto-originali.zip');
  return binary(req, bytes, 200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(bytes.byteLength),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
  });
}

async function route(req: Request) {
  ensureOriginAllowed(req);
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  if (req.method === 'GET' && action === 'health') return json(req, configurationHealth(req));
  if (ADMIN_METHODS.has(req.method) && action !== 'zip') await requireAdmin(req);
  if (req.method === 'GET' && action === 'download') return downloadOriginal(req);
  if (req.method === 'GET' && action === 'detail') return json(req, { ok: true, photo: await resolvePhoto(url.searchParams.get('photoId') || '') });
  if (req.method === 'GET') return listResources(req);
  if (req.method === 'POST' && action === 'zip') return downloadZip(req);
  if (req.method === 'POST') return uploadResources(req);
  if (req.method === 'PUT') return replaceResource(req);
  if (req.method === 'PATCH') return updateMetadata(req);
  if (req.method === 'DELETE') return deleteResource(req);
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Metodo non supportato.');
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') {
    try {
      ensureOriginAllowed(req);
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    } catch (error) {
      const httpError = error instanceof HttpError ? error : new HttpError(500, 'PREFLIGHT_FAILED', 'Preflight non riuscita.');
      return json(req, { ok: false, code: httpError.code, message: httpError.message }, httpError.status);
    }
  }
  try {
    const response = await route(req);
    console.info(JSON.stringify({ scope: 'team-photos', method: req.method, action: new URL(req.url).searchParams.get('action') || 'default', status: response.status, durationMs: Date.now() - startedAt }));
    return response;
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Errore funzione team-photos.');
    console.error(JSON.stringify({ scope: 'team-photos', method: req.method, action: new URL(req.url).searchParams.get('action') || 'default', status: httpError.status, code: httpError.code, durationMs: Date.now() - startedAt }));
    return json(req, { ok: false, code: httpError.code, message: httpError.message, details: httpError.details || undefined }, httpError.status);
  }
});
