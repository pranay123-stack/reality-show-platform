# Security audit — Phase 18

**Date:** 10 August 2026 · **Scope:** the whole platform, phases 0–17 · **Method:** code review
plus live attack attempts against a running stack.

Every finding below was *reproduced* before it was fixed and *re-tested* afterwards. Where a
defence already held, that is recorded too — a review that only lists failures gives no sense of
what is actually load-bearing.

---

## Summary

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | **High** | A WebSocket authorised once at handshake and never again: a suspended account kept voting and earning points | Fixed |
| F2 | **High** | `z.string().url()` accepts `javascript:` and `data:`, so a stored URL could execute on click | Fixed |
| F3 | Medium | No rate limiting on socket events; 60 rapid `poll:join` all served, each a database read | Fixed |
| F4 | Medium | CSV export was vulnerable to spreadsheet formula injection | Fixed |
| F5 | Medium | Rate limiting returned **500** instead of 429, so no client ever saw `RATE_LIMITED` | Fixed |
| F6 | Low | An unvalidated enum in a query reached Prisma and surfaced as a 500 | Fixed |
| F7 | Low | Socket payload ids were unbounded; a 100 000-character id reached the database | Fixed |
| F8 | Low | A uniqueness conflict returned the offending database column names | Fixed |
| F9 | Low | Rate limits keyed only on IP, so an authenticated abuser could rotate addresses | Fixed |
| F10 | Low | Three dependency advisories (2 high, 1 low) | Fixed |
| F11 | Info | No Content-Security-Policy on the web app | Fixed — `script-src` amended in Phase 20, see below |

Ten of the eleven were introduced by this codebase; F10 came from dependencies.

---

## The security model

Four properties the platform is built to hold. Everything below is in service of these.

1. **The server is the only source of truth for anything valuable.** Vote counts, points, ranks,
   heat scores and results are computed server-side. No endpoint anywhere accepts a points figure,
   a rank, a balance or a reward status from a client — a fact this audit re-verified by probing
   for such an endpoint rather than by reading the code.
2. **Authorisation is checked at the API, on every call.** The frontend hides what a caller cannot
   do; that is courtesy, not security. Every operator route independently checks a permission, and
   the tests prove a moderator calling a producer route directly is still refused.
3. **Money-like operations are guarded by the database, not by application checks.** One vote per
   subject, one ledger entry per (user, source, reason), one redemption per (user, reward, cycle) —
   all unique indexes. Application checks exist to return a friendly error before the database
   returns a rude one.
4. **Sensitive actions are recorded.** Every operator mutation writes an append-only `AuditLog`
   row. A refused action writes nothing, because a refused action is not an action.

---

## Findings in detail

### F1 — A socket authorised once and never again *(High)*

**What happened.** The Socket.IO handshake resolved the principal and pinned it to the socket.
Nothing re-checked it. A socket lives for hours; everything decided at connect time — account
status, role, whether the session was revoked — was a snapshot that went stale the moment a
moderator acted.

**Reproduction.** Connect as an active user, suspend the account in the database, invalidate the
session cache, then vote:

```
connected as usr_viewer3 (status ACTIVE)
account suspended: SUSPENDED
HTTP vote after suspension -> 404          # the HTTP path re-checks
WS   vote after suspension -> ok=true points=3
```

A banned account could keep voting and earning points indefinitely, and the only thing that would
stop it was the attacker choosing to reconnect.

**Fix.** `realtime/guard.ts` re-resolves the principal on every privileged event. `resolveSession`
is Redis-cached for 30 seconds, so the cost is a cache read and the exposure window now matches
HTTP's instead of being unbounded. Role changes and revoked sessions are caught by the same path.

**After.** `WS vote after suspension -> ok=false code=SESSION_REVOKED`

---

### F2 — `javascript:` URLs passed validation *(High)*

**What happened.** `z.string().url()` delegates to the `URL` constructor, which accepts
`javascript:alert(1)`, `data:text/html,…` and `vbscript:`. Three fields took URLs this way —
contestant avatars, profile avatars, weekend media — and the notification `link` had no validation
at all despite being rendered into an anchor.

**Reproduction.** `PATCH /users/me {"avatarUrl":"javascript:alert(document.cookie)"}` → stored
verbatim.

**Why it mattered.** An avatar in an `<img src>` is inert in modern browsers, but the notification
link is rendered into `<Link href>` and fires on click. The announcement endpoint is admin-only,
which makes this an admin-to-XSS-on-every-user escalation — and an administrator should not be able
to attack their own users.

**Fix.** `safeUrlSchema` (absolute http/https only) and `safeLinkSchema` (in-app path or http/https,
rejecting protocol-relative `//evil.example`) in `schemas/common.ts`, applied to every URL-bearing
field. Notification links are additionally re-checked *after* template rendering, because a
template's placeholders are filled from event payloads — the rendered result is what has to be safe,
not the template.

