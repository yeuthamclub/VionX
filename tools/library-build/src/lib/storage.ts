// Supabase Storage over HTTP with the service role (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY):
// reading source PDFs from the private `sources` bucket and uploading built packages.
function env() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage');
  return { url, headers: { authorization: `Bearer ${key}`, apikey: key } };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export async function listObjects(bucket: string, prefix: string): Promise<string[]> {
  const { url, headers } = env();
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!res.ok)
    throw new Error(`storage list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { name: string; id: string | null }[];
  return rows.filter((r) => r.id !== null).map((r) => `${prefix.replace(/\/?$/, '/')}${r.name}`);
}

export async function downloadObject(bucket: string, path: string): Promise<Uint8Array> {
  const { url, headers } = env();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodePath(path)}`, { headers });
  if (!res.ok) throw new Error(`storage download ${bucket}/${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadObject(
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType: string,
) {
  const { url, headers } = env();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${encodePath(path)}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': contentType, 'x-upsert': 'true' },
    body: body as BodyInit,
  });
  if (!res.ok)
    throw new Error(`storage upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
}
