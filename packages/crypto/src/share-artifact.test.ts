import { describe, expect, it } from "vitest";
import {
  createShareArtifact,
  generateSharingIdentity,
  openShareArtifact,
  publicSharingIdentity,
} from "./share-artifact.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("share artifacts", () => {
  it("round-trips only for the intended recipient and does not serialize plaintext", async () => {
    const sender = await generateSharingIdentity();
    const recipient = await generateSharingIdentity();
    const thirdParty = await generateSharingIdentity();

    const payload = enc.encode(
      JSON.stringify({
        slug: "openai/dev",
        fields: [{ key: "OPENAI_API_KEY", value: "sk-test-secret" }],
      }),
    );

    const artifact = await createShareArtifact({
      payload,
      recipient: publicSharingIdentity(recipient),
      sender,
    });

    expect(artifact).not.toContain("sk-test-secret");
    expect(artifact).not.toContain(Buffer.from("sk-test-secret").toString("base64"));
    expect(artifact).not.toContain(Buffer.from(sender.signPrivateKey).toString("base64"));
    expect(artifact).not.toContain(Buffer.from(recipient.boxPrivateKey).toString("base64"));

    const opened = await openShareArtifact(artifact, recipient);
    expect(dec.decode(opened.payload)).toBe(dec.decode(payload));
    expect(opened.sender.id).toBe(sender.id);

    await expect(openShareArtifact(artifact, thirdParty)).rejects.toThrow(/recipient/);
  });

  it("rejects a tampered artifact", async () => {
    const sender = await generateSharingIdentity();
    const recipient = await generateSharingIdentity();
    const artifact = await createShareArtifact({
      payload: enc.encode("known secret"),
      recipient: publicSharingIdentity(recipient),
      sender,
    });

    const wire = JSON.parse(artifact) as { ciphertext: string };
    wire.ciphertext = `${wire.ciphertext.slice(0, -2)}AA`;

    await expect(openShareArtifact(JSON.stringify(wire), recipient)).rejects.toThrow();
  });
});
