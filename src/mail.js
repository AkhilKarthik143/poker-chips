export function createMailer({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM,
  production = process.env.NODE_ENV === 'production' } = {}) {
  if (apiKey && from) return { enabled: true, async send(email, url) {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: 'Your Tablemate sign-in link',
        text: `Open ${url} to sign in. This link expires in 15 minutes.` }) });
    if (!response.ok) throw new Error(`Mail delivery failed (${response.status})`);
  } };
  if (production) return { enabled: false, async send() {} };
  return { enabled: true, async send(email, url) { process.stdout.write(`Tablemate sign-in link for ${email}: ${url}\n`); } };
}
