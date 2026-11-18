// Import reviewed library packages through the API (dry-run, then apply), as a throwaway
// CONTENT_ADMIN that is deleted afterwards. Needs `pnpm fn:serve`.
//   pnpm cloud npx tsx scripts/import-reviewed.ts [--apply] <package dir>...
// Without --apply only the dry-run runs.
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { signUpWithEmail } from './lib/local-supabase.ts';
import { zipPackageDir } from './lib/library-files.ts';
import { connectDb, env } from './acceptance/lib.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dirs = args.filter((a) => a !== '--apply');
if (!dirs.length) throw new Error('usage: import-reviewed.ts [--apply] <package dir>...');

interface DiffCounts {
  added: string[];
  updated: string[];
  archived: string[];
  unchanged: number;
}
interface ImportBody {
  applied?: boolean;
  noop?: boolean;
  code?: string;
  message?: string;
  diff?: Record<string, DiffCounts>;
  warnings?: unknown[];
}

function postZip(url: string, token: string, zip: Uint8Array) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/zip',
          'content-length': zip.byteLength,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on('error', reject);
    req.end(zip);
  });
}

const sql = connectDb();
// Throwaway admins left by an interrupted run.
await sql`delete from auth.users where email like 'import-%@vionx.test'`;
const admin = await signUpWithEmail(`import-${randomUUID()}@vionx.test`, `pw-${randomUUID()}`);
let failed = false;
try {
  await sql`insert into ops.admin_permissions (user_id, permission) values (${admin.userId}, 'CONTENT_ADMIN')`;
  const post = async (dir: string, mode: string) => {
    // The function worker sometimes answers WORKER_LIMIT on a large package; retry once.
    for (let attempt = 1; ; attempt++) {
      // node:http, not fetch: applying a large package to the cloud database takes over fetch's
      // 300 s headers timeout.
      const res = await postZip(
        `${env.functionsUrl}/api/v1/admin/library/import?mode=${mode}`,
        admin.accessToken,
        zipPackageDir(dir),
      );
      let body: ImportBody;
      try {
        body = JSON.parse(res.text) as ImportBody;
      } catch {
        body = { message: res.text.slice(0, 500) };
      }
      if (res.status === 200 || attempt === 2 || body.code !== 'WORKER_LIMIT')
        return { status: res.status, body };
    }
  };
  for (const dir of dirs) {
    for (const mode of apply ? ['dry-run', 'apply'] : ['dry-run']) {
      const { status, body } = await post(dir, mode);
      const diff = Object.entries(body.diff ?? {})
        .map(
          ([k, d]) =>
            `${k} +${d.added.length} ~${d.updated.length} -${d.archived.length} =${d.unchanged}`,
        )
        .join(', ');
      console.log(`${dir} ${mode}: ${status} applied=${body.applied} noop=${body.noop} ${diff}`);
      if (body.warnings?.length)
        console.log('  warnings:', JSON.stringify(body.warnings).slice(0, 600));
      if (status !== 200) {
        console.log('  error:', JSON.stringify(body).slice(0, 1500));
        failed = true;
        break;
      }
    }
  }
} finally {
  await sql`delete from auth.users where id = ${admin.userId}`;
  await sql.end();
}
process.exit(failed ? 1 : 0);
