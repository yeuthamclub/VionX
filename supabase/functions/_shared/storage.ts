// Supabase Storage through its HTTP API with the service role (buckets used here are private and
// have no storage.objects policies, so clients can only use signed URLs we hand out).

export interface ObjectStorage {
  upload(bucket: string, path: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Absolute URL that downloads `path` until it expires. */
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export const PRIVACY_EXPORT_BUCKET = 'privacy-exports';

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class SupabaseStorage implements ObjectStorage {
  private readonly fetch: typeof fetch;

  constructor(
    private readonly options: {
      /** Internal URL the function reaches Supabase on (SUPABASE_URL). */
      url: string;
      serviceRoleKey: string;
      /** URL clients use; signed links are built on it (VIONX_PUBLIC_SUPABASE_URL). */
      publicUrl: string;
      fetch?: typeof fetch;
    },
  ) {
    this.fetch = options.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.options.serviceRoleKey,
      authorization: `Bearer ${this.options.serviceRoleKey}`,
      ...extra,
    };
  }

  private async check(res: Response, what: string): Promise<void> {
    if (res.ok) {
      await res.body?.cancel();
      return;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`storage ${what} failed: ${res.status} ${text.slice(0, 200)}`);
  }

  async upload(bucket: string, path: string, body: Uint8Array, contentType: string) {
    const res = await this.fetch(
      `${this.options.url}/storage/v1/object/${bucket}/${encodePath(path)}`,
      {
        method: 'POST',
        headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
        body: body as BodyInit,
      },
    );
    await this.check(res, 'upload');
  }

  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number) {
    const res = await this.fetch(
      `${this.options.url}/storage/v1/object/sign/${bucket}/${encodePath(path)}`,
      {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    );
    if (!res.ok) await this.check(res, 'sign');
    const json = (await res.json()) as { signedURL?: string };
    if (!json.signedURL) throw new Error('storage sign returned no URL');
    return `${this.options.publicUrl.replace(/\/+$/, '')}/storage/v1${json.signedURL}`;
  }

  async remove(bucket: string, paths: string[]) {
    if (paths.length === 0) return;
    const res = await this.fetch(`${this.options.url}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
    });
    await this.check(res, 'remove');
  }
}

/** In-memory storage for unit tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async upload(bucket: string, path: string, body: Uint8Array, contentType: string) {
    this.objects.set(`${bucket}/${path}`, { body, contentType });
  }

  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number) {
    if (!this.objects.has(`${bucket}/${path}`)) throw new Error('object not found');
    return `memory://${bucket}/${path}?expiresIn=${expiresInSeconds}`;
  }

  async remove(bucket: string, paths: string[]) {
    for (const p of paths) this.objects.delete(`${bucket}/${p}`);
  }
}
