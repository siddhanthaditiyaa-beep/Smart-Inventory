/**
 * STEP 10.2 — Slot → Product Mapper
 * --------------------------------
 * Combines:
 *  - ML slot occupancy output
 *  - Shelf planogram
 * Produces:
 *  - Present products
 *  - Missing products
 */


/**
 * Maps slot occupancy to product availability
 *
 * @param {string} shelfId
 * @param {number[]} occupiedSlots
 * @param {number[]} emptySlots
 */
function mapSlotsToProducts(shelfId, occupiedSlots, emptySlots) {
  const layout = shelfPlanogram[shelfId];

  if (!layout) {
    throw new Error(`No planogram defined for shelf ${shelfId}`);
  }

  const presentProducts = new Set();
  const missingProducts = new Set();

  // Occupied slots → present products
  occupiedSlots.forEach(slot => {
    const product = layout[slot];
    if (product) {
      presentProducts.add(product);
    }
  });

  // Empty slots → missing products
  emptySlots.forEach(slot => {
    const product = layout[slot];
    if (product) {
      missingProducts.add(product);
    }
  });

  return {
    present_products: Array.from(presentProducts),
    missing_products: Array.from(missingProducts)
  };
}

module.exports = mapSlotsToProducts;
