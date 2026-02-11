/**
 * Crypto utilities using Web Crypto API with Node.js fallback.
 * Works on Cloudflare Workers, Deno, Bun, and Node.js 18+.
 */

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute MD5 hash of a string.
 * Uses Web Crypto (CF Workers, Deno, Bun) with node:crypto fallback (Node.js).
 */
export async function md5(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);

  try {
    // Web Crypto - works on CF Workers, Deno, Bun
    const hashBuffer = await crypto.subtle.digest("MD5", data);
    return bufferToHex(hashBuffer);
  } catch {
    // Fallback for Node.js (Web Crypto doesn't support MD5)
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("md5").update(message).digest("hex");
  }
}

/** Base64 encode a string */
export function base64Encode(str: string): string {
  return btoa(str);
}

/** Base64 decode a string */
export function base64Decode(str: string): string {
  return atob(str);
}
