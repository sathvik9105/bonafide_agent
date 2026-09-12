import { z } from 'zod';
import { applyReply } from '../../../../../core/callback.ts';
import { mailMode } from '../../../../../providers/mail.ts';
import { getCase, listOutreach } from '../../../../../store/db.ts';

const BodySchema = z.object({ text: z.string() });

// Dry-run stand-in for a real speaker reply. Runs exactly the path the IMAP poller uses.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (mailMode() !== 'dry') {
    return Response.json({ error: 'Simulated replies are only available when MAIL_MODE=dry.' }, { status: 403 });
  }
  const { id } = await params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  const text = parsed.success ? parsed.data.text.trim() : '';
  if (!text) return Response.json({ error: 'Type the reply first.' }, { status: 400 });

  try {
    const outcome = await applyReply(id, text, { source: 'simulated' });
    if (!outcome) {
      return Response.json({ error: 'No speaker email is awaiting a reply under that id.' }, { status: 409 });
    }
    return Response.json({
      outcome,
      case: getCase(outcome.caseId),
      outreach: listOutreach(outcome.caseId),
      mailMode: mailMode(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('simulate-reply failed:', message);
    return Response.json({ error: `Recording the reply failed: ${message}` }, { status: 500 });
  }
}
