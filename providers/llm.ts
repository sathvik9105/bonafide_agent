// All Gemini calls. Model names come from env; every response is Zod-validated.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Claims, ReplyClass } from '../core/types.ts';
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

/** Generate, validate with Zod, retry once on a validation failure. */
async function generateValidated<T>(model: string, prompt: string, schema: z.ZodType<T>, what: string): Promise<T> {
  let issues = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = schema.safeParse(await generateJson(model, prompt));
    if (parsed.success) return parsed.data;
    issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }
  throw new Error(`${what}: model output failed validation (${issues})`);
}

// ---------------------------------------------------------------- extractClaims

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
  people: z.array(
    z.object({
      name: z.string(),
      affiliation: z.string().nullable(),
      role: z.string(),
      email: z.string().nullable().optional(),
    }),
  ),
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
- people: {name, affiliation, role, email}[]. Named speakers, editors or committee members. affiliation
  and email are null when the invitation does not state them. email is that person's own address only.
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
  return cached(`gemini:${model}:extractClaims:v2:${rawText}`, async () => {
    const c = await generateValidated(model, EXTRACT_PROMPT + rawText, ClaimsSchema, 'extractClaims');
    return {
      ...c,
      venueName: c.venueName.trim(),
      venueUrl: c.venueUrl?.trim() || null,
      issn: c.issn?.trim() || null,
      claimedIndexing: normaliseIndexing(c.claimedIndexing),
      people: c.people.map((p) => ({
        name: p.name.trim(),
        affiliation: p.affiliation?.trim() || null,
        role: p.role.trim(),
        email: p.email?.trim().toLowerCase() || null,
      })),
      contactEmail: c.contactEmail?.trim().toLowerCase() || null,
      publisher: c.publisher?.trim() || null,
    };
  });
}

// ---------------------------------------------------------------- email drafting

const EmailBodySchema = z.object({ body: z.string() });

export type DispositionDraftInput = {
  verdict: 'RED' | 'AMBER';
  venueName: string;
  unverified: string[];
  senderName: string;
};

/** Body of the decline (RED) or hold note (AMBER) sent to the venue. */
export async function writeDispositionEmail(input: DispositionDraftInput): Promise<string> {
  const model = requireEnv('GEMINI_MODEL_FAST');
  const decline = input.verdict === 'RED';
  const prompt = `Write the body of a short plain-text email from a researcher replying to an unsolicited invitation from "${input.venueName}".
${
  decline
    ? 'The researcher is declining: they will not submit, register or pay.'
    : 'The researcher is putting the invitation on hold: they will not submit, register or pay until they have verified the venue.'
}
Details the researcher could not verify: ${input.unverified.length ? input.unverified.join('; ') : 'none listed'}.
Rules:
- First line: "Dear organisers,"
- Two to four sentences, polite and firm. ${
    decline
      ? 'Say briefly which details could not be verified, and ask them to remove this address from their mailing list.'
      : "Say the researcher is verifying the venue's details before deciding."
  }
- Never accuse anyone of fraud or dishonesty.
- End with "Regards," and "${input.senderName}" on separate lines.
- Plain text. No subject line, no markdown, no links, no placeholders.
Return JSON: {"body": "<the email body with \\n line breaks>"}`;
  return cached(`gemini:${model}:writeDispositionEmail:v1:${JSON.stringify(input)}`, async () => {
    const { body } = await generateValidated(model, prompt, EmailBodySchema, 'writeDispositionEmail');
    return body;
  });
}

// ---------------------------------------------------------------- classifyReply

const ReplySchema = z.object({
  classification: z.enum(['CONFIRMS', 'DENIES', 'UNAWARE', 'UNCLEAR']),
  quote: z.string(),
});

export type ReplyClassification = { classification: ReplyClass; quote: string };

/** Classify a speaker's reply. Its class feeds the rule engine; it never sets the verdict itself. */
export async function classifyReply(input: {
  replyText: string;
  personName: string;
  venueName: string;
}): Promise<ReplyClassification> {
  const model = requireEnv('GEMINI_MODEL_EXTRACT');
  const prompt = `A student emailed ${input.personName} to ask whether they agreed to take part in "${input.venueName}". Classify the reply below.
- CONFIRMS: the person says they agreed to take part or are involved.
- DENIES: the person says they did not agree, are not involved, or that their name is being used without permission.
- UNAWARE: the person says they have never heard of the event or were never asked.
- UNCLEAR: anything else, including auto-replies, questions back, or no clear answer.
Return JSON: {"classification": "CONFIRMS" | "DENIES" | "UNAWARE" | "UNCLEAR", "quote": "<the one sentence from the reply that decided it, copied exactly>"}

REPLY:
${input.replyText}`;
  return cached(`gemini:${model}:classifyReply:v1:${JSON.stringify(input)}`, () =>
    generateValidated(model, prompt, ReplySchema, 'classifyReply'),
  );
}
