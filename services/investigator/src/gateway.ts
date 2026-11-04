import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import mysql from 'mysql2';
import { z } from 'zod';
import { sslOptions, type DbConnection } from './dbCheck.js';
import { codeEvidenceProblem, type LoggedQuery } from './evidence.js';

/**
 * MCP server between Claude and MySQL, run as its own OS user so the credentials
 * never reach Claude's process. Each job starts with the database locked: Claude has
 * to read the code first and show which data it needs and why.
 *
 * The rules here are about that order. What Claude can see and write is enforced by
 * MySQL: the user behind this server only has SELECT on the masked views.
 */

export const MAX_ROWS = 200;
const MAX_CELL_CHARS = 500;
const MAX_EXECUTION_MS = 20_000;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface GatewayConfig {
  adminToken: string;
  logDir: string;
  /** PEM of the CA that signs MySQL's certificate, when there is one. */
  caPem?: string | null;
}

interface DataQuestion {
  id: string;
  question: string;
}

interface Job {
  id: string;
  token: string;
  checkoutDir: string;
  questions: DataQuestion[];
  queries: LoggedQuery[];
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

const NO_CONNECTION = 'La base de datos no está disponible: la conexión no está configurada o no pasó la prueba. Terminá con lo que encontraste en el código.';

const LOCKED =
  'La base de datos está bloqueada. Primero revisá el código y llamá a request_db_access con la evidencia que muestra qué dato hay que consultar.';

function shrink(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return '[binario]';
  if (typeof value === 'string' && value.length > MAX_CELL_CHARS) return `${value.slice(0, MAX_CELL_CHARS)}…`;
  return value;
}

/** Friendlier errors for honest mistakes. MySQL is what actually stops the rest. */
export function sqlProblem(sql: string): string | null {
  const body = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(body)) return 'Solo se permiten consultas SELECT.';
  if (body.includes(';')) return 'Solo se permite una sentencia por consulta.';
  return null;
}

export class Gateway {
  private jobs = new Map<string, Job>();
  private server: Server | null = null;
  /** Only ever set to a connection that passed `checkConnection`. */
  private db: DbConnection | null = null;

  constructor(private config: GatewayConfig) {
    mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
    this.pruneLogs();
  }

  setConnection(db: DbConnection | null) {
    this.db = db;
  }

  private pruneLogs() {
    for (const name of readdirSync(this.config.logDir)) {
      const file = join(this.config.logDir, name);
      if (Date.now() - statSync(file).mtimeMs > LOG_RETENTION_MS) rmSync(file);
    }
  }

  private connect(db: DbConnection) {
    return mysql.createConnection({
      ...db,
      ssl: sslOptions(this.config.caPem ?? null),
      multipleStatements: false,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 10_000,
    });
  }