**After.** `400 {"fieldErrors":{"avatarUrl":["Enter a valid http(s) URL"]}}`

---

### F3 / F7 — Unbounded socket events *(Medium / Low)*

HTTP routes were rate limited; socket events were not. Sixty rapid `poll:join` calls were all
served, each costing a database read, from an unauthenticated connection. Payload ids were unbounded
— a 100 000-character id reached the database as a query parameter.

**Fix.** A Redis-backed per-socket limiter (20 joins / 10 votes per 10 seconds) and a 64-character
bound on ids, checked before anything else. The limiter fails open on a Redis outage: it is a
safeguard, not a gate, and a live show must not stop because a cache is unreachable.

**After.** `30 rapid poll:join -> accepted=20, rate-limited=10` · `oversized id -> BAD_REQUEST`

---

### F4 — Spreadsheet formula injection in the CSV export *(Medium)*

A display name of `=cmd|'/c calc'!A0` is inert everywhere on the platform and executes the moment an
operator opens the leaderboard export in Excel. Quoting does not help; the formula is evaluated
after the CSV is parsed.

**Fix.** A cell beginning `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an apostrophe,
which spreadsheets read as "this is text".

---

### F5 — Rate limiting answered 500, not 429 *(Medium)*

The limiter's `errorResponseBuilder` returned a plain envelope. `@fastify/rate-limit` **throws**
whatever that function returns, so a bare object arrived at the error funnel with no `statusCode`
and fell through to the 500 branch.

The limit was enforced — but every throttled client was told the server had broken rather than that
it should slow down, and no `RATE_LIMITED` code ever reached the web app's error handling. A client
that believes it hit a server fault retries harder, which is the opposite of the intended effect.

This had no test, which is how it survived seventeen phases.

**Fix.** The builder returns an `AppError` with status 429, which the funnel already renders
correctly. **After:** `429 {"code":"RATE_LIMITED","message":"Too many requests. Try again in 1 hour."}`

---

### F6, F8, F9 — Smaller items

- **Unvalidated enum → 500.** `GET /contestants?status=<anything>` passed a raw string to a Prisma
  enum filter. Now `z.enum(CONTESTANT_STATUSES)`; a bad value is a 400. Every other list endpoint
  was probed and already validated.
- **Uniqueness conflicts leaked column names.** A P2002 returned `details: { fields: [...] }` —
  schema internals. Removed; a service that wants to name the clashing field does so in its own
  words.
- **Rate limits keyed on IP alone.** That throttles a university behind one NAT collectively while
  not throttling an attacker who can rotate addresses. Signed-in traffic is now keyed on the
  account. The token is *verified* in the key generator rather than trusted, because an unverified
  claim would let an attacker choose which bucket to spend — including somebody else's.

---

### F10 / F11 — Dependencies and headers

`pnpm audit` reported 10 vulnerabilities (5 high). All were transitive and build-time:
`postcss` (path traversal, arbitrary file read), `sharp` (libvips CVEs, reached only through Next's
image optimiser, which this app does not use) and `esbuild` (dev server). Pinned via `pnpm.overrides`
so a fresh install cannot silently reintroduce them. **`pnpm audit` now reports zero advisories.**

The web app had sensible headers but no Content-Security-Policy. Added — `object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`, and no `'unsafe-inline'` in `script-src` outside
development. This is defence in depth rather than the primary defence: React escapes what it
renders and no component uses `dangerouslySetInnerHTML`. It is what catches the mistake somebody
makes later.

> **Amended in Phase 20.** `script-src` now allows `'unsafe-inline'` in production as well.
> The directive above was only ever exercised against `next dev`, which keeps `'unsafe-inline'`
> for React Refresh. Against a production build it blocked the App Router's inline bootstrap
> scripts, so **React never hydrated and every page served a dead shell** — a total loss of
> function that no test caught because nothing ran against `pnpm build`.
>
> A per-request nonce is the strict alternative and does not work here: a nonce must be unique
> per response, and 30 of these routes are statically prerendered to HTML at build time, so
> nonces would mean abandoning static rendering across the app. That is a larger decision than
> a header, and not one to make silently while polishing UI.
>
> **Accepted risk:** an injected inline `<script>` would execute if one ever reached the DOM.
> What still stands against it: React escapes all rendered output, no component uses
> `dangerouslySetInnerHTML`, `'unsafe-eval'` remains absent in production, and `object-src
> 'none'` / `base-uri 'self'` / `form-action 'self'` close the usual bypasses. Revisiting means
> deciding whether these routes should be dynamically rendered — see Phase 22.

---

## Defences that held

Verified by attempting to break them, not by reading the code.

| Attack | Result |
| --- | --- |
| Mass assignment (`role`, `pointsBalance`, `status` in a profile update) | Ignored — zod strips unknown keys; role and balance unchanged |
| SQL injection through query parameters and path segments | No effect; Prisma parameterises everything. `' OR 1=1--` as a path returned a clean 404 |
| Brute force on login | Locked out after 5 attempts, and the *correct* password is refused once locked |
| Refresh token replay | Reuse detection destroys the whole session family, including the legitimate holder's |
| CSRF (cookie without the double-submit header) | 403 |
| Duplicate voting, including 20 simultaneous requests | Exactly one vote recorded |
| Vote with an option id from a different poll | Refused |
| Reward replay — 10 simultaneous redemptions | One redemption, one debit, inventory down by one |
| Redeem-and-cancel farming | Balance and **lifetime points** both unchanged, so it cannot climb a level or a leaderboard |
| Concurrent overdraw (two 400-point redemptions on a 500-point balance) | One succeeds; balance never goes negative |
| Anonymous WebSocket vote | Refused; anonymous join sees no per-option split |
| Error responses | No stack traces, no SQL, no `node_modules` paths; every error carries a request id |
| Password reset enumeration | Identical response for a known and an unknown address |
| Secrets in responses | No password hash, refresh-token hash or secret in any payload |
| Oversized request bodies | 1 MiB body limit plus per-field zod bounds |

