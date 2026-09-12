// Email transport: nodemailer sends, imapflow reads. MAIL_MODE=dry never sends anything.
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

export type MailMode = 'dry' | 'live';

export function mailMode(): MailMode {
  return process.env.MAIL_MODE?.trim() === 'live' ? 'live' : 'dry';
}

function credentials(): { user: string; pass: string } | null {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();
  return user && pass ? { user, pass } : null;
}

export function mailConfigured(): boolean {
  return credentials() !== null;
}

const smtpHost = () => process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
const imapHost = () => process.env.IMAP_HOST?.trim() || 'imap.gmail.com';

export type OutgoingEmail = { to: string; subject: string; text: string };
export type SendResult = { delivered: boolean; deliveredTo: string | null; reason: string };

/**
 * Sends only when MAIL_MODE=live AND this run opted in. Otherwise the message is logged and not sent.
 * MAIL_REDIRECT_TO, when set, receives every live email instead of the real recipient.
 */
export async function sendEmail(msg: OutgoingEmail, opts: { live: boolean }): Promise<SendResult> {
  const mode = mailMode();
  if (mode !== 'live' || !opts.live) {
    const reason = mode !== 'live' ? 'MAIL_MODE=dry' : 'live sending was not requested for this run';
    console.log(`[mail:dry] not sent (${reason})\n  to: ${msg.to}\n  subject: ${msg.subject}\n${msg.text.replace(/^/gm, '  | ')}`);
    return { delivered: false, deliveredTo: null, reason };
  }

  const creds = credentials();
  if (!creds) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set to send email');
  const redirect = process.env.MAIL_REDIRECT_TO?.trim() || null;
  const to = redirect ?? msg.to;
  const transport = nodemailer.createTransport({
    host: smtpHost(),
    port: 465,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
  });
  const fromName = process.env.MAIL_FROM_NAME?.trim();
  await transport.sendMail({
    from: fromName ? `"${fromName}" <${creds.user}>` : creds.user,
    to,
    subject: msg.subject,
    text: msg.text,
  });
  console.log(`[mail:live] sent to ${to}${redirect ? ` (redirected from ${msg.to})` : ''}: ${msg.subject}`);
  return { delivered: true, deliveredTo: to, reason: 'sent' };
}

export type InboundReply = { token: string; from: string | null; subject: string; text: string; receivedAt: number };

const TOKEN = /\[BF-([0-9a-f]{6})\]/i;

type StructureNode = { part?: string; type?: string; childNodes?: StructureNode[] };

function findPart(node: StructureNode | undefined, type: string): string | null {
  if (!node) return null;
  if (node.type?.toLowerCase() === type) return node.part ?? '1';
  for (const child of node.childNodes ?? []) {
    const part = findPart(child, type);
    if (part) return part;
  }
  return null;
}

async function readStream(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<(br|\/p|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** INBOX messages whose subject carries one of the given [BF-xxxxxx] tokens. Read-only. */
export async function fetchReplies(opts: { tokens: Set<string>; since: Date }): Promise<InboundReply[]> {
  const creds = credentials();
  if (!creds) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set to read replies');
  const self = creds.user.toLowerCase();
  const client = new ImapFlow({
    host: imapHost(),
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // One search per token keeps this cheap on a busy personal inbox.
      const uids = new Set<number>();
      for (const token of opts.tokens) {
        const hits = await client.search({ since: opts.since, subject: token }, { uid: true });
        for (const uid of hits || []) uids.add(uid);
      }
      if (uids.size === 0) return [];

      type Candidate = Omit<InboundReply, 'text'> & { uid: number; part: string; html: boolean };
      const candidates: Candidate[] = [];
      for await (const msg of client.fetch([...uids], { uid: true, envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
        const subject = msg.envelope?.subject ?? '';
        const token = subject.match(TOKEN)?.[1]?.toLowerCase();
        if (!token || !opts.tokens.has(token)) continue;
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? null;
        const isReply = /^\s*(re|aw|sv|antw)\s*:/i.test(subject);
        if (from === self && !isReply) continue; // our own outgoing email delivered to this mailbox
        const structure = msg.bodyStructure as StructureNode | undefined;
        const plain = findPart(structure, 'text/plain');
        const html = plain ? null : findPart(structure, 'text/html');
        if (!plain && !html) continue;
        const internal = msg.internalDate;
        candidates.push({
          uid: msg.uid,
          token,
          from,
          subject,
          part: (plain ?? html) as string,
          html: !plain,
          receivedAt: internal ? new Date(internal).getTime() : Date.now(),
        });
      }

      // imapflow can't run other commands while a fetch is streaming, so bodies download afterwards.
      const replies: InboundReply[] = [];
      for (const c of candidates) {
        const { content } = await client.download(String(c.uid), c.part, { uid: true });
        const raw = await readStream(content);
        replies.push({
          token: c.token,
          from: c.from,
          subject: c.subject,
          text: c.html ? htmlToText(raw) : raw,
          receivedAt: c.receivedAt,
        });
      }
      return replies.sort((a, b) => a.receivedAt - b.receivedAt);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
