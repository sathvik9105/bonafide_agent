// Runs once per server start. Starts the speaker-reply poller (Node.js runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startReplyPoller } = await import('./core/callback.ts');
  startReplyPoller();
}
