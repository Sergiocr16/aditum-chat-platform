/**
 * Detects credentials in source text BEFORE it leaves for Voyage or Claude.
 * A positive skips the whole file: dropping just the matching line could leave
 * the rest of a credential behind, and a false positive only costs one file.
 */

interface SecretRule {
  name: string;
  pattern: RegExp;
}

const RULES: SecretRule[] = [
  { name: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws_access_key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'github_token', pattern: /\b(ghp|gho|ghs|ghu|github_pat)_[0-9A-Za-z_]{20,}\b/ },
  { name: 'anthropic_key', pattern: /\bsk-ant-[0-9A-Za-z_-]{20,}\b/ },
  { name: 'openai_style_key', pattern: /\bsk-[0-9A-Za-z]{32,}\b/ },
  { name: 'sendgrid_key', pattern: /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/ },
  { name: 'slack_token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'stripe_key', pattern: /\b[rs]k_(live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: 'jwt', pattern: /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\b/ },
  { name: 'url_with_credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:'"]+:[^\s/@'"]+@[^\s/'"]+/i },
];

/** `password = "value"`-style assignments whose value looks like a real secret. */
const ASSIGNMENT =
  /\b[\w.-]*(password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|private[_-]?key)[\w.-]*["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi;

/** Long, mixed-alphabet literals: catches unknown key formats next to no keyword. */
const HIGH_ENTROPY_LITERAL = /["']([0-9A-Za-z+/_=-]{32,})["']/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Values built from code, not literals: `password: "{{vm.password}}"`, placeholders, identifiers. */
function looksLikePlaceholder(value: string): boolean {
  return (
    /[{}$<>()]/.test(value) ||
    /^[a-z]+([A-Z][a-z]+)*$/.test(value) || // camelCase identifier
    /^[a-z]+([._-][a-z]+)*[._-]?$/i.test(value) || // dotted or dashed key, or a prefix like `ak_live_`
    /^[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]+[:.]?$/.test(value) || // a plain word, e.g. a UI label ("Contraseña:")
    /^(x+|\*+|changeme|password|example)/i.test(value)
  );
}

/** Paths, constants and the alphabets that random-id helpers iterate over. */
function looksLikeStructuralLiteral(value: string): boolean {
  return /^[a-z0-9/_.-]+$/.test(value) || /^[A-Z0-9_]+$/.test(value) || /abcdefgh|ABCDEFGH|01234567/.test(value);
}

/** Returns the names of the rules that matched; never the matched values, so logs stay clean. */
export function findSecrets(text: string): string[] {
  const hits = new Set<string>();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) hits.add(rule.name);
  }
  for (const match of text.matchAll(ASSIGNMENT)) {
    if (!looksLikePlaceholder(match[2])) hits.add('credential_assignment');
  }
  for (const match of text.matchAll(HIGH_ENTROPY_LITERAL)) {
    const value = match[1];
    if (!looksLikeStructuralLiteral(value) && shannonEntropy(value) >= 4.5) hits.add('high_entropy_literal');
  }
  return [...hits];
}
