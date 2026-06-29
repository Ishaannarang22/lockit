// libsodium-wrappers-sumo is pinned in package.json; see aead.ts for the note.
import _sodium from "libsodium-wrappers-sumo";
import { aeadOpen, aeadSeal, KEY_BYTES } from "./aead.js";

await _sodium.ready;

type SodiumWithSign = typeof _sodium & {
  crypto_sign_keypair: () => { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_sign_detached: (message: Uint8Array, privateKey: Uint8Array) => Uint8Array;
  crypto_sign_verify_detached: (
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ) => boolean;
  crypto_hash_sha256: (message: Uint8Array) => Uint8Array;
  crypto_box_curve25519xchacha20poly1305_keypair: () => {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  crypto_box_curve25519xchacha20poly1305_seal: (
    message: Uint8Array,
    publicKey: Uint8Array,
  ) => Uint8Array;
  crypto_box_curve25519xchacha20poly1305_seal_open: (
    ciphertext: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array,
  ) => Uint8Array;
};

const sodium = _sodium as SodiumWithSign;
const enc = new TextEncoder();

export interface PublicSharingIdentity {
  id: string;
  boxPublicKey: Uint8Array;
  signPublicKey: Uint8Array;
}

export interface SharingIdentity extends PublicSharingIdentity {
  boxPrivateKey: Uint8Array;
  signPrivateKey: Uint8Array;
}

export interface CreateShareArtifactInput {
  payload: Uint8Array;
  recipient: PublicSharingIdentity;
  sender: SharingIdentity;
}

export interface OpenedShareArtifact {
  payload: Uint8Array;
  sender: PublicSharingIdentity;
}

interface PublicWireIdentity {
  id: string;
  boxPublicKey: string;
  signPublicKey: string;
}

interface UnsignedWireArtifact {
  v: 1;
  kind: "lockit.share.v1";
  sender: PublicWireIdentity;
  recipient: { id: string };
  wrappedKey: string;
  nonce: string;
  ciphertext: string;
}

interface WireArtifact extends UnsignedWireArtifact {
  signature: string;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function unb64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => sortedJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`)
    .join(",")}}`;
}

function signingBytes(artifact: UnsignedWireArtifact): Uint8Array {
  return enc.encode(sortedJson(artifact));
}

function aadBytes(artifact: Pick<UnsignedWireArtifact, "v" | "kind" | "sender" | "recipient" | "wrappedKey">): Uint8Array {
  return enc.encode(sortedJson(artifact));
}

export function identityId(boxPublicKey: Uint8Array, signPublicKey: Uint8Array): string {
  const digest = sodium.crypto_hash_sha256(
    concatBytes([enc.encode("lockit:identity:v1:"), boxPublicKey, signPublicKey]),
  );
  return `kid_${b64url(digest).slice(0, 32)}`;
}

export async function generateSharingIdentity(): Promise<SharingIdentity> {
  const box = sodium.crypto_box_curve25519xchacha20poly1305_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    id: identityId(box.publicKey, sign.publicKey),
    boxPublicKey: box.publicKey,
    boxPrivateKey: box.privateKey,
    signPublicKey: sign.publicKey,
    signPrivateKey: sign.privateKey,
  };
}

export function publicSharingIdentity(identity: SharingIdentity): PublicSharingIdentity {
  return {
    id: identity.id,
    boxPublicKey: identity.boxPublicKey,
    signPublicKey: identity.signPublicKey,
  };
}

export function assertIdentityId(identity: PublicSharingIdentity): void {
  const expected = identityId(identity.boxPublicKey, identity.signPublicKey);
  if (identity.id !== expected) throw new Error("identity id does not match public keys");
}

export async function createShareArtifact(input: CreateShareArtifactInput): Promise<string> {
  assertIdentityId(input.sender);
  assertIdentityId(input.recipient);
  const dek = await import("./aead.js").then((m) => m.randomBytes(KEY_BYTES));
  const sender = publicSharingIdentity(input.sender);
  const senderWire = publicIdentityToWire(sender);
  const wrappedKey = sodium.crypto_box_curve25519xchacha20poly1305_seal(
    dek,
    input.recipient.boxPublicKey,
  );

  const aadBase = {
    v: 1 as const,
    kind: "lockit.share.v1" as const,
    sender: senderWire,
    recipient: { id: input.recipient.id },
    wrappedKey: b64(wrappedKey),
  };
  const sealed = await aeadSeal(input.payload, dek, aadBytes(aadBase));
  const unsigned: UnsignedWireArtifact = {
    ...aadBase,
    nonce: b64(sealed.nonce),
    ciphertext: b64(sealed.ciphertext),
  };
  const signature = sodium.crypto_sign_detached(signingBytes(unsigned), input.sender.signPrivateKey);
  const wire: WireArtifact = { ...unsigned, signature: b64(signature) };
  return JSON.stringify(wire);
}

export async function openShareArtifact(
  artifact: string,
  recipient: SharingIdentity,
): Promise<OpenedShareArtifact> {
  assertIdentityId(recipient);
  const wire = parseWireArtifact(artifact);
  if (wire.recipient.id !== recipient.id) {
    throw new Error("share artifact is not addressed to this recipient");
  }
  const sender = publicIdentityFromWire(wire.sender);
  assertIdentityId(sender);
  const { signature: _signature, ...unsigned } = wire;
  const signature = unb64(wire.signature);
  const ok = sodium.crypto_sign_verify_detached(signature, signingBytes(unsigned), sender.signPublicKey);
  if (!ok) throw new Error("share artifact signature verification failed");
  const dek = sodium.crypto_box_curve25519xchacha20poly1305_seal_open(
    unb64(wire.wrappedKey),
    recipient.boxPublicKey,
    recipient.boxPrivateKey,
  );
  if (dek.length !== KEY_BYTES) throw new Error("share artifact opened an invalid key");
  const payload = await aeadOpen(
    { nonce: unb64(wire.nonce), ciphertext: unb64(wire.ciphertext) },
    dek,
    aadBytes({
      v: wire.v,
      kind: wire.kind,
      sender: wire.sender,
      recipient: wire.recipient,
      wrappedKey: wire.wrappedKey,
    }),
  );
  return { payload, sender };
}

export function publicIdentityToWire(identity: PublicSharingIdentity): PublicWireIdentity {
  return {
    id: identity.id,
    boxPublicKey: b64(identity.boxPublicKey),
    signPublicKey: b64(identity.signPublicKey),
  };
}

export function publicIdentityFromWire(wire: PublicWireIdentity): PublicSharingIdentity {
  if (typeof wire.id !== "string") throw new Error("invalid public identity");
  return {
    id: wire.id,
    boxPublicKey: unb64(wire.boxPublicKey),
    signPublicKey: unb64(wire.signPublicKey),
  };
}

function parseWireArtifact(text: string): WireArtifact {
  const parsed = JSON.parse(text) as Partial<WireArtifact>;
  if (
    parsed.v !== 1 ||
    parsed.kind !== "lockit.share.v1" ||
    typeof parsed.signature !== "string" ||
    typeof parsed.wrappedKey !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.sender !== "object" ||
    parsed.sender === null ||
    typeof parsed.recipient !== "object" ||
    parsed.recipient === null ||
    typeof parsed.recipient.id !== "string"
  ) {
    throw new Error("invalid share artifact");
  }
  return parsed as WireArtifact;
}
