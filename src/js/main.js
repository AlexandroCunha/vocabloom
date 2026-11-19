/*
 * Vocabloom: PDF -> interactive worksheet.
 * Two modes: teacher (upload, review, share) and student (worksheet only).
 * The worksheet for students comes from the link hash, or is embedded in a downloaded file.
 */

async function findWorksheet() {
  try {
    const embedded = JSON.parse($('#ws-data').textContent);
    if (embedded) return embedded;
  } catch (error) { /* nothing embedded */ }
  if (location.hash.length > 3) {
    try { return await unpack(location.hash); } catch (error) { return null; }
  }
  return null;
}

(async function start() {
  const worksheet = await findWorksheet();
  if (worksheet && worksheet.sections) {
    document.title = worksheet.title || 'Worksheet';
    renderPlayer($('#app'), worksheet, { persist: true });
  } else {
    startTeacher();
  }
})();
