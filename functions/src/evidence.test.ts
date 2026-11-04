import { describe, expect, it } from 'vitest';
import {
  checkEvidence,
  checkNoEvidenceReply,
  leaksCode,
  mentionsSources,
  parseVerifierVerdict,
  type EvidenceSource,
} from './evidence';

const kb: EvidenceSource = {
  id: 'kb:a/c0',
  kind: 'kb',
  title: 'Guía',
  text: 'Se cancela hasta 24 horas antes.',
  ref: 'Guía',
};
const code: EvidenceSource = {
  id: 'code:b_0',
  kind: 'code',
  title: 'Comportamiento del sistema',
  text: 'if (hoursUntil(reservation) < 24) { throw new CancellationWindowException("too late to cancel"); }',
  ref: 'x.java:1-2@abc',
};

const answer = (text: string, ...evidence: [string, string][]) => ({
  text,
  evidence: evidence.map(([source_id, quote]) => ({ source_id, quote })),
});

describe('checkEvidence', () => {
  it('accepts a paraphrase backed by an exact quote', () => {
    const result = checkEvidence(answer('Tenés hasta **24 horas** antes.', ['s1', '24 horas antes']), [kb]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reply.text).toBe('Tenés hasta **24 horas** antes.');
      expect(result.reply.citedSourceIds).toEqual([kb.id]);
      expect(result.reply.cited).toEqual([{ title: 'Guía', text: kb.text }]);
    }
  });

  it('tolerates line breaks and spacing in a quote', () => {
    expect(checkEvidence(answer('Sí.', ['s1', 'hasta\n  24   horas']), [kb]).ok).toBe(true);
  });

  it('rejects a quote that is not in the source', () => {
    expect(checkEvidence(answer('Sí.', ['s1', 'hasta 48 horas']), [kb])).toEqual({ ok: false, reason: 'invalid_quote' });
  });

  it('rejects a quote from another source than the one it names', () => {
    expect(checkEvidence(answer('Sí.', ['s2', 'hasta 24 horas']), [kb, code])).toEqual({ ok: false, reason: 'invalid_quote' });
  });

  it('rejects a source that was not retrieved', () => {
    expect(checkEvidence(answer('Sí.', ['s9', 'hasta 24 horas']), [kb])).toEqual({ ok: false, reason: 'invalid_quote' });
  });

  it('rejects a reply with no evidence', () => {
    expect(checkEvidence(answer('Se cancela cuando quieras.'), [kb])).toEqual({ ok: false, reason: 'no_evidence' });
  });

  it('rejects a figure the quotes do not contain', () => {
    expect(checkEvidence(answer('Cuesta 48 dólares.', ['s1', 'Se cancela']), [kb])).toEqual({ ok: false, reason: 'unbacked_figure' });
  });

  it('does not take numbered-list markers for figures', () => {
    expect(checkEvidence(answer('1. Abrí Mis reservas.\n2. Cancelá.', ['s1', 'Se cancela']), [kb]).ok).toBe(true);
  });

  it('rejects an empty reply', () => {
    expect(checkEvidence(answer('  ', ['s1', 'Se cancela']), [kb])).toEqual({ ok: false, reason: 'no_text' });
  });
});

describe('leaksCode', () => {
  it.each([
    'Lo maneja CancellationWindowException en el sistema.',
    'Está en ReservationService.',
    'Revisá reservation-dialog.controller.js',
    'El método hoursUntil lo valida.',
    'La tabla booking_slot guarda eso.',
    'Corre SELECT id FROM reservation.',
    'Mirá `cancel`.',
    'Viene de com.lighthouse.aditum.',
  ])('flags %s', (reply) => {
    expect(leaksCode(reply, [code])).toBe(true);
  });

  it('flags technical terms', () => {
    expect(leaksCode('El registro se hace con el endpoint de visitantes.', [code])).toBe(true);
  });

  it('flags code quoted verbatim, whitespace aside', () => {
    expect(leaksCode('throw new  CancellationWindowException( "too late to cancel" )', [code])).toBe(true);
  });

  it('lets a plain explanation through', () => {
    expect(leaksCode('Podés cancelar desde Mis reservas hasta 24 horas antes de la fecha.', [code])).toBe(false);
    expect(leaksCode('Te llega un aviso por WhatsApp o a tu iPhone.', [code])).toBe(false);
  });

  it('does not apply when no code was in context', () => {
    expect(leaksCode('El archivo reporte.html se descarga de la guía.', [kb])).toBe(false);
  });
});

describe('checkNoEvidenceReply', () => {
  it('rejects figures in courtesy and clarifying replies', () => {
    expect(checkNoEvidenceReply('courtesy', 'Son 24 horas.', false)).toBe('invalid_no_evidence_reply');
    expect(checkNoEvidenceReply('clarifying_question', '¿Son 24 horas?', false)).toBe('invalid_no_evidence_reply');
  });

  it('requires a clarifying question to ask something', () => {
    expect(checkNoEvidenceReply('clarifying_question', 'Se cancela así.', false)).toBe('invalid_no_evidence_reply');
    expect(checkNoEvidenceReply('clarifying_question', '¿Qué tipo de reserva es?', false)).toBeNull();
  });

  it('requires an attachment for an observation', () => {
    expect(checkNoEvidenceReply('attachment_observation', 'Se ve un recibo.', false)).toBe(
      'attachment_kind_without_attachment',
    );
    expect(checkNoEvidenceReply('attachment_observation', 'Se ve un recibo de 2024.', true)).toBeNull();
  });
});

describe('parseVerifierVerdict', () => {
  it('passes only an explicit true', () => {
    expect(parseVerifierVerdict('{"supported":true,"unsupported_claim":""}').supported).toBe(true);
    expect(parseVerifierVerdict('{"supported":false,"unsupported_claim":"x"}').supported).toBe(false);
    expect(parseVerifierVerdict('{"supported":"true"}').supported).toBe(false);
    expect(parseVerifierVerdict('not json').supported).toBe(false);
  });
});

describe('parseVerifierVerdict', () => {
  it('returns what the verifier objected to', () => {
    expect(parseVerifierVerdict('{"unsupported_claim":"el color","supported":false}')).toEqual({
      supported: false,
      unsupportedClaim: 'el color',
    });
  });
});

describe('mentionsSources', () => {
  it.each(['Las fuentes no dicen eso.', 'En mis fuentes no aparece.', 'Según los fragmentos, sí.', 'Lo que sí veo es el código que calcula la mora.'])('flags %s', (reply) => {
    expect(mentionsSources(reply)).toBe(true);
  });

  it('leaves other uses of the word alone', () => {
    expect(mentionsSources('Registrá la fuente de ingresos del condominio.')).toBe(false);
    expect(mentionsSources('Escribí en el código de descuento lo que te dieron.')).toBe(false);
  });
});
