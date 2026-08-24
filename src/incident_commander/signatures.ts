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
export function verifyProcessorSignature(
  payload: SignaturePayload,
  signature: string,
  secret: string,
) {
  const expected = Buffer.from(processorSignature(payload, secret));
  const provided = Buffer.from(String(signature));
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}
