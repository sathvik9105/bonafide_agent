import { pollReplies } from '../../../core/callback.ts';

// One IMAP sweep on demand. The same sweep also runs every 30s from instrumentation.ts.
export async function GET() {
  try {
    return Response.json(await pollReplies());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('poll-replies failed:', message);
    return Response.json({ error: `Polling failed: ${message}` }, { status: 500 });
  }
}
