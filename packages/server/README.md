# @lockit/server

Ciphertext-only relay for interim end-to-end secret sharing.

This is intentionally small infrastructure. It accepts encrypted share artifacts
from `lockit share`, stores them by recipient identity id, and returns them to
`lockit receive`. It never receives a passphrase, private key, DEK, seed, or
plaintext secret value.

It also provides a tiny public username registry:

```txt
@username -> recipient identity id + public encryption/signing keys
```

Usernames are globally unique after lowercase normalization. First claim wins;
there is no password login and no account recovery in this interim relay.

## Run Locally

```sh
pnpm --filter @lockit/server build
pnpm --filter @lockit/server start
```

By default it listens on `127.0.0.1:8787` and stores messages/usernames in memory.

```sh
lockit identity register bob --relay http://127.0.0.1:8787
lockit share openai/dev --to @bob --relay http://127.0.0.1:8787
lockit receive --relay http://127.0.0.1:8787
```

## Public Interim Deployment

For Railway, Fly.io, Render, or any simple Node host:

- Build: `pnpm --filter @lockit/server build`
- Start: `pnpm --filter @lockit/server start`
- Runtime env:
  - `PORT` is honored automatically.
  - `HOST` defaults to `0.0.0.0` when `PORT` is set, otherwise `127.0.0.1`.
  - `DATABASE_URL` enables Postgres-backed persistence and username uniqueness.
  - `LOCKIT_RELAY_DATA_PATH` enables file-backed persistence when Postgres is not used.

Example:

```sh
PORT=8787 HOST=0.0.0.0 DATABASE_URL=postgres://... pnpm --filter @lockit/server start
```

On Railway, attach a Postgres database to the service and Railway will provide
`DATABASE_URL`. The relay creates these tables automatically:

```txt
lockit_relay_users
lockit_relay_messages
```

If neither `DATABASE_URL` nor `LOCKIT_RELAY_DATA_PATH` is set, the relay is
memory-only and messages/usernames disappear on restart or redeploy. A mounted
volume is acceptable for a single-process dev relay, but Postgres is the better
public default because the database enforces unique usernames and identity ids.

## Honest Limits

The relay cannot decrypt secret values, but it is public metadata infrastructure:
it can see usernames, public identity keys, recipient identity ids, message sizes,
timestamps, and sender/recipient graph shape. Anyone who can reach a public
unauthenticated relay can claim unused usernames and submit ciphertext messages,
so this is a temporary convenience relay, not the full team server with auth,
Key Transparency, OPAQUE login, quotas, or abuse controls.
