import { describe, expect, it } from "vitest";
import { generateSharingIdentity, publicSharingIdentity } from "@lockit/crypto";
import { emptyStore, getSecret, upsertField } from "../store/store.js";
import { acceptSecretShare, createSecretShare } from "./sharing.js";

describe("store sharing", () => {
  it("accepts a shared secret as a new point-in-time copy", async () => {
    const alice = await generateSharingIdentity();
    const bob = await generateSharingIdentity();

    let aliceStore = emptyStore();
    aliceStore = upsertField(aliceStore, {
      slug: "supabase/acme",
      schema: "supabase",
      key: "SUPABASE_URL",
      type: "env",
      value: "https://old.example",
    });

    const artifact = await createSecretShare(aliceStore, "supabase/acme", {
      sender: alice,
      recipient: publicSharingIdentity(bob),
    });

    aliceStore = upsertField(aliceStore, {
      slug: "supabase/acme",
      schema: "supabase",
      key: "SUPABASE_URL",
      type: "env",
      value: "https://new.example",
    });

    const accepted = await acceptSecretShare(emptyStore(), artifact, bob);
    expect(accepted.slug).toBe("supabase/acme");
    expect(getSecret(accepted.store, "supabase/acme")?.fields[0]?.value).toBe("https://old.example");
  });

  it("never overwrites an existing slug on accept", async () => {
    const alice = await generateSharingIdentity();
    const bob = await generateSharingIdentity();
    let aliceStore = emptyStore();
    aliceStore = upsertField(aliceStore, {
      slug: "stripe/prod",
      schema: "stripe",
      key: "STRIPE_KEY",
      type: "env",
      value: "shared-value",
    });
    const artifact = await createSecretShare(aliceStore, "stripe/prod", {
      sender: alice,
      recipient: publicSharingIdentity(bob),
    });

    let bobStore = emptyStore();
    bobStore = upsertField(bobStore, {
      slug: "stripe/prod",
      schema: "stripe",
      key: "STRIPE_KEY",
      type: "env",
      value: "existing-value",
    });

    const accepted = await acceptSecretShare(bobStore, artifact, bob);
    expect(accepted.slug).toBe("stripe/prod-2");
    expect(getSecret(accepted.store, "stripe/prod")?.fields[0]?.value).toBe("existing-value");
    expect(getSecret(accepted.store, "stripe/prod-2")?.fields[0]?.value).toBe("shared-value");
  });
});
