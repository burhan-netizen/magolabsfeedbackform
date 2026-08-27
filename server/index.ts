import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { FeedbackSubmission } from '../src/types';

const app = express();
app.use(express.json({ limit: '2mb' }));

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.FEEDBACK_TO_EMAIL || 'burhan@magolabs.in';
// Must be an address on a domain you've verified in Resend. Falls back to
// Resend's shared sandbox sender, which only works for the account owner's
// own inbox — swap in a verified magolabs.in address once you've verified
// the domain in the Resend dashboard.
const FROM_EMAIL = process.env.FEEDBACK_FROM_EMAIL || 'Mago Labs Feedback <onboarding@resend.dev>';

const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(5 - Math.max(0, Math.min(5, n)));

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function renderFeedbackEmail(payload: FeedbackSubmission): string {
  const { client, ratings, feedback, testimonial, referrals } = payload;

  const ratingRows = Object.entries(ratings)
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding:4px 12px 4px 0;color:#52525b;text-transform:capitalize;">${esc(key)}</td>
          <td style="padding:4px 0;color:#18181b;font-weight:600;">${stars(Number(value))} (${esc(value)}/5)</td>
        </tr>`
    )
    .join('');

  const referralRows = (referrals || [])
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 10px;border:1px solid #e4e4e7;">${esc(r.name)}</td>
          <td style="padding:6px 10px;border:1px solid #e4e4e7;">${esc(r.company)}</td>
          <td style="padding:6px 10px;border:1px solid #e4e4e7;">${esc(r.phone)}</td>
          <td style="padding:6px 10px;border:1px solid #e4e4e7;">${esc(r.service)}</td>
        </tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#18181b;">
    <h2 style="margin-bottom:4px;">New client feedback submitted</h2>
    <p style="color:#71717a;margin-top:0;">via Mago Labs Client Feedback Portal</p>

    <h3 style="margin-bottom:4px;">Client</h3>
    <p style="margin:0;">
      <strong>${esc(client.name)}</strong> — ${esc(client.company)}<br/>
      <a href="mailto:${esc(client.email)}">${esc(client.email)}</a>
    </p>

    <h3 style="margin-bottom:4px;margin-top:20px;">Ratings</h3>
    <table style="border-collapse:collapse;">${ratingRows}</table>

    <h3 style="margin-bottom:4px;margin-top:20px;">Feedback</h3>
    <p style="margin:0 0 8px;"><strong>What they liked:</strong><br/>${esc(feedback.liked).replace(/\n/g, '<br/>')}</p>
    <p style="margin:0 0 8px;"><strong>What could improve:</strong><br/>${esc(feedback.improvements).replace(/\n/g, '<br/>')}</p>
    <p style="margin:0;"><strong>Would recommend Mago Labs:</strong> ${esc(feedback.recommendation)}</p>

    ${
      testimonial?.text
        ? `<h3 style="margin-bottom:4px;margin-top:20px;">Testimonial</h3>
           <p style="margin:0;font-style:italic;">"${esc(testimonial.text)}"</p>
           <p style="margin:4px 0 0;color:#71717a;">Permission to use publicly: ${testimonial.permission ? 'Yes' : 'No'}</p>`
        : ''
    }

    ${
      referrals && referrals.length
        ? `<h3 style="margin-bottom:4px;margin-top:20px;">Referrals (${referrals.length})</h3>
           <table style="border-collapse:collapse;width:100%;">
             <tr style="background:#f4f4f5;">
               <th style="padding:6px 10px;border:1px solid #e4e4e7;text-align:left;">Name</th>
               <th style="padding:6px 10px;border:1px solid #e4e4e7;text-align:left;">Company</th>
               <th style="padding:6px 10px;border:1px solid #e4e4e7;text-align:left;">Phone</th>
               <th style="padding:6px 10px;border:1px solid #e4e4e7;text-align:left;">Service</th>
             </tr>
             ${referralRows}
           </table>`
        : ''
    }

    <p style="margin-top:24px;color:#a1a1aa;font-size:12px;">Submitted ${esc(payload.submittedAt || new Date().toISOString())}</p>
  </div>`;
}

app.post('/api/submit-feedback', async (req, res) => {
  try {
    const payload = req.body as FeedbackSubmission;

    if (!payload?.client?.email || !payload?.client?.name) {
      return res.status(400).json({ success: false, error: 'Missing required client info' });
    }

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set on the server');
      return res.status(500).json({ success: false, error: 'Email service is not configured' });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: payload.client.email,
        subject: `New client feedback — ${payload.client.name} (${payload.client.company || 'N/A'})`,
        html: renderFeedbackEmail(payload),
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend API error:', resendRes.status, errText);
      return res.status(502).json({ success: false, error: 'Failed to send email' });
    }

    const data = (await resendRes.json()) as { id: string };
    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('submit-feedback error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Serve the built frontend in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(PORT, () => {
  console.log(`Mago Labs feedback server listening on port ${PORT}`);
});
