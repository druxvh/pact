/** Curated emoji set — [emoji, search keywords]. Small on purpose: no 400 KB emoji dataset, no CDN. */
export type EmojiCategory = { id: string; label: string; icon: string; emojis: ReadonlyArray<readonly [string, string]> };

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      ['😀', 'grin happy'], ['😃', 'smile'], ['😄', 'laugh'], ['😁', 'beam'], ['😆', 'squint laugh'], ['😅', 'sweat smile nervous'],
      ['😂', 'joy tears laugh lol'], ['🤣', 'rofl rolling'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush'], ['😍', 'heart eyes love'],
      ['🥰', 'adore love'], ['😘', 'kiss'], ['😋', 'yum tasty'], ['😎', 'cool sunglasses'], ['🤩', 'star struck wow'], ['🥳', 'party celebrate'],
      ['😏', 'smirk'], ['🙄', 'eye roll'], ['😬', 'grimace awkward'], ['😴', 'sleep tired'], ['🤔', 'think hmm'], ['🤨', 'skeptical'],
      ['😐', 'neutral'], ['😮', 'wow surprise'], ['😱', 'scream shock'], ['😢', 'cry sad'], ['😭', 'sob'], ['😤', 'huff'],
      ['😡', 'angry mad'], ['🤯', 'mind blown'], ['🥺', 'plead puppy'], ['😇', 'angel'], ['🤗', 'hug'], ['🫡', 'salute'],
      ['🤫', 'shush quiet'], ['🥱', 'yawn bored'], ['🤪', 'zany crazy'], ['😌', 'relieved calm'],
    ],
  },
  {
    id: 'gestures',
    label: 'People',
    icon: '👍',
    emojis: [
      ['👍', 'thumbs up yes ok'], ['👎', 'thumbs down no'], ['👏', 'clap applause'], ['🙌', 'raised hands celebrate'], ['🙏', 'pray thanks please'],
      ['🤝', 'handshake deal pact'], ['💪', 'strong muscle'], ['👋', 'wave hello bye'], ['🤙', 'call me shaka'], ['✌️', 'peace victory'],
      ['🤞', 'fingers crossed luck'], ['👌', 'ok perfect'], ['🫶', 'heart hands'], ['☝️', 'point up'], ['👀', 'eyes look'], ['🧠', 'brain smart'],
      ['🫠', 'melt'], ['🤷', 'shrug'], ['🙋', 'raise hand'], ['💃', 'dance'], ['🕺', 'dance disco'], ['🧑‍💻', 'developer coding'],
    ],
  },
  {
    id: 'symbols',
    label: 'Hearts & stars',
    icon: '❤️',
    emojis: [
      ['❤️', 'heart love red'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'], ['💖', 'sparkling heart'], ['💯', 'hundred perfect'], ['✨', 'sparkles magic'],
      ['🔥', 'fire hot lit'], ['⭐', 'star'], ['🌟', 'glowing star'], ['💫', 'dizzy star'], ['⚡', 'bolt lightning fast'], ['🎉', 'tada party confetti'],
      ['🎊', 'confetti'], ['🏆', 'trophy win'], ['✅', 'check done yes'], ['❌', 'cross no'], ['⚠️', 'warning'], ['❓', 'question'],
    ],
  },
  {
    id: 'food',
    label: 'Food & nature',
    icon: '🍕',
    emojis: [
      ['🍕', 'pizza'], ['🍔', 'burger'], ['🍟', 'fries'], ['🌮', 'taco'], ['🍣', 'sushi'], ['🍜', 'ramen noodles'], ['🍩', 'donut'], ['🍪', 'cookie'],
      ['☕', 'coffee'], ['🍺', 'beer'], ['🍷', 'wine'], ['🍿', 'popcorn movie'], ['🥑', 'avocado'], ['🍓', 'strawberry'], ['🍎', 'apple'], ['🍰', 'cake'],
      ['🌸', 'blossom flower'], ['🌈', 'rainbow'], ['☀️', 'sun'], ['🌙', 'moon night'], ['🌊', 'wave ocean'], ['🌲', 'tree'],
      ['🐶', 'dog'], ['🐱', 'cat'], ['🦊', 'fox'], ['🐼', 'panda'], ['🦄', 'unicorn'], ['🐙', 'octopus'],
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    emojis: [
      ['💡', 'idea bulb'], ['🚀', 'rocket launch ship'], ['📦', 'package box'], ['📌', 'pin'], ['📎', 'paperclip'], ['🔒', 'lock secure'],
      ['🔑', 'key'], ['📸', 'camera photo'], ['🎧', 'headphones music focus'], ['🎵', 'music note'], ['🎮', 'game controller'], ['💻', 'laptop computer'],
      ['📱', 'phone'], ['🧪', 'test experiment'], ['🎨', 'art palette design'], ['📝', 'memo note'], ['🗓️', 'calendar'], ['⏰', 'alarm clock'],
      ['🔔', 'bell notification'], ['🏠', 'home'], ['🌍', 'globe world'], ['🎁', 'gift'], ['🛠️', 'tools build'], ['🐛', 'bug'],
    ],
  },
] as const;

export const ALL_EMOJI = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

export function searchEmoji(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_EMOJI.filter(([, kw]) => kw.includes(q)).map(([e]) => e);
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '👀'] as const;
