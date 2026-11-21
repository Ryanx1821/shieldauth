// Vercel Serverless Function: /api/licenses
// Shared per-application license pool for ShieldAuth Owners, Teams, and Resellers.
// Uses Upstash Redis / Vercel KV when connected, with in-memory fallback.

const MEMORY_LICENSES = globalThis.__shieldauthLicenses || new Map();
globalThis.__shieldauthLicenses = MEMORY_LICENSES;

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redisGet(key) {
  const cfg = getRedisConfig();
  if (!cfg) return MEMORY_LICENSES.get(key) || [];
  const resp = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${cfg.token}` }
  });
  const data = await resp.json();
  if (!data || !data.result) return [];
  try {
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  } catch {
    return [];
  }
}

async function redisSet(key, value) {
  const cfg = getRedisConfig();
  if (!cfg) {
    MEMORY_LICENSES.set(key, value);
    return;
  }
  await fetch(`${cfg.url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(JSON.stringify(value))
  });
}

function appKey(appId) {
  return `shieldauth:licenses:app:${String(appId || '').trim()}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // GET /api/licenses?appId=app_xxx&requester=email&isOwner=1
    if (req.method === 'GET') {
      const appId = String(req.query.appId || '').trim();
      const requester = String(req.query.requester || '').trim().toLowerCase();
      const isOwner = req.query.isOwner === '1';
      if (!appId) {
        res.status(400).json({ error: 'Missing appId' });
        return;
      }

      const all = await redisGet(appKey(appId));
      const scoped = isOwner
        ? all
        : all.filter((l) => String(l.createdBy || '').toLowerCase() === requester);

      res.status(200).json({ licenses: scoped });
      return;
    }

    // POST /api/licenses — append newly generated licenses for an app
    if (req.method === 'POST') {
      const { appId, licenses } = req.body || {};
      if (!appId || !Array.isArray(licenses) || !licenses.length) {
        res.status(400).json({ error: 'Missing appId or licenses array' });
        return;
      }
      const existing = await redisGet(appKey(appId));
      const existingKeys = new Set(existing.map((l) => l.key));
      const toAdd = licenses.filter((l) => l && l.key && !existingKeys.has(l.key));
      const next = [...toAdd, ...existing];
      await redisSet(appKey(appId), next);
      res.status(200).json({ ok: true, count: toAdd.length });
      return;
    }

    // PATCH /api/licenses — update a license (status, expiry, note, level, usedBy)
    if (req.method === 'PATCH') {
      const { appId, key, updates } = req.body || {};
      if (!appId || !key || !updates) {
        res.status(400).json({ error: 'Missing appId, key, or updates' });
        return;
      }
      const existing = await redisGet(appKey(appId));
      const next = existing.map((l) => (l.key === key ? { ...l, ...updates } : l));
      await redisSet(appKey(appId), next);
      res.status(200).json({ ok: true });
      return;
    }

    // DELETE /api/licenses — remove one or more keys
    if (req.method === 'DELETE') {
      const { appId, keys } = req.body || {};
      if (!appId || !Array.isArray(keys)) {
        res.status(400).json({ error: 'Missing appId or keys' });
        return;
      }
      const removeSet = new Set(keys);
      const existing = await redisGet(appKey(appId));
      const next = existing.filter((l) => !removeSet.has(l.key));
      await redisSet(appKey(appId), next);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
}
