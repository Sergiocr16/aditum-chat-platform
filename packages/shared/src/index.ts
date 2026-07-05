export * from './types';
export * from './tokens';
export * from './i18n';
export * from './schedule';

export const TICKET_NUMBER_PREFIX = 'TK';

export function formatTicketNumber(numero: number): string {
  return `#${TICKET_NUMBER_PREFIX}-${String(numero).padStart(4, '0')}`;
}

/** Id determinístico de contacto: un contacto por (sitio, usuario del host). */
export function contactIdFor(siteId: string, externalId: string): string {
  return `${siteId}_${externalId}`;
}

/** Id determinístico de la conversación de grupo de un cliente en un sitio. */
export function groupConversationIdFor(siteId: string, clientId: string): string {
  return `grupo_${siteId}_${clientId}`;
}
