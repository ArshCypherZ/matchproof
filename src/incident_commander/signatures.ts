import crypto from "node:crypto";

export type SignaturePayload = Record<string, string | number | boolean | null>;
export function processorSignature(payload: SignaturePayload, secret: string) {
  const copy = { ...payload };
  delete copy.signature_verified;
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(copy, Object.keys(copy).sort()))
    .digest("hex");
}

/** SHA-256 hex digest: 64 lowercase hex characters. */
export function isHexSignature(signature: string) {
  return /^[0-9a-f]{64}$/.test(signature);
}

export function verifyProcessorSignature(
  payload: SignaturePayload,
  signature: string,
  secret: string,
) {
  if (!isHexSignature(signature)) return false;
  const expected = Buffer.from(processorSignature(payload, secret));
  const provided = Buffer.from(signature);
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}
