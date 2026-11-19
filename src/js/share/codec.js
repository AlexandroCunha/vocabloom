/*
 * Share links: the whole worksheet lives in the URL hash (compressed), so no database is needed.
 * The part after "#" is never sent to the server when a student opens the link.
 */

const MAX_LINK_CHARS = 400000;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;

const base64url = {
  encode(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    text = text.replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) text += '=';
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
};

/** Returns "s=..." (compressed) or "j=..." (plain, when the browser cannot compress). */
async function pack(worksheet) {
  const bytes = new TextEncoder().encode(slimJSON(worksheet));
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 's=' + base64url.encode(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'j=' + base64url.encode(bytes);
}

/** Reads a stream but gives up as soon as it grows past `max` bytes (protects against zip bombs). */
async function readLimited(stream, max) {
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('Worksheet too large');
    }
    parts.push(chunk.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach(part => { out.set(part, offset); offset += part.length; });
  return out;
}

/** Turns a URL hash back into a worksheet, or returns null when it is not a worksheet link. */
async function unpack(hashText) {
  if (String(hashText).length > MAX_LINK_CHARS) return null;
  const match = String(hashText).match(/^#?([sj])=([\w-]+)$/);
  if (!match) return null;
  let bytes = base64url.decode(match[2]);
  if (match[1] === 's') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    bytes = await readLimited(stream, MAX_UNPACKED_BYTES);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
