// All Gemini calls. Model names come from env; every response is Zod-validated.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Claims } from '../core/types.ts';
import { cached } from './cache.ts';

let client: GoogleGenAI | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  return client;
}

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

/** Gemini wraps JSON in ```json fences when not in JSON mode; strip them defensively. */
export function stripFences(text: string): string {
  return text.replace(FENCE, '$1');
}

async function generateJson(model: string, prompt: string): Promise<unknown> {
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  return JSON.parse(stripFences(res.text ?? ''));
}

const ClaimsSchema = z.object({
  venueName: z.string(),
  venueType: z.enum(['journal', 'conference', 'unknown']),
  venueUrl: z.string().nullable(),
  issn: z.string().nullable(),
  claimedIndexing: z.array(z.string()),
  feeAmount: z.number().nullable(),
  feeCurrency: z.string().nullable(),
  deadlines: z.array(z.string()),
  eventDate: z.string().nullable(),
  promisedTurnaroundDays: z.number().nullable(),
  people: z.array(z.object({ name: z.string(), affiliation: z.string().nullable(), role: z.string() })),
  contactEmail: z.string().nullable(),
  publisher: z.string().nullable(),
});

const EXTRACT_PROMPT = `You extract the claims an academic conference or journal invitation makes about itself.
Return one JSON object with exactly these keys:
- venueName: string. Full name as written, including any edition number ("15th Annual ...").
- venueType: "journal" | "conference" | "unknown".
- venueUrl: string | null. The venue's own website URL as written. Not a submission system or social link.
- issn: string | null. The ISSN (print or electronic) as written, e.g. "2345-6789".
- claimedIndexing: string[]. Every indexing or abstracting service the invitation claims, as lowercase ids:
  "scopus"; "wos" for Web of Science, SCI, SCIE or ESCI; "doaj"; "ugc-care"; any other as a short
  lowercase-hyphenated id such as "google-scholar".
- feeAmount: number | null. The main publication or registration fee, number only.
- feeCurrency: string | null. ISO 4217 code, e.g. "USD".
- deadlines: string[]. Each deadline phrase verbatim as written, keeping words like "final extension".
- eventDate: string | null. Conference start date as YYYY-MM-DD. null for journals or when not stated.
- promisedTurnaroundDays: number | null. Promised time to a review decision or publication, in days
  (48 hours = 2, 3 weeks = 21).
- people: {name, affiliation, role}[]. Named speakers, editors or committee members. affiliation is null
  when not stated.
- contactEmail: string | null. The address submissions or replies go to.
- publisher: string | null. The publisher as the invitation names it.
Use null or [] when the invitation does not state a value. Never guess values that are not in the text.

INVITATION:
`;

function normaliseIndexing(ids: string[]): string[] {
  const out = ids
    .map((raw) => {
      const s = raw.toLowerCase().trim();
      if (s.includes('scopus')) return 'scopus';
      if (/web of science|\bwos\b|\bscie?\b|\besci\b|clarivate/.test(s)) return 'wos';
      if (s.includes('doaj') || s.includes('directory of open access')) return 'doaj';
      if (s.includes('ugc')) return 'ugc-care';
      return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    })
    .filter(Boolean);
  return [...new Set(out)];
}

/** Stage 0: structured claims from raw invitation text. Cached by model + prompt version + text. */
export async function extractClaims(rawText: string): Promise<Claims> {
  const model = requireEnv('GEMINI_MODEL_EXTRACT');
  return cached(`gemini:${model}:extractClaims:v1:${rawText}`, async () => {
    let lastIssues = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = ClaimsSchema.safeParse(await generateJson(model, EXTRACT_PROMPT + rawText));
      if (parsed.success) {
        const c = parsed.data;
        return {
          ...c,
          venueName: c.venueName.trim(),
          venueUrl: c.venueUrl?.trim() || null,
          issn: c.issn?.trim() || null,
          claimedIndexing: normaliseIndexing(c.claimedIndexing),
          contactEmail: c.contactEmail?.trim().toLowerCase() || null,
          publisher: c.publisher?.trim() || null,
        };
      }
      lastIssues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }
    throw new Error(`extractClaims: model output failed validation (${lastIssues})`);
  });
}
