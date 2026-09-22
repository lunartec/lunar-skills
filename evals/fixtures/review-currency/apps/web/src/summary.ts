/** One-line human summary of basket contents. */
export const renderSummary = (items: { name: string }[]) => `${items.length} item(s): ${items.map((i) => i.name).join(', ')}`;
