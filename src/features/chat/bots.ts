/**
 * Reply generator for the demo directory. Pure (inject `rng` in tests).
 * It's deliberately light: keyword routing + a little per-person personality, so a demo
 * conversation feels responsive instead of repeating one canned line.
 */
type Rng = () => number;

const POOLS = {
  greeting: ['hey! 👋', 'hi hi', 'yo — what’s up?', 'hello! good timing'],
  thanks: ['anytime 🙌', 'of course!', 'no worries at all'],
  kanban: ['added it to the board ✓', 'on it — moving it to In progress', 'can you assign that one to me?'],
  focus: ['focus mode on 🎧', 'in the middle of a 25 — reply after the break', 'timer’s running, back soon'],
  party: ['I’m in — drop the room code 🍿', 'ooh a watch party? yes', 'give me 2 min to grab snacks'],
  image: ['love that 📸', 'oh that’s clean', 'nice shot!'],
  question: ['good question — let me think', 'hmm, probably yes?', 'I’d say go for it', 'not sure, let’s check together'],
  agree: ['haha agreed 🔥', 'same', 'exactly', 'for sure'],
} as const;

const PERSONA: Record<string, readonly string[]> = {
  alex: ['the black UI is so clean ✨', 'can we try a softer orange?', 'micro-animations make it feel alive'],
  jordan: ['let’s ship this week 🚀', 'I’ll write the doc', 'added to the roadmap'],
  sam: ['deploying now…', 'infra is happy', 'tests are green ✅'],
  riley: ['reads well!', 'let me polish the copy', 'love the tone'],
};

const pick = <T>(arr: readonly T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)] as T;

export function botReply(personId: string, text: string, opts: { hasAttachment?: boolean; rng?: Rng } = {}): string {
  const rng = opts.rng ?? Math.random;
  const t = text.trim().toLowerCase();

  if (opts.hasAttachment) return pick(POOLS.image, rng);
  if (/^(hi|hey|hello|yo|sup|hola)\b/.test(t)) return pick(POOLS.greeting, rng);
  if (/\b(thanks|thank you|thx|ty)\b/.test(t)) return pick(POOLS.thanks, rng);
  if (/\b(kanban|task|board|ticket|todo)\b/.test(t)) return pick(POOLS.kanban, rng);
  if (/\b(focus|timer|pomodoro)\b/.test(t)) return pick(POOLS.focus, rng);
  if (/\b(party|youtube|watch|vibe)\b/.test(t)) return pick(POOLS.party, rng);
  if (t.includes('?')) return pick(POOLS.question, rng);
  const persona = PERSONA[personId];
  return rng() < 0.5 && persona ? pick(persona, rng) : pick(POOLS.agree, rng);
}

/** Typing time scales with the length of the reply, so short answers feel snappy. */
export function typingDuration(reply: string): number {
  return Math.min(3600, Math.max(900, 700 + reply.length * 32));
}
