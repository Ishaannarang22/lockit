# Portable identity security review notes

This branch tightened the portable reference flow around the core invariants:

- `lockit resolve` may fill plaintext only after local human authorization, or after a keychain unlock that already proves local presence. `--yes` and `LOCKIT_PULL_YES=1` are not authorization.
- Inside a lockit project, `resolve` must respect the project-world sandbox. A reference can be filled only when the target env name is already admitted in `.lockit/vault.json` to the same concrete `slug#field`.
- Reference files are still value-free, but the injected env names must be unique. Duplicate env names are hard errors in parsing and export.
- When `resolve` writes plaintext to `.env` or `.env.local` inside a git repo, lockit adds that path to `.gitignore` and warns, matching the existing plaintext materialization guard.

Successful admission still requires human confirmation plus local auth. Account recovery remains intentionally unsupported: losing the passphrase and all trusted devices means the encrypted data cannot be recovered.
