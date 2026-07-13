import type { Idioma } from './types';

/**
 * Curated emoji palette for the WhatsApp-style composer picker.
 * Shared by the widget and the console so both offer the same set.
 */
export interface EmojiCategory {
  label: Record<Idioma, string>;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: { es: 'Caritas y personas', en: 'Smileys & people' },
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '😉', '😌', '😍', '🥰', '😘', '😋', '😜', '🤗', '🤔',
      '😐', '😑', '🙄', '😬', '😴', '🤒', '🤧', '🥵', '🥶', '😎',
      '🥳', '😢', '😭', '😤', '😠', '😱', '😳', '🥺', '😓', '😞',
      '🙏', '👍', '👎', '👋', '🙌', '👏', '🤝', '💪', '🤞', '✌️',
      '👌', '🤌', '👉', '👈', '☝️', '✋', '🖐️', '👀', '🧑', '👩',
    ],
  },
  {
    label: { es: 'Corazones', en: 'Hearts' },
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕',
      '💞', '💖', '💗', '💘', '💝', '💟', '❣️', '💌', '💯', '💫',
    ],
  },
  {
    label: { es: 'Animales y naturaleza', en: 'Animals & nature' },
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦆', '🦉',
      '🐝', '🦋', '🐢', '🐟', '🐬', '🌵', '🌴', '🌳', '🌻', '🌹',
      '🌸', '🌼', '☀️', '🌙', '⭐', '🌈', '☁️', '🌧️', '⛈️', '❄️',
    ],
  },
  {
    label: { es: 'Comida y bebida', en: 'Food & drink' },
    emojis: [
      '🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍍', '🥭', '🥑', '🍅',
      '🌽', '🥕', '🍞', '🧀', '🍗', '🍔', '🍟', '🍕', '🌮', '🥗',
      '🍚', '🍜', '🍣', '🍰', '🍪', '🍫', '☕', '🍵', '🥤', '🍺',
    ],
  },
  {
    label: { es: 'Actividades y objetos', en: 'Activities & objects' },
    emojis: [
      '⚽', '🏀', '🎾', '🏐', '🎱', '🏓', '🏊', '🚴', '🏋️', '🎮',
      '🎲', '🎵', '🎸', '🎤', '🎬', '📸', '💻', '📱', '⌚', '🖨️',
      '💡', '🔦', '🔧', '🔨', '🪛', '🧰', '🧹', '🧺', '🔑', '🗝️',
      '📦', '📄', '📌', '📎', '✏️', '📝', '📅', '⏰', '💰', '💳',
    ],
  },
  {
    label: { es: 'Lugares y transporte', en: 'Places & transport' },
    emojis: [
      '🏠', '🏡', '🏢', '🏬', '🏥', '🏦', '🏗️', '🌆', '🌇', '🏙️',
      '🚗', '🚕', '🚙', '🚌', '🚑', '🚒', '🚚', '🚜', '🛵', '🚲',
      '✈️', '🚀', '⛵', '🚦', '🚧', '⛽', '🗺️', '📍', '🏖️', '⛰️',
    ],
  },
  {
    label: { es: 'Símbolos', en: 'Symbols' },
    emojis: [
      '✅', '❌', '⚠️', '❗', '❓', '💯', '🔥', '✨', '🎉', '🎊',
      '🏆', '🥇', '📢', '🔔', '🔕', '♻️', '🚫', '🆗', '🆕', '🔝',
      '➕', '➖', '➗', '✖️', '💲', '📶', '🔒', '🔓', '⏳', '⌛',
    ],
  },
];
