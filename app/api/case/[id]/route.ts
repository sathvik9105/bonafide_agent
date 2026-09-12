import { mailMode } from '../../../../providers/mail.ts';
import { getCase, listOutreach } from '../../../../store/db.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = getCase(id);
  if (!found) return Response.json({ error: 'Case not found.' }, { status: 404 });
  return Response.json({ case: found, outreach: listOutreach(id), mailMode: mailMode() });
}
