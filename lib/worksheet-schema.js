'use strict';
/** Exercise types a worksheet can contain, and the tool schema Claude must fill in. */

const TYPES = ['fill', 'short', 'choice', 'truefalse', 'match', 'open'];

const TOOL = {
  name: 'create_worksheet',
  description: 'Return the PDF worksheet as structured, interactive exercises.',
  input_schema: {
    type: 'object',
    required: ['title', 'answerKeyFound', 'sections'],
    properties: {
      title: { type: 'string', description: 'Worksheet title as printed in the PDF.' },
      answerKeyFound: { type: 'boolean', description: 'true only if the PDF itself contains the correct answers.' },
      sections: {
        type: 'array',
        description: 'One entry per exercise, in the original order.',
        items: {
          type: 'object',
          required: ['type', 'title', 'items'],
          properties: {
            type: { type: 'string', enum: TYPES },
            title: { type: 'string', description: 'e.g. "Exercise 2 – Complete the sentences"' },
            instructions: { type: 'string', description: 'The instruction line for students, in the original wording.' },
            passage: { type: 'string', description: 'Reading text / dialogue / table shown above the questions, if any.' },
            wordBank: { type: 'array', items: { type: 'string' }, description: 'Words students choose from, if the exercise has a word box.' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  prompt: { type: 'string', description: 'The question or sentence. For fill: the sentence with ___ for each blank.' },
                  answers: { type: 'array', items: { type: 'string' }, description: 'fill: one entry per blank (alternatives separated by |). short: accepted answers. choice/truefalse: exactly one entry that equals one of the options. match: omit.' },
                  options: { type: 'array', items: { type: 'string' }, description: 'choice only: the answer options.' },
                  hint: { type: 'string', description: 'A short nudge shown after a wrong answer. Helps without giving the answer away. British English.' },
                  explanation: { type: 'string', description: 'One or two short, simple sentences saying why the answer is right. British English.' },
                  left: { type: 'string', description: 'match only: the left-hand item.' },
                  right: { type: 'string', description: 'match only: its correct partner.' }
                }
              }
            }
          }
        }
      }
    }
  }
};

module.exports = { TYPES, TOOL };
