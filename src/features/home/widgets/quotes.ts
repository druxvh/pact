export type Quote = { text: string; by: string };

/** Short, well-attested lines from long-public-domain sources and proverbs — bundled, so no network is ever needed. */
export const QUOTES: readonly Quote[] = [
  { text: 'We suffer more often in imagination than in reality.', by: 'Seneca' },
  { text: 'It is not that we have a short time to live, but that we waste a lot of it.', by: 'Seneca' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', by: 'Seneca' },
  { text: 'First say to yourself what you would be; and then do what you have to do.', by: 'Epictetus' },
  { text: 'No man is free who is not master of himself.', by: 'Epictetus' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', by: 'Marcus Aurelius' },
  { text: 'The journey of a thousand miles begins with a single step.', by: 'Lao Tzu' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', by: 'Confucius' },
  { text: 'He who has a why to live can bear almost any how.', by: 'Friedrich Nietzsche' },
  { text: 'Our life is frittered away by detail. Simplify, simplify.', by: 'Henry David Thoreau' },
  { text: 'Nothing great was ever achieved without enthusiasm.', by: 'Ralph Waldo Emerson' },
  { text: 'Every artist was first an amateur.', by: 'Ralph Waldo Emerson' },
  { text: 'What you do speaks so loud that I cannot hear what you say.', by: 'Ralph Waldo Emerson' },
  { text: 'Time is what we want most, but what we use worst.', by: 'William Penn' },
  { text: 'Lost time is never found again.', by: 'Benjamin Franklin' },
  { text: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { text: 'If I had more time, I would have written a shorter letter.', by: 'Blaise Pascal' },
  { text: 'Courage is resistance to fear, mastery of fear — not absence of fear.', by: 'Mark Twain' },
  { text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', by: 'Thomas Edison' },
  { text: 'The best way to predict the future is to invent it.', by: 'Alan Kay' },
  { text: 'Well begun is half done.', by: 'Aristotle' },
  { text: 'Do what you can, with what you have, where you are.', by: 'Theodore Roosevelt' },
  { text: 'He who is not satisfied with a little is satisfied with nothing.', by: 'Epicurus' },
  { text: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
  { text: 'A smooth sea never made a skilled sailor.', by: 'English proverb' },
  { text: 'Slow and steady wins the race.', by: 'Aesop' },
  { text: 'The best time to plant a tree was twenty years ago. The second best time is now.', by: 'Proverb' },
  { text: 'Make hay while the sun shines.', by: 'Proverb' },
];

/** Whole local days since 1 Jan 1970 — the same for every tab all day, then it ticks over at local midnight. */
export const dayNumber = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);

/** The same quote all day, a different one tomorrow, cycling through the whole list. */
export function quoteOfTheDay(d = new Date(), quotes: readonly Quote[] = QUOTES): Quote {
  const i = ((dayNumber(d) % quotes.length) + quotes.length) % quotes.length;
  return quotes[i] as Quote;
}
