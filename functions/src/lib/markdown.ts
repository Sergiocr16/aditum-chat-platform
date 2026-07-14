import type { Attachment } from '@aditum-chat/shared';

/**
 * WhatsApp-style body for attachment-only messages ("📷 Foto",
 * "📄 recibo.pdf"). Empty string when there are no attachments.
 */
export function attachmentSummary(
  adjuntos: Attachment[] | undefined,
  lang: 'es' | 'en',
): string {
  if (!adjuntos?.length) return '';
  const a = adjuntos[0];
  const label =
    a.tipo === 'imagen'
      ? lang === 'es'
        ? '📷 Foto'
        : '📷 Photo'
      : a.tipo === 'video'
        ? '🎥 Video'
        : `📄 ${a.nombre ?? (lang === 'es' ? 'Archivo' : 'File')}`;
  return adjuntos.length > 1 ? `${label} (+${adjuntos.length - 1})` : label;
}

/**
 * Markdown → plain text for surfaces that render raw strings (push
 * notifications). Keeps the words, drops the syntax.
 */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
