/**
 * Which files an investigation can read, decided from the type and name. Shared so the
 * console warns about the same files the server rejects or skips.
 */
export type InvestigationFileKind = 'image' | 'pdf' | 'text' | 'spreadsheet' | 'document';

export const INVESTIGATION_MAX_FILES = 10;
export const INVESTIGATION_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const INVESTIGATION_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
/** For the file picker. Mirrors `investigationFileKind`. */
export const INVESTIGATION_FILE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.csv,.md,.xlsx,.docx';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function investigationFileKind(mimeType: string | null | undefined, name: string | null | undefined): InvestigationFileKind | null {
  const type = (mimeType ?? '').toLowerCase().split(';')[0].trim();
  const extension = (name ?? '').toLowerCase().split('.').pop() ?? '';
  if (IMAGE_TYPES.includes(type)) return 'image';
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (extension === 'xlsx' || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'spreadsheet';
  if (extension === 'docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'document';
  if (type.startsWith('text/') || ['txt', 'csv', 'md'].includes(extension)) return 'text';
  return null;
}
