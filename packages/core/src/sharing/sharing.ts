import {
  createShareArtifact,
  openShareArtifact,
  type PublicSharingIdentity,
  type SharingIdentity,
} from "@lockit/crypto";
import { getSecret, upsertField, type StoreData, type StoredField } from "../store/store.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

interface SharedSecretPayload {
  v: 1;
  kind: "lockit.shared-secret.v1";
  slug: string;
  schema: string;
  fields: StoredField[];
  sharedAt: string;
}

export interface CreateSecretShareOptions {
  sender: SharingIdentity;
  recipient: PublicSharingIdentity;
  now?: () => Date;
}

export interface AcceptSecretShareOptions {
  as?: string;
}

export interface AcceptSecretShareResult {
  store: StoreData;
  slug: string;
  senderId: string;
}

export async function createSecretShare(
  store: StoreData,
  slug: string,
  options: CreateSecretShareOptions,
): Promise<string> {
  const secret = getSecret(store, slug);
  if (secret === undefined) throw new Error(`not found: ${slug}`);
  const payload: SharedSecretPayload = {
    v: 1,
    kind: "lockit.shared-secret.v1",
    slug: secret.slug,
    schema: secret.schema,
    fields: secret.fields.map((field) => ({ ...field })),
    sharedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  return await createShareArtifact({
    payload: enc.encode(JSON.stringify(payload)),
    recipient: options.recipient,
    sender: options.sender,
  });
}

function parseSharedSecretPayload(bytes: Uint8Array): SharedSecretPayload {
  const payload = JSON.parse(dec.decode(bytes)) as Partial<SharedSecretPayload>;
  if (
    payload.v !== 1 ||
    payload.kind !== "lockit.shared-secret.v1" ||
    typeof payload.slug !== "string" ||
    typeof payload.schema !== "string" ||
    !Array.isArray(payload.fields)
  ) {
    throw new Error("invalid shared secret payload");
  }
  for (const field of payload.fields) {
    if (
      typeof field !== "object" ||
      field === null ||
      typeof field.key !== "string" ||
      typeof field.value !== "string" ||
      (field.type !== "env" && field.type !== "file")
    ) {
      throw new Error("invalid shared secret field");
    }
  }
  return payload as SharedSecretPayload;
}

function freshSlug(store: StoreData, preferred: string): string {
  if (getSecret(store, preferred) === undefined) return preferred;
  for (let n = 2; ; n++) {
    const candidate = `${preferred}-${String(n)}`;
    if (getSecret(store, candidate) === undefined) return candidate;
  }
}

export async function acceptSecretShare(
  store: StoreData,
  artifact: string,
  recipient: SharingIdentity,
  options: AcceptSecretShareOptions = {},
): Promise<AcceptSecretShareResult> {
  const opened = await openShareArtifact(artifact, recipient);
  const payload = parseSharedSecretPayload(opened.payload);
  const slug = freshSlug(store, options.as ?? payload.slug);
  let next = store;
  for (const field of payload.fields) {
    next = upsertField(next, {
      slug,
      schema: payload.schema,
      key: field.key,
      type: field.type,
      value: field.value,
    });
  }
  return { store: next, slug, senderId: opened.sender.id };
}
