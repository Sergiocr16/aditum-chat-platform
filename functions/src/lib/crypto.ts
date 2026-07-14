import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { GROUP_CLIENTS_MAX, type EncryptedPayloadClaims } from '@aditum-chat/shared';

// Payload cifrado del host: AES-256-GCM.
// Formato en tránsito: base64( iv(12) ‖ ciphertext ‖ authTag(16) ).
// La clave se muestra al admin una única vez como pk_<siteId>_<hex64>.

const IV_LEN = 12;
const TAG_LEN = 16;

export const PAYLOAD_MAX_AGE_S = 300; // 5 minutos

/** Cifra cualquier JSON con AES-256-GCM → base64(iv ‖ ct ‖ tag). */
export function encryptJson(keyHex: string, data: unknown): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('La clave debe ser de 32 bytes (hex de 64).');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/** Descifra base64(iv ‖ ct ‖ tag) → JSON. */
export function decryptJson<T = unknown>(keyHex: string, payloadB64: string): T {
  const key = Buffer.from(keyHex, 'hex');
  const raw = Buffer.from(payloadB64, 'base64');
  if (raw.length < IV_LEN + TAG_LEN + 2) throw new Error('Payload inválido.');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN, raw.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as T;
}

export function encryptPayload(keyHex: string, claims: EncryptedPayloadClaims): string {
  return encryptJson(keyHex, claims);
}

export function decryptPayload(keyHex: string, payloadB64: string): EncryptedPayloadClaims {
  return decryptJson<EncryptedPayloadClaims>(keyHex, payloadB64);
}

export function validateClaims(claims: EncryptedPayloadClaims): void {
  const now = Math.floor(Date.now() / 1000);
  if (!claims.userId || !claims.name) throw new Error('Payload sin userId/name.');
  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    throw new Error('Payload sin iat/exp.');
  }
  if (claims.exp - claims.iat > PAYLOAD_MAX_AGE_S) {
    throw new Error(`exp no puede superar iat + ${PAYLOAD_MAX_AGE_S}s.`);
  }
  // 30s de tolerancia de reloj.
  if (claims.exp < now - 30) throw new Error('Payload expirado — generá uno nuevo.');
  if (claims.iat > now + 30) throw new Error('iat en el futuro.');

  if (claims.groupClients !== undefined) {
    if (!claims.groupId) throw new Error('groupClients requiere groupId.');
    if (!Array.isArray(claims.groupClients) || claims.groupClients.length > GROUP_CLIENTS_MAX) {
      throw new Error(`groupClients debe ser un array de máximo ${GROUP_CLIENTS_MAX} items.`);
    }
    for (const c of claims.groupClients) {
      if (!c || typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name) {
        throw new Error('Cada item de groupClients debe tener id y name (strings).');
      }
    }
  }
  if (claims.groupChatEnabled !== undefined && typeof claims.groupChatEnabled !== 'boolean') {
    throw new Error('groupChatEnabled debe ser boolean.');
  }
  if (claims.clientInfo !== undefined) {
    if (!claims.clientId) throw new Error('clientInfo requiere clientId.');
    if (typeof claims.clientInfo !== 'object' || Array.isArray(claims.clientInfo)) {
      throw new Error('clientInfo debe ser un objeto.');
    }
    const { modules } = claims.clientInfo;
    if (modules !== undefined && (!Array.isArray(modules) || modules.some((m) => typeof m !== 'string'))) {
      throw new Error('clientInfo.modules debe ser un array de strings.');
    }
  }
}

export function generateSiteKeyHex(): string {
  return randomBytes(32).toString('hex');
}

/** Presentación de la clave para el admin: pk_<siteId>_<hex>. */
export function formatSiteKey(siteId: string, keyHex: string): string {
  return `pk_${siteId}_${keyHex}`;
}

/**
 * Temporary agent password: 12 chars in Xxxx-Xxxx-Xxxx groups from an
 * unambiguous alphabet (no 0/O/1/l/I) — easy to read out or copy. Meant to
 * be shown once and changed by the agent on first sign-in.
 */
export function generateTempPassword(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}
