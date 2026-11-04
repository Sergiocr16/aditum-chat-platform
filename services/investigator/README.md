# Investigator

Runs on the Raspberry Pi. An agent asks a question from the console, and this answers it from the
production code and, only if needed, from masked production data. It analyzes; it writes nothing.

```
Console → requestInvestigation → investigations/{id} (Firestore)
                                       ↑ outbound HTTPS, no open ports
Pi: runner ──── claude -p (Read, Grep, Glob + MCP) ── checkout of one commit
                    └── mysql-gateway (own OS user) ── masked views only
```

## Safeguards, and what enforces each one

| Rule | Enforced by |
|---|---|
| Code first, database only if needed | The gateway refuses every database tool until `request_db_access` gets code evidence it has checked |
| No writes, no real tables | MySQL: the user only has `SELECT` on the `aditum_ro` views |
| Personal data masked | MySQL views generated from `pii-map.yml`; a column nobody classified doesn't exist in them |
| Claude can't reach credentials | Separate OS users; the password reaches only the gateway, with its own secret |
| A broader user can't be pasted in | The gateway checks `SHOW GRANTS` and won't use anything beyond `SELECT` on the views |
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
```

Against the emulators, `RUNNER_FUNCTION_URL` is
`http://127.0.0.1:5201/demo-aditum-chat/us-central1/investigationRunner`, and `RUNNER_SHARED_SECRET`
must match `functions/.secret.local`.

## Setting up the Pi

1. **Masked views, on a machine that reaches MySQL.** Nothing here writes to the database by itself:

   ```sh
   ADMIN_DB_HOST=… ADMIN_DB_USER=… ADMIN_DB_PASSWORD=… pnpm --filter @aditum-chat/investigator classify deploy/pii-map.yml
   # A person reviews deploy/pii-map.yml.
   ADMIN_DB_HOST=… ADMIN_DB_USER=… ADMIN_DB_PASSWORD=… pnpm --filter @aditum-chat/investigator generate-views deploy/pii-map.yml deploy/views.generated.sql
   ```

   Run `views.generated.sql` and `deploy/create-ro-user.sql` by hand. Use `REQUIRE SSL` and restrict
   `__HOST__` to the Pi's address. Rerun both steps after schema changes: new columns stay hidden until then.

2. **Firebase:** set the `RUNNER_SHARED_SECRET` and `GATEWAY_SHARED_SECRET` secrets and deploy the
   functions and indexes.

3. **Install, from the console.** Under Configuración → Analizador an admin saves the Pi's public IP, SSH
   port, user and password, compares the fingerprint, pastes a token from `claude setup-token` and
   presses **Instalar en la Pi**. The user needs `sudo`. A Cloud Function logs in and runs
   `deploy/install.sh` from a checkout of `main` (`INVESTIGATOR_GIT_REF` overrides it). The script is safe
   to run again, and pressing the button later updates the Pi. It creates its own users, directories
   under `/opt` and `/var/lib`, `/etc/aditum-investigator/*.env` (mode 600) and the two services, with
   its own Node and Claude Code. Nothing else on the machine changes.

   Against the emulators, set `INVESTIGATOR_GIT_REF` and `INVESTIGATOR_PUBLIC_FUNCTIONS_URL` (a functions URL
   the Pi can reach) in `functions/.env.local`.

4. **Connection:** an admin enters the host, user and password under Configuración → Analizador, which
   shows the Pi's public IP for production's firewall. The gateway fetches them and tests them from
   the Pi. It refuses a user with more than `SELECT` on the views, and rechecks every hour.
   For MySQL's certificate to be verified, point `RO_DB_CA_FILE` at its CA (on RDS, the region's bundle).

5. **Reaching the Pi:** the Cloud Function pins the Pi's host key on the first successful login, so a
   different key stops the login before the password is sent. The passwords and tokens stay encrypted in
   `investigator_secrets/pi`. Cloud Functions has no fixed outbound IP, so the router can't limit the SSH
   port to it. Once installed, the services only make outbound calls: you can remove the connection and
   close the port until the next update.

Rows returned by queries stay on the Pi for 30 days, in `GATEWAY_LOG_DIR`. Firestore only gets the SQL,
row counts and the values cited as evidence.
