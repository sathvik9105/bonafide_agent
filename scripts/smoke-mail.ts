// Phase 0 smoke test: nodemailer sends to yourself, imapflow connects and lists the inbox.
// Run: node --env-file=.env scripts/smoke-mail.ts
// Sends only to GMAIL_USER (the account's own address). Never to a third party.
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

async function smokeSend(user: string, pass: string, token: string): Promise<boolean> {
  const t0 = Date.now();
  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transport.verify();
    const info = await transport.sendMail({
      from: `"${process.env.MAIL_FROM_NAME ?? 'BonaFide'}" <${user}>`,
      to: user,
      subject: `BonaFide smoke test ${token}`,
      text: 'Phase 0 smoke test. Safe to delete.',
    });
    console.log(`[send] PASS ${Date.now() - t0}ms messageId=${info.messageId}`);
    return true;
  } catch (e) {
    console.log(`[send] FAIL ${(e as Error).message}`);
    return false;
  }
}

async function smokeRead(user: string, pass: string, token: string): Promise<boolean> {
  const t0 = Date.now();
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists : 0;
      console.log(`[imap] connected, INBOX exists=${status}`);
      const total = typeof status === 'number' ? status : 0;
      const from = Math.max(1, total - 4);
      if (total > 0) {
        for await (const msg of client.fetch(`${from}:*`, { envelope: true })) {
          console.log(`  #${msg.seq} ${msg.envelope?.subject ?? '(no subject)'}`);
        }
      }
      // Gmail can take a few seconds to deliver the self-send; search for the token.
      let found = false;
      for (let i = 0; i < 6 && !found; i++) {
        const hits = await client.search({ subject: token });
        found = Array.isArray(hits) && hits.length > 0;
        if (!found) await new Promise((r) => setTimeout(r, 5000));
      }
      console.log(`[imap] PASS ${Date.now() - t0}ms, self-sent token ${found ? 'found' : 'NOT found within 30s'}`);
    } finally {
      lock.release();
    }
    await client.logout();
    return true;
  } catch (e) {
    console.log(`[imap] FAIL ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('FAIL GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env');
    process.exit(1);
  }
  const token = `[BF-smoke-${Date.now().toString(36)}]`;
  const sent = await smokeSend(user, pass, token);
  const read = await smokeRead(user, pass, token);
  console.log(`\nRESULT: send ${sent ? 'PASS' : 'FAIL'}, imap ${read ? 'PASS' : 'FAIL'}`);
  process.exit(sent && read ? 0 : 1);
}

main();
