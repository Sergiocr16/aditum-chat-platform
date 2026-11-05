import { isAbsolute, relative } from 'node:path';

export interface ProgressEvent {
  kind: 'code' | 'database' | 'attachment' | 'status';
  text: string;
}

/** Turns one line of Claude's stream-json into what the agent sees while it runs. */
export function describeLine(line: string, checkoutDir: string, filesDir?: string): ProgressEvent[] {
  let event: { type?: string; message?: { content?: unknown } };
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) return [];
  const out: ProgressEvent[] = [];
  for (const block of event.message.content as { type: string; name?: string; input?: Record<string, unknown> }[]) {
    if (block.type !== 'tool_use') continue;
    const input = block.input ?? {};
    const name = String(block.name ?? '').replace(/^mcp__prod_ro__/, '');
    if (name === 'Read') {
      const file = String(input.file_path ?? '');
      if (filesDir && file.startsWith(`${filesDir}/`)) out.push({ kind: 'attachment', text: `Leyó el adjunto ${relative(filesDir, file)}` });
      else out.push({ kind: 'code', text: `Leyó ${isAbsolute(file) ? relative(checkoutDir, file) : file}` });
    } else if (name === 'Grep') {
      out.push({ kind: 'code', text: `Buscó "${String(input.pattern ?? '').slice(0, 80)}" en el código` });
    } else if (name === 'request_db_access') {
      out.push({ kind: 'database', text: `Pidió entrar a la base: ${String(input.data_question ?? '').slice(0, 200)}` });
    } else if (name === 'query') {
      out.push({ kind: 'database', text: `Consulta: ${String(input.purpose ?? '').slice(0, 200)}` });
    }
  }
  return out;
}

export interface ClaudeResult {
  structured_output?: unknown;
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: number | null;
  total_cost_usd?: number;
}

export function resultFrom(line: string): ClaudeResult | null {
  try {
    const event = JSON.parse(line);
    return event.type === 'result' ? (event as ClaudeResult) : null;
  } catch {
    return null;
  }
}

/** The subscription's shared limits are expected to run out now and then, so it's a state of its own. */
export function isRateLimited(result: ClaudeResult | null, stderr: string): boolean {
  if (result?.api_error_status === 429) return true;
  const text = `${result?.is_error ? (result.result ?? '') : ''}\n${stderr}`;
  return /rate.?limit|usage limit|limit reached|hit your limit|too many requests/i.test(text);
}
