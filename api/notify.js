/* Email notifier for the Negotiation Desk.
   POST { event, appId, region, raOwner, raEmail, car, price, tp, ask, offer, gap, appUrl }
   - event 'ncd_price'        → RA logged an NCD price  → email the PRICE MANAGER
   - event 'pricing_response'  → Pricing quoted a price  → email the car's RA
   Env: RESEND_API_KEY (required), PRICE_MANAGER_EMAIL (required for ncd_price), MAIL_FROM (recommended). */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // robust body read
    let body = req.body;
    if (!(body && typeof body === 'object')) {
      if (typeof body === 'string' && body.length) body = JSON.parse(body);
      else { const ch = []; for await (const c of req) ch.push(c); const raw = Buffer.concat(ch).toString('utf8'); body = raw ? JSON.parse(raw) : {}; }
    }

    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM || 'Negotiation Desk <onboarding@resend.dev>';
    if (!key) return res.status(500).json({ error: 'RESEND_API_KEY not set — add it in Vercel env.' });

    let to, subject, html;
    if (body.event === 'ncd_price') {
      to = process.env.PRICE_MANAGER_EMAIL;
      if (!to) return res.status(200).json({ skipped: 'PRICE_MANAGER_EMAIL not set' });
      subject = `[Nego] ${body.appId} — NCD price ${rupee(body.price)} · Pricing to respond`;
      html = emailHtml({ title: 'NCD price updated — Pricing to respond', who: 'Pricing', priceLabel: 'New NCD price', body });
    } else if (body.event === 'pricing_response') {
      to = body.raEmail;
      if (!to) return res.status(200).json({ skipped: 'no RA email on this car' });
      subject = `[Nego] ${body.appId} — Pricing quoted ${rupee(body.price)} · your move`;
      html = emailHtml({ title: 'Pricing responded — RA to respond', who: 'RA', priceLabel: 'Our offer', body });
    } else {
      return res.status(400).json({ error: 'unknown event' });
    }

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html })
    });
    const data = await send.json();
    if (!send.ok) { console.error('resend error:', data); return res.status(502).json({ error: data && data.message ? data.message : 'send failed' }); }
    return res.status(200).json({ sent: true, to });
  } catch (e) {
    console.error('notify FAILED:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}

function rupee(v) {
  if (v == null || v === '') return '—';
  v = Number(v);
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
  return '₹' + v.toLocaleString('en-IN');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function emailHtml({ title, who, priceLabel, body }) {
  const row = (k, v) => `<tr><td style="padding:4px 14px 4px 0;color:#888;font-size:13px">${k}</td><td style="padding:4px 0;font-weight:600;font-size:14px">${v}</td></tr>`;
  const link = body.appUrl || '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:520px">
    <h2 style="margin:0 0 4px;font-size:18px">${esc(title)}</h2>
    <p style="margin:0 0 14px;color:#555;font-size:13px">Appointment <b>${esc(body.appId)}</b> &middot; ${esc(body.car || '')} &middot; ${esc(body.region || '—')}</p>
    <table style="border-collapse:collapse">
      ${row(priceLabel, rupee(body.price))}
      ${row('Target Price (internal)', rupee(body.tp))}
      ${row('Latest NCD ask', rupee(body.ask))}
      ${row('Latest our offer', rupee(body.offer))}
      ${row('Gap', rupee(body.gap))}
      ${row('RA', esc(body.raOwner || '—'))}
    </table>
    ${link ? `<p style="margin:18px 0 0"><a href="${esc(link)}" style="background:#1a1a1a;color:#fff;padding:9px 16px;border-radius:4px;text-decoration:none;font-size:13px">Open Negotiation Desk &rarr;</a></p>` : ''}
    <p style="margin:14px 0 0;font-size:12px;color:#999">${esc(who)} to respond next.</p>
  </div>`;
}
