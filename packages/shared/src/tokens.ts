// Design tokens extraídos del diseño de Claude Design "Aditum Chat: Sistema de Soporte".

export const colors = {
  // Marca / primarios
  navy: '#123C68',
  navyDeep: '#0A1D31',
  navyLight: '#1A4E85',
  blueMuted: '#6B7F99',

  // Neutros cálidos (warm paper)
  ink: '#26241F',
  ink2: '#3D3A33',
  gray: '#6E675C',
  gray2: '#8A8375',
  gray3: '#A9A294',
  gray4: '#C9C2B4',
  cream0: '#FBFAF8',
  cream1: '#F7F5F1',
  cream2: '#F2EFE9',
  cream3: '#ECE8E1',
  border: '#E4DFD6',
  white: '#FFFFFF',

  // Semánticos
  green: '#2E9E5B',
  greenDark: '#1E7A46',
  greenBright: '#4ADE80',
  greenBg: '#DFF3E7',
  amber: '#C7791F',
  amberDark: '#9A5B00',
  amberBg: '#FDF0DC',
  gold: '#E3A93C',
  yellowBg: '#FDF6E8',
  red: '#B3261E',
  redBright: '#D93636',
  redBg: '#FBE3E1',

  // IA / bot Claude
  purple: '#7A4FB3',
  purpleLight: '#B9A7E0',
  purpleBg: '#F0E8FB',
  purpleBg2: '#F5F1FB',

  // Info / links / tags de canal
  blueTagBg: '#E6EEF6',
  blueSoft: '#8FB8E8',
  blueBg: '#ECF2F8',

  // Chat estilo WhatsApp
  chatBubbleOwn: '#D9FDD3',
  chatMeta: '#667781',
  chatMeta2: '#54656F',
  chatInk: '#111B21',
  chatCheck: '#53BDEB',
} as const;

export const fonts = {
  sans: `"Instrument Sans", system-ui, -apple-system, sans-serif`,
  mono: `ui-monospace, Menlo, monospace`,
  /** Google Fonts: familia de iconos. */
  icons: 'Material Symbols Rounded',
} as const;

export const fontLinks = [
  'https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
] as const;

export const radius = {
  card: '8px',
  cardLg: '12px',
  panel: '14px',
  input: '10px',
  chip: '6px',
  pill: '99px',
} as const;

export const shadows = {
  card: '0 1px 2px rgba(10,29,49,.06)',
  raised: '0 6px 20px rgba(10,29,49,.12)',
  bubble: '0 8px 24px rgba(10,29,49,.12)',
  modal: '0 24px 60px rgba(10,29,49,.35)',
} as const;
