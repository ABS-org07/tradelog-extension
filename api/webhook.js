// TradeLog — Cashfree payment webhook
// Vercel serverless function: api/webhook.js
//
// Flow:
//   Cashfree fires POST to /api/webhook on successful payment
//   → verify signature
//   → generate signed license key (encodes plan + expiry)
//   → email key to customer via Resend
//   → return 200

import crypto from 'crypto';

// ── CONFIG (set these as Vercel env vars) ────────────────────────────────────
const CF_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET; // from Cashfree dashboard
const LICENSE_SECRET    = process.env.LICENSE_SECRET;           // any long random string you choose
const RESEND_API_KEY    = process.env.RESEND_API_KEY;           // from resend.com
const FROM_EMAIL        = process.env.FROM_EMAIL || 'TradeLog <noreply@yourdomain.com>';

// ── PLAN CONFIG ──────────────────────────────────────────────────────────────
// Map Cashfree order amounts (in paise) to plan type
// ₹149 monthly = 14900 paise, ₹999 lifetime = 99900 paise
// $3 / $15 Gumroad handled separately (Gumroad has its own webhook)
const PLAN_BY_AMOUNT = {
  14900:  { type: 'monthly',  days: 32 },   // 32 days gives a small grace period
  99900:  { type: 'lifetime', days: 36500 }, // 100 years = lifetime
  300:    { type: 'monthly',  days: 32 },    // $3 USD in cents (Gumroad)
  1500:   { type: 'lifetime', days: 36500 }, // $15 USD in cents (Gumroad)
};

// ── GENERATE LICENSE KEY ─────────────────────────────────────────────────────
// Format: TL-<BASE64(plan|expiry_ts)>-<HMAC_8_chars>
// The extension validates HMAC locally — no server call needed at activation time
function generateKey(plan, days) {
  const expiryTs = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload  = `${plan}|${expiryTs}`;
  const b64      = Buffer.from(payload).toString('base64url');
  const hmac     = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `TL-${b64}-${hmac}`;
}

// ── VERIFY CASHFREE WEBHOOK SIGNATURE ───────────────────────────────────────
// Cashfree signs with: HMAC-SHA256(timestamp + rawBody, secret)
// Header: x-webhook-signature, x-webhook-timestamp
function verifyCashfreeSignature(rawBody, timestamp, signature) {
  const data     = timestamp + rawBody;
  const expected = crypto
    .createHmac('sha256', CF_WEBHOOK_SECRET)
    .update(data)
    .digest('base64');
  return expected === signature;
}