---

## Attack scenarios tested

40 security integration tests in `apps/api/tests/integration/security.test.ts`, grouped by the ten
scenarios the phase brief specified:

1. Unauthorised admin access — console and every operator read, as a user and anonymously
2. Privilege escalation — mass assignment, moderator→producer, producer→admin, stale-role tokens,
   forged and tampered tokens
3. Duplicate voting — repeat, concurrent, cross-poll option ids, closed polls, unverified accounts
4. Points manipulation — no endpoint accepts a figure; negative and fractional costs; overdraw;
   ledger-versus-balance consistency
5. Reward replay — concurrent redemption; refund farming
6. Token reuse — refresh replay, logout invalidation, CSRF absent and mismatched
7. WebSocket authorisation — suspended, revoked and role-changed principals
8. Injected content — dangerous URL schemes, announcement links, stored XSS, oversized payloads,
   CSV formulas, malformed filters
9. Rate limiting — login lockout, per-route limits, socket event limits
10. Sensitive data — secrets, other users' emails, error contents, enumeration, column names

---

## Remaining risks

Stated plainly, because a security document that claims completeness is not credible.

- **No account-level anomaly detection.** The four anti-duplicate layers from Phase 3 (email
  normalisation, device fingerprinting, session overlap, phone verification) raise the cost of
  running many accounts but do not detect a patient attacker who spreads activity across them.
  Rate limits are per-account and per-address; nothing correlates *behaviour* across accounts.
- **Broadcast notifications are capped at 5 000 recipients.** Beyond that the fan-out silently
  covers only the first 5 000. That is a correctness limit rather than a vulnerability, but an
  operator should know the ceiling exists.
- **Email and push channels are unimplemented.** They report `SKIPPED`, so no email is sent at all
  today — including password resets, which are logged rather than delivered in development. Wiring a
  provider will need its own review of the reset-token flow end to end.
- **The audit trail is append-only by construction but not cryptographically chained.** An attacker
  with direct database access could delete rows. Tamper-evidence would need hash chaining or
  shipping to write-once storage.
- **No secrets rotation procedure.** `JWT_SECRET` and `COOKIE_SECRET` are read from the environment;
  rotating them invalidates every session at once, and there is no dual-key window.
- **`sharp` is overridden rather than removed.** The app does not use `next/image`, so the
  vulnerable path is not reachable, but the dependency is still installed.
- **The kitchen concurrency tests are load-sensitive**, so a security regression could in principle
  hide behind a flaky failure on a busy machine. Run the suite with the dev servers stopped.

---

## Logging

Reviewed against the requirement that secrets never reach the logs.

Pino redaction covers `authorization`, `cookie`, `set-cookie`, `x-api-key`, every password field,
`token`, `refreshToken`, `accessToken`, `secret`, `passwordHash`. The request serialiser deliberately
does not log bodies at all — redaction is the backstop, not the primary defence.

Security-relevant events that are recorded: failed logins and lockouts (throttle counters plus a
warn line), every operator mutation (`AuditLog` with actor, role, before/after and request id),
refresh-token reuse (destroys the session family and logs it), notification delivery failures, and
now rate-limit rejections with a distinguishable code.

An audit row is written **only when an action succeeds**, which is asserted by a test: a refused
action is not an action, and recording attempts would fill the trail with noise that buries the
real ones.
