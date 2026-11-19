/* A flat index of every question in a worksheet, so the player can find one by its id. */

const itemId = (sectionIndex, itemIndex) => 's' + sectionIndex + 'i' + itemIndex;

/** The drop-down choices for a matching exercise: every right-hand side once, in a stable shuffle. */
function matchChoices(section, random) {
  const seen = {};
  const rightSides = section.items
    .map(item => item.answers[0] || item.right)
    .filter(text => text && !seen[text] && (seen[text] = true));
  return shuffle(rightSides, random);
}

function buildItemIndex(worksheet) {
  const random = seededRandom(hash(worksheet.title + '|' + worksheet.sections.length));
  const items = {};
  const matchOptions = {};

  worksheet.sections.forEach((section, sectionIndex) => {
    if (section.type === 'match') matchOptions[sectionIndex] = matchChoices(section, random);
    section.items.forEach((item, itemIndex) => {
      const id = itemId(sectionIndex, itemIndex);
      items[id] = { id, item, section, sectionIndex, itemIndex, scored: isScored(section, item) };
    });
  });

  const scoredIds = Object.keys(items).filter(id => items[id].scored);
  return { items, matchOptions, scoredIds };
}
