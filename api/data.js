import { list, put } from '@vercel/blob';

const DATA_PATH = 'nego-data.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Find the Blob token whatever Vercel named it (plain or prefixed like xyz_BLOB_READ_WRITE_TOKEN)
  const token = process.env.BLOB_READ_WRITE_TOKEN
    || process.env[Object.keys(process.env).find(k => k.endsWith('BLOB_READ_WRITE_TOKEN')) || ''];
  if (!token) {
    return res.status(500).json({ error: 'No Blob token found — attach a Blob store to this project, then redeploy.' });
  }

  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: DATA_PATH, token });
      const match = blobs.find(b => b.pathname === DATA_PATH);
      if (!match) return res.status(200).json({ meta: { lastUpdated: null }, regions: [], negotiations: [] });
      const r = await fetch(match.url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      // Read body robustly — req.body may be an object, a string, or unparsed (read raw stream)
      let body = req.body;
      if (body && typeof body === 'object') {
        // already parsed
      } else if (typeof body === 'string' && body.length) {
        body = JSON.parse(body);
      } else {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw ? JSON.parse(raw) : null;
      }
      if (!body || !Array.isArray(body.negotiations)) {
        return res.status(400).json({ error: 'Invalid payload — expected { negotiations: [...] }' });
      }

      // Backup current version before overwriting (timestamped, non-fatal if it fails)
      try {
        const { blobs } = await list({ prefix: DATA_PATH, token });
        const existing = blobs.find(b => b.pathname === DATA_PATH);
        if (existing) {
          const cur = await (await fetch(existing.url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })).text();
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          await put(`backups/nego-data-${ts}.json`, cur, {
            access: 'private', token, addRandomSuffix: false, contentType: 'application/json'
          });
        }
      } catch (e) { console.warn('backup skipped:', e?.message || e); }

      const stamped = { ...body, meta: { ...(body.meta || {}), lastUpdated: new Date().toISOString() } };
      await put(DATA_PATH, JSON.stringify(stamped), {
        access: 'private', token, addRandomSuffix: false, contentType: 'application/json', allowOverwrite: true
      });
      return res.status(200).json({ ok: true, lastUpdated: stamped.meta.lastUpdated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('api/data FAILED:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