  /** One connection per query, because stopping a result early means closing it. */
  run(sql: string): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error(NO_CONNECTION));
      const conn = this.connect(this.db);
      const rows: Record<string, unknown>[] = [];
      let settled = false;
      const finish = (error: Error | null, truncated = false) => {
        if (settled) return;
        settled = true;
        conn.destroy();
        if (error) reject(error);
        else resolve({ rows, truncated });
      };
      conn.on('error', (e) => finish(e));
      conn.query(`SET SESSION max_execution_time = ${MAX_EXECUTION_MS}`, (e1) => {
        if (e1) return finish(e1);
        conn.query('START TRANSACTION READ ONLY', (e2) => {
          if (e2) return finish(e2);
          const stream = conn.query(sql).stream({ objectMode: true });
          stream.on('data', (row: Record<string, unknown>) => {
            if (rows.length >= MAX_ROWS) return finish(null, true);
            rows.push(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, shrink(v)])));
          });
          stream.on('error', (e: Error) => finish(e));
          stream.on('end', () => finish(null));
        });
      });
    });
  }

  private buildMcp(job: Job): McpServer {
    const mcp = new McpServer({ name: 'prod_ro', version: '1.0.0' });

    mcp.registerTool(
      'request_db_access',
      {
        description:
          'Pide acceso a la base de datos para responder una pregunta concreta. Exige evidencia de código que muestre qué dato hay que consultar. Usala solo si el código no alcanza para responder o hay que corroborar con datos lo que encontraste.',
        inputSchema: {
          data_question: z.string().min(10).describe('La pregunta concreta que los datos deben responder.'),
          why_data_is_needed: z.string().min(10).describe('Por qué el código no alcanza para responderla.'),
          code_evidence: z
            .array(
              z.object({
                path: z.string(),
                start_line: z.number().int(),
                end_line: z.number().int(),
                quote: z.string().describe('Texto copiado exacto de esas líneas.'),
              }),
            )
            .min(1),
        },
      },
      async ({ data_question, code_evidence }) => {
        if (!this.db) return refuse(NO_CONNECTION);
        for (const e of code_evidence) {
          const problem = codeEvidenceProblem(
            { path: e.path, startLine: e.start_line, endLine: e.end_line, quote: e.quote },
            job.checkoutDir,
          );
          if (problem) return refuse(`Evidencia de código no válida: ${problem}. Revisá el archivo y volvé a intentarlo.`);
        }
        const question = { id: `q${job.questions.length + 1}`, question: data_question };
        job.questions.push(question);
        return text({ question_id: question.id, note: 'Base de datos desbloqueada para esta pregunta. Los datos personales vienen enmascarados.' });
      },
    );

    mcp.registerTool(
      'list_tables',
      { description: 'Lista las tablas disponibles.', inputSchema: {} },
      async () => {
        if (job.questions.length === 0) return refuse(LOCKED);
        const { rows } = await this.run(
          `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${mysql.escape(this.db?.database ?? '')} ORDER BY 1`,
        );
        return text(rows.map((row) => row.name));
      },
    );

    mcp.registerTool(
      'describe_table',
      { description: 'Muestra las columnas de una tabla.', inputSchema: { table: z.string() } },
      async ({ table }) => {
        if (job.questions.length === 0) return refuse(LOCKED);
        const { rows } = await this.run(
          `SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = ${mysql.escape(this.db?.database ?? '')} AND table_name = ${mysql.escape(table)} ORDER BY ordinal_position`,
        );
        return rows.length > 0 ? text(rows) : refuse(`No existe la tabla ${table}, o no tiene columnas disponibles.`);
      },
    );

    mcp.registerTool(
      'query',
      {
        description: `Corre un SELECT de solo lectura y devuelve hasta ${MAX_ROWS} filas. Debe responder a una pregunta ya autorizada con request_db_access.`,
        inputSchema: {
          question_id: z.string(),
          purpose: z.string().min(5).describe('Qué vas a comprobar con esta consulta.'),
          sql: z.string().min(1),
        },
      },
      async ({ question_id, purpose, sql }) => {
        const question = job.questions.find((q) => q.id === question_id);
        if (!question) return refuse(job.questions.length === 0 ? LOCKED : `No existe la pregunta ${question_id}.`);
        const problem = sqlProblem(sql);
        if (problem) return refuse(problem);

        const queryId = `${job.id}-${job.queries.length + 1}`;
        const started = Date.now();
        const logged: LoggedQuery = {
          queryId,
          questionId: question.id,
          dataQuestion: question.question,
          purpose,
          sql,
          rows: [],
          truncated: false,
          ms: 0,
          error: null,
        };
        try {
          const { rows, truncated } = await this.run(sql);
          logged.rows = rows;
          logged.truncated = truncated;
        } catch (e) {
          logged.error = (e as Error).message;
        }
        logged.ms = Date.now() - started;
        job.queries.push(logged);
        appendFileSync(join(this.config.logDir, `${job.id}.jsonl`), `${JSON.stringify(logged)}\n`, { mode: 0o600 });
        if (logged.error) return refuse(`La consulta falló: ${logged.error}`);
        return text({ query_id: queryId, row_count: logged.rows.length, truncated: logged.truncated, rows: logged.rows });
      },
    );

    return mcp;
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new Error('body too large');
      chunks.push(chunk as Buffer);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url === '/mcp') {
      const job = [...this.jobs.values()].find((j) => j.token === bearer);
      if (!job) return send(401, { error: 'unknown job' });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = this.buildMcp(job);
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, await this.readJson(req));
      return;
    }

    // The admin API is for the runner. Claude's process has neither this token nor a way to call it.
    if (bearer !== this.config.adminToken) return send(401, { error: 'unauthorized' });
    if (req.method === 'POST' && req.url === '/jobs') {
      const { id, checkoutDir } = (await this.readJson(req)) as { id: string; checkoutDir: string };
      const token = randomBytes(32).toString('hex');
      this.jobs.set(id, { id, token, checkoutDir, questions: [], queries: [] });
      return send(200, { token });
    }
    const match = req.url?.match(/^\/jobs\/([\w-]+)$/);
    const job = match ? this.jobs.get(match[1]) : undefined;
    if (match && !job) return send(404, { error: 'unknown job' });
    if (job && req.method === 'GET') return send(200, { questions: job.questions, queries: job.queries });
    if (job && req.method === 'DELETE') {
      this.jobs.delete(job.id);
      return send(200, { ok: true });
    }
    return send(404, { error: 'not found' });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handle(req, res).catch((e: Error) => {
          console.error('gateway error', e.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      // Loopback only: there is nothing here anyone outside this machine should reach.
      this.server.listen(port, '127.0.0.1', () => {
        const address = this.server!.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  close() {
    this.server?.close();
  }
}
