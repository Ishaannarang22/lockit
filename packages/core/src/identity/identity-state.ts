import { mkdir, readFile, rename, open } from "node:fs/promises";
import { dirname } from "node:path";
import {
  assertIdentityId,
  generateSharingIdentity,
  openWithPassphrase,
  publicIdentityFromWire,
  publicIdentityToWire,
  publicSharingIdentity,
  sealWithPassphrase,
  type PublicSharingIdentity,
  type SharingIdentity,
} from "@lockit/crypto";
import { identityPath } from "../paths.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

interface PrivateWireIdentity {
  v: 1;
  kind: "lockit.private-identity.v1";
  id: string;
  boxPublicKey: string;
  boxPrivateKey: string;
  signPublicKey: string;
  signPrivateKey: string;
}

interface PublicIdentityDocument {
  v: 1;
  kind: "lockit.identity.v1";
  id: string;
  boxPublicKey: string;
  signPublicKey: string;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function unb64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function privateToWire(identity: SharingIdentity): PrivateWireIdentity {
  return {
    v: 1,
    kind: "lockit.private-identity.v1",
    id: identity.id,
    boxPublicKey: b64(identity.boxPublicKey),
    boxPrivateKey: b64(identity.boxPrivateKey),
    signPublicKey: b64(identity.signPublicKey),
    signPrivateKey: b64(identity.signPrivateKey),
  };
}

function privateFromWire(wire: PrivateWireIdentity): SharingIdentity {
  const identity = {
    id: wire.id,
    boxPublicKey: unb64(wire.boxPublicKey),
    boxPrivateKey: unb64(wire.boxPrivateKey),
    signPublicKey: unb64(wire.signPublicKey),
    signPrivateKey: unb64(wire.signPrivateKey),
  };
  assertIdentityId(identity);
  return identity;
}

export function serializePublicIdentity(identity: PublicSharingIdentity): string {
  assertIdentityId(identity);
  const wire = publicIdentityToWire(identity);
  const doc: PublicIdentityDocument = {
    v: 1,
    kind: "lockit.identity.v1",
    id: wire.id,
    boxPublicKey: wire.boxPublicKey,
    signPublicKey: wire.signPublicKey,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function parsePublicIdentity(text: string): PublicSharingIdentity {
  const doc = JSON.parse(text) as Partial<PublicIdentityDocument>;
  if (
    doc.v !== 1 ||
    doc.kind !== "lockit.identity.v1" ||
    typeof doc.id !== "string" ||
    typeof doc.boxPublicKey !== "string" ||
    typeof doc.signPublicKey !== "string"
  ) {
    throw new Error("invalid public identity");
  }
  const identity = publicIdentityFromWire({
    id: doc.id,
    boxPublicKey: doc.boxPublicKey,
    signPublicKey: doc.signPublicKey,
  });
  assertIdentityId(identity);
  return identity;
}

async function saveIdentity(identity: SharingIdentity, passphrase: string, path: string): Promise<void> {
  const plaintext = new TextEncoder().encode(JSON.stringify(privateToWire(identity)));
  const blob = await sealWithPassphrase(plaintext, passphrase);
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmp = `${path}.tmp-${String(process.pid)}`;
  const handle = await open(tmp, "w", FILE_MODE);
  try {
    await handle.writeFile(blob);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

export async function loadOrCreateIdentity(
  passphrase: string,
  path = identityPath(),
): Promise<SharingIdentity> {
  try {
    const blob = await readFile(path, "utf8");
    const plaintext = await openWithPassphrase(blob, passphrase);
    const wire = JSON.parse(new TextDecoder().decode(plaintext)) as PrivateWireIdentity;
    if (wire.v !== 1 || wire.kind !== "lockit.private-identity.v1") {
      throw new Error("unsupported private identity");
    }
    return privateFromWire(wire);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const identity = await generateSharingIdentity();
    await saveIdentity(identity, passphrase, path);
    return identity;
  }
}

export function publicIdentity(identity: SharingIdentity): PublicSharingIdentity {
  return publicSharingIdentity(identity);
}
