import { z } from 'zod';
import { verifyInvitation } from '../../../core/orchestrator.ts';
import { setCacheEnabled } from '../../../providers/cache.ts';
import { mailMode } from '../../../providers/mail.ts';

const BodySchema = z.object({ text: z.string(), sendMail: z.boolean().optional() });
const MAX_CHARS = 50_000;

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  const text = parsed.success ? parsed.data.text.trim() : '';
  if (!text) return Response.json({ error: 'Paste the invitation text first.' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return Response.json({ error: `The invitation is longer than ${MAX_CHARS} characters.` }, { status: 413 });
  }

  // ?fresh=1 skips cache reads for the live demo run.
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  setCacheEnabled(!fresh && process.env.USE_CACHE !== '0');

  try {
    // Live email needs MAIL_MODE=live on the server AND this run's own opt-in.
    const result = await verifyInvitation(text, { live: parsed.success && parsed.data.sendMail === true });
    return Response.json({ ...result, mailMode: mailMode() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('verify failed:', message);
    return Response.json({ error: `Verification failed: ${message}` }, { status: 500 });
  }
}
