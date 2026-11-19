'use strict';
/** Checks a base64 PDF before it is sent anywhere. */
const { LIMITS } = require('./config');

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PDF_MAGIC_IN_BASE64 = 'JVBER'; // "%PDF-" encoded

/** Returns { status, message } describing the problem, or null when the PDF looks acceptable. */
function findPdfProblem(pdf) {
  if (!pdf) return { status: 400, message: 'No PDF received.' };
  if (pdf.length > LIMITS.maxPdfBase64Chars) {
    return { status: 413, message: 'The PDF is too large (limit about 3 MB). Compress it and try again.' };
  }
  if (!pdf.startsWith(PDF_MAGIC_IN_BASE64) || !BASE64.test(pdf)) {
    return { status: 400, message: 'That file is not a PDF.' };
  }
  return null;
}

module.exports = { findPdfProblem };
