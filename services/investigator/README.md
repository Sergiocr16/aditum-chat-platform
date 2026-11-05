# Investigator

Runs on the Raspberry Pi. An agent asks a question from the console, and this answers it from the
production code and, only if needed, from production data. Claude only reads. When bad data is the
cause it can propose a change, and only a separate writer applies it, after an admin rehearses and
approves it. Writes start off.

```
Console → requestInvestigation → investigations/{id} (Firestore)
                                       ↑ outbound HTTPS, no open ports
Pi: runner ──── claude -p (Read, Grep, Glob + MCP) ── checkout of one commit
                    └── mysql-gateway (own OS user) ── read-only user on the production database

Console → rehearse, 3 confirmations → writer_jobs (Firestore)
                                       ↑ outbound HTTPS, no open ports, its own secret
Pi: writer (own OS user) ── write user with per-table GRANTs, password only for the length of a job
```

## Safeguards, and what enforces each one

| Rule | Enforced by |
|---|---|
| Code first, database only if needed | The gateway refuses every database tool until `request_db_access` gets code evidence it has checked |
| Claude can't write | MySQL: its user only has `SELECT`. It has no tool to reach the writer, and its proposal is data that a person reviews |
| A proposal can't be broad | Operations are structured, one row each by its full primary key, checked against the catalog. There's no SQL text, no condition and no delete |
| Only approved work gets the write password | It isn't on the Pi: `investigationWriter` hands it over with a job an admin asked for |
| A writer can only touch what its GRANTs say | The writer refuses a user with anything but `SELECT`, `INSERT` or `UPDATE` per table, and rereads the grants on every job |
| A rehearsal leaves nothing | Runs in a transaction that rolls back, only on InnoDB tables |
| An approval covers exactly what was reviewed | Three ordered steps in `stepProblem`, same admin, 10 minutes, a hash of operations and rehearsal, typed phrase and a fresh login |
| The password only reaches the real server | A verified certificate and host name, always. Changing the host, user or certificate needs the password typed again |
| It applies what was rehearsed or nothing | Each row must still be as it was and end up as it did, or it rolls back. Unclaimed jobs expire in 2 minutes |
| Dying mid-write can't repeat it | `recover` reads the rows when the writer comes back, and an unclear result goes to a person. It never retries |
| Everything is on record | `prod_write_audit`: admins read, only functions writes, nothing deletes |
| Personal data is not masked | A decision: Claude reads real data. The prompt asks it to read and cite only what it needs, but nothing enforces that. Cited values reach Firestore, where agents can read them |
| An open admin session can't collect the saved credentials | The Pi's and the read-only passwords are only reused for the host, port and user they were saved for (`sameTarget`); another address also drops the saved Claude token. Installing, which sends the Pi its secrets, needs a fresh login |
| Claude can't reach credentials | Separate OS users; the password reaches only the gateway, with its own secret |
| A broader user can't be pasted in | The gateway checks `SHOW GRANTS` and won't use anything beyond `SELECT` on that database |
| Files only from their own chat | `requestInvestigation` takes attachments under that conversation's `adjuntos/{convId}/`, and uploads under the agent's own `investigaciones/{uid}/`; the Pi can only fetch a running job's files, by id |
| A hostile file can't reach the runner's secrets | Excel and Word are converted in a separate process as Claude's user, with only `PATH` in its environment and capped memory and time. Files are deleted after the job |
| Claude reads only what its OS user can | `--allowedTools Read` isn't confined to the checkout or the files folder: a probe read a file outside both. What holds is that `investigator-claude` can't read the secrets |
| A case's transcript stays with that case | A later round resumes Claude's session only on the same commit. Each job has its own `CLAUDE_CONFIG_DIR`, emptied when it ends. Between rounds the transcript and rows sit in `sessions/`, where `investigator-claude` can't enter, for 7 days. Without one, the round starts from the history Firestore sends |
| Claude can't send data out | It has no Bash, write or web tools (`--tools`), so its only output is the report |
| Nothing invented | `verifyReport` checks every citation in code. One bad citation loses `confirmed` and the suggested reply |
| The chat can't steer it | Messages go in as marked untrusted data, and the limits above don't depend on the model obeying |

`pii-map.yml` and the generated SQL describe the whole production schema and this repo is public, so
they are gitignored. Keep them on the Pi.

