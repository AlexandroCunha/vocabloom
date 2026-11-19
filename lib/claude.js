'use strict';
/**
 * The only module that talks to the AI provider.
 * Claude reads the PDF (text and layout) and answers by calling the create_worksheet tool,
 * so the result always arrives as structured JSON.
 */
const { TOOL } = require('./worksheet-schema');
const { SYSTEM } = require('./prompt');
const { normalize } = require('./normalize');

const INSTRUCTION = 'Convert this PDF worksheet into interactive exercises. Reply only by calling the create_worksheet tool.';

/** An error whose message is safe to show to users. Provider details never go in `publicMessage`. */
class ConversionError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.name = 'ConversionError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function buildRequest(pdf, model) {
  return {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [TOOL],
    // Forcing a specific tool is not supported by every model, so the prompt asks for it instead.
    tool_choice: { type: 'auto' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
        { type: 'text', text: INSTRUCTION }
      ]
    }]
  };
}

async function postToProvider(pdf, { apiUrl, apiKey, model }) {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildRequest(pdf, model))
    });
    return { response, data: await response.json() };
  } catch (error) {
    throw new ConversionError(502, 'Could not reach the AI service. Please try again.');
  }
}

function assertUsableReply({ response, data }) {
  if (!response.ok) {
    // The provider's message stays in the server log only: it is never shown to users.
    console.error('AI service error', response.status);
    if (response.status === 429 || response.status === 529) {
      throw new ConversionError(503, 'The AI service is busy. Try again in a minute.');
    }
    throw new ConversionError(502, 'The AI service returned an error. Please try again.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new ConversionError(422, 'This PDF is too long to convert in one go. Split it into smaller parts.');
  }
}

/** Converts a base64 PDF into a validated worksheet, or throws ConversionError. */
async function convertPdf(pdf, settings) {
  const reply = await postToProvider(pdf, settings);
  assertUsableReply(reply);

  const toolUse = (reply.data.content || []).find(block => block.type === 'tool_use');
  if (!toolUse) throw new ConversionError(502, 'The AI did not return a worksheet. Please try again.');

  const worksheet = normalize(toolUse.input);
  if (!worksheet.sections.length) throw new ConversionError(422, 'No exercises were found in this PDF.');
  return worksheet;
}

module.exports = { convertPdf, ConversionError, buildRequest };