// ── SEND EMAIL VIA RESEND ────────────────────────────────────────────────────
async function sendLicenseEmail(toEmail, toName, licenseKey, plan, expiryDate) {
  const planLabel = plan === 'lifetime' ? 'Lifetime' : 'Monthly';
  const expiryStr = plan === 'lifetime'
    ? 'Never expires'
    : `Valid until ${expiryDate}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#0B0D0F;color:#E7EDE9;padding:40px 24px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:32px">
    <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="width:28px;height:28px;border-radius:8px;background:#0D8B67;display:inline-flex;align-items:center;justify-content:center">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><polyline points="1,11 4.5,7 7.5,9 11,4 13,5" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <span style="font-weight:600;font-size:15px">TradeLog</span>
    </div>
  </div>

  <h1 style="font-size:22px;font-weight:600;letter-spacing:-.03em;margin:0 0 8px">Your Pro license key</h1>
  <p style="color:#929B9A;font-size:14px;margin:0 0 32px">Thanks ${toName || ''}! Here's your TradeLog Pro ${planLabel} key.</p>

  <div style="background:#15191A;border:1px solid #252D2B;border-radius:12px;padding:20px 20px 16px">
    <div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#606B68;margin-bottom:8px">License Key</div>
    <div style="font-family:'Courier New',monospace;font-size:17px;font-weight:600;color:#35C995;letter-spacing:.04em;word-break:break-all">${licenseKey}</div>
    <div style="margin-top:12px;font-size:12px;color:#606B68">${expiryStr}</div>
  </div>

  <div style="margin-top:28px">
    <p style="font-size:14px;font-weight:600;margin:0 0 12px">How to activate:</p>
    <ol style="font-size:13px;color:#929B9A;line-height:1.8;padding-left:20px;margin:0">
      <li>Open TradeLog in Chrome</li>
      <li>Click the <strong style="color:#E7EDE9">Debrief</strong> tab</li>
      <li>Scroll to <strong style="color:#E7EDE9">Activate License</strong></li>
      <li>Paste your key and click Activate</li>
    </ol>
  </div>

  <div style="margin-top:32px;padding-top:24px;border-top:1px solid #1E2524;font-size:12px;color:#606B68">
    Questions? Reply to this email.<br>
    Your data is stored locally and never leaves your browser.
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [toEmail],
      subject: `Your TradeLog Pro ${planLabel} key`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Collect raw body for signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // ── Cashfree webhook ──────────────────────────────────────────────────────
  if (body.data?.order) {
    const timestamp = req.headers['x-webhook-timestamp'];
    const signature = req.headers['x-webhook-signature'];

    if (CF_WEBHOOK_SECRET && timestamp && signature) {
      if (!verifyCashfreeSignature(rawBody, timestamp, signature)) {
        console.error('Cashfree signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event  = body.type;         // e.g. "PAYMENT_SUCCESS_WEBHOOK"
    const order  = body.data.order;
    const payment= body.data.payment;

    if (event !== 'PAYMENT_SUCCESS_WEBHOOK') {
      // Not a success event — acknowledge and ignore
      return res.status(200).json({ ok: true });
    }

    const amountPaise = Math.round(parseFloat(order.order_amount) * 100);
    const plan = PLAN_BY_AMOUNT[amountPaise];

    if (!plan) {
      console.warn(`Unknown amount: ${amountPaise} paise`);
      return res.status(200).json({ ok: true, note: 'Unknown amount' });
    }

    // Extract customer info from order tags or customer object
    const customerEmail = body.data.customer_details?.customer_email
                       || order.order_tags?.email;
    const customerName  = body.data.customer_details?.customer_name
                       || order.order_tags?.name
                       || '';

    if (!customerEmail) {
      console.error('No customer email in payload', JSON.stringify(body));
      return res.status(200).json({ ok: true, note: 'No email found' });
    }

    const key      = generateKey(plan.type, plan.days);
    const expiry   = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);
    const expiryFmt= expiry.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

    try {
      await sendLicenseEmail(customerEmail, customerName, key, plan.type, expiryFmt);
      console.log(`License sent to ${customerEmail} — ${plan.type} — key: ${key}`);
    } catch (err) {
      console.error('Email send failed:', err.message);
      // Still return 200 so Cashfree doesn't retry — log manually
    }

    return res.status(200).json({ ok: true });
  }

  // ── Gumroad webhook (ping) ───────────────────────────────────────────────
  // Gumroad sends form-encoded data; this handles the JSON ping variant
  if (body.seller_id || body.product_permalink) {
    if (body.refunded || body.chargebacked) {
      return res.status(200).json({ ok: true, note: 'Refund — no key sent' });
    }

    const amountCents = Math.round(parseFloat(body.price || 0));
    const plan = PLAN_BY_AMOUNT[amountCents];

    const customerEmail = body.email;
    const customerName  = body.full_name || '';

    if (!customerEmail || !plan) {
      return res.status(200).json({ ok: true, note: 'Skipped' });
    }

    const key      = generateKey(plan.type, plan.days);
    const expiry   = new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000);
    const expiryFmt= expiry.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

    try {
      await sendLicenseEmail(customerEmail, customerName, key, plan.type, expiryFmt);
      console.log(`[Gumroad] License sent to ${customerEmail} — ${plan.type}`);
    } catch (err) {
      console.error('[Gumroad] Email send failed:', err.message);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true, note: 'Unrecognised payload' });
}