The other agent on this Pi is unaffected: settings are passed per run instead of through
`/etc/claude-code/managed-settings.json`, which would apply to every Claude Code on the machine.

## Local development

```sh
pnpm --filter @aditum-chat/investigator test
pnpm --filter @aditum-chat/investigator gateway   # needs the variables in deploy/gateway.env.example
pnpm --filter @aditum-chat/investigator runner    # needs the variables in deploy/runner.env.example
pnpm --filter @aditum-chat/investigator writer    # needs WRITER_FUNCTION_URL and WRITER_SHARED_SECRET
```

The runner points `CLAUDE_CONFIG_DIR` at each job's own folder, so it needs `CLAUDE_CODE_OAUTH_TOKEN`:
a login kept in the macOS keychain belongs to the default folder and won't be found.

Against the emulators, `RUNNER_FUNCTION_URL` is
`http://127.0.0.1:5201/demo-aditum-chat/us-central1/investigationRunner`, and `RUNNER_SHARED_SECRET`
must match `functions/.secret.local`.

## Setting up the Pi

1. **Read-only user.** Run `deploy/create-ro-user.sql` by hand. Use `REQUIRE SSL` and restrict `__HOST__` to
   the Pi's address.

2. **Firebase:** set the `RUNNER_SHARED_SECRET`, `GATEWAY_SHARED_SECRET` and `WRITER_SHARED_SECRET` secrets and deploy the
   functions and indexes.

3. **Install, from the console.** Under Configuración → Investigador an admin saves the Pi's public IP, SSH
   port, user and password, compares the fingerprint, pastes a token from `claude setup-token` and
   presses **Instalar en la Pi**. The user needs `sudo`. A Cloud Function logs in and runs
   `deploy/install.sh` from a checkout of `main` (`INVESTIGATOR_GIT_REF` overrides it). The script is safe
   to run again, and pressing the button later updates the Pi. It creates its own users, directories
   under `/opt` and `/var/lib`, `/etc/aditum-investigator/*.env` (mode 600) and the three services, with
   its own Node and Claude Code. Nothing else on the machine changes.

   Against the emulators, set `INVESTIGATOR_GIT_REF` and `INVESTIGATOR_PUBLIC_FUNCTIONS_URL` (a functions URL
   the Pi can reach) in `functions/.env.local`. The repository Claude reads comes from `CODE_REPO` in
   `functions/.env`: the install passes it to the Pi as `REPO_URL` and `REPO_BRANCH`.

4. **Connection:** an admin enters the host, user and password under Configuración → Investigador, which
   shows the Pi's public IP for production's firewall. The gateway fetches them and tests them from
   the Pi. It refuses a user with more than `SELECT` on that database, and rechecks every hour.
   Changing the host, port or user needs the password typed again.
   For MySQL's certificate to be verified, point `RO_DB_CA_FILE` at its CA (on RDS, the region's bundle).

5. **Reaching the Pi:** the Cloud Function pins the Pi's host key on the first successful login, so a
   different key stops the login before the password is sent. The passwords and tokens stay encrypted in
   `investigator_secrets/pi`. Changing the host, port or user needs the password typed again, another
   address forgets the Claude token, and every install asks the admin for their console password. Cloud Functions has no fixed outbound IP, so the router can't limit the SSH
   port to it. Once installed, the services only make outbound calls: you can remove the connection and
   close the port until the next update.

6. **Writes (optional, off by default).** Run `deploy/create-write-user.sql` by hand, listing only the
   tables it may touch. Under Configuración → Investigador → Escrituras an admin saves that connection with
   the server's CA certificate (on RDS, the region's bundle) and turns on the switch once its check
   passes. Without a certificate it refuses to connect, and it checks the host name too, so use the
   name on the certificate and not an IP. Before granting a table, find out what cache the app
   keeps for it: a direct write skips `@CacheEvict` and the app's own audit.

Rows returned by queries stay on the Pi for 30 days, in `GATEWAY_LOG_DIR`. Firestore only gets the SQL,
row counts and the values cited as evidence.

## Masked views (not in use)

`classify`, `generate-views` and `piiMap.ts` generate a schema of masked views from a reviewed `pii-map.yml`.
Production doesn't use them today: the analyzer reads the production database directly. They stay here in case that changes.
