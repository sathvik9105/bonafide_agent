// Phase 0 smoke test: Gemini returns JSON matching the Claims shape.
// Run: node --env-file=.env scripts/smoke-llm.ts
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const ClaimsSchema = z.object({
  venueName: z.string(),
  venueType: z.enum(['journal', 'conference', 'unknown']),
  venueUrl: z.string().nullable(),
  issn: z.string().nullable(),
  claimedIndexing: z.array(z.string()),
  feeAmount: z.number().nullable(),
  feeCurrency: z.string().nullable(),
  deadlines: z.array(z.string()),
  promisedTurnaroundDays: z.number().nullable(),
  people: z.array(
    z.object({ name: z.string(), affiliation: z.string().nullable(), role: z.string() }),
  ),
  contactEmail: z.string().nullable(),
  publisher: z.string().nullable(),
});

// Synthetic invitation modelled on a typical predatory CFP. No real people.
const INVITATION = `Dear Esteemed Researcher,

Greetings from the 15th Annual International Conference on Advanced Computing and
Engineering Sciences (ICACES-2026), to be held 24-25 October 2026 in Dubai, UAE.
Website: https://www.icaces-conference.org

All accepted papers will be published in the International Journal of Advanced
Computing Research (ISSN 2345-6789), indexed in SCOPUS, Web of Science and UGC-CARE.
Review decision within 48 hours! Registration fee: USD 299.

Keynote Speakers:
- Prof. Jane Example, Stanford University (Keynote)
- Dr. Rahul Sample, IIT Bombay (Session Chair)

Final extension: submission deadline 30 September 2026.
Submit to: icaces.submissions@gmail.com

Warm regards,
Organizing Committee`;

const PROMPT = `Extract the claims made by this academic invitation as JSON with exactly these keys:
venueName (string), venueType ("journal"|"conference"|"unknown"), venueUrl (string|null),
issn (string|null), claimedIndexing (lowercase ids from: scopus, wos, doaj, ugc-care),
feeAmount (number|null), feeCurrency (string|null), deadlines (string[]),
promisedTurnaroundDays (number|null), people ({name, affiliation, role}[]),
contactEmail (string|null), publisher (string|null).
Use null when the invitation does not state a value. Return only the JSON.

INVITATION:
${INVITATION}`;

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

async function trial(ai: GoogleGenAI, model: string, jsonMode: boolean): Promise<boolean> {
  const label = jsonMode ? 'responseMimeType=application/json' : 'plain text prompt';
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model,
    contents: PROMPT,
    config: jsonMode ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 },
  });
  const ms = Date.now() - t0;
  const text = res.text ?? '';
  const fenced = FENCE.test(text);
  const body = fenced ? text.replace(FENCE, '$1') : text;
  console.log(`\n[${label}] ${ms}ms, fenced=${fenced}`);
  try {
    const parsed = ClaimsSchema.safeParse(JSON.parse(body));
    if (!parsed.success) {
      console.log('  FAIL zod:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      return false;
    }
    console.log('  PASS', JSON.stringify(parsed.data, null, 2).replace(/\n/g, '\n  '));
    return true;
  } catch (e) {
    console.log('  FAIL JSON.parse:', (e as Error).message, '\n  raw head:', text.slice(0, 200));
    return false;
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL_EXTRACT;
  if (!apiKey || !model) throw new Error('GEMINI_API_KEY and GEMINI_MODEL_EXTRACT must be set');
  const ai = new GoogleGenAI({ apiKey });
  console.log(`model=${model}`);
  const a = await trial(ai, model, true);
  const b = await trial(ai, model, false);
  console.log(`\nRESULT: json-mode ${a ? 'PASS' : 'FAIL'}, plain ${b ? 'PASS' : 'FAIL'}`);
  process.exit(a ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});
