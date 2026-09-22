import { CurrencyFormatterFactory } from '@mono/utils/src/formatting/CurrencyFormatterFactory';
import { slugify } from '@utils/slugify';
import { renderSummary } from './summary';

/** Build the checkout view model for a basket. */
export function checkoutView(items: { name: string; pence: number }[]) {
  const total = items.reduce((s, i) => s + i.pence, 0);
  const formatter = CurrencyFormatterFactory.create('GBP');
  return { id: slugify(items.map((i) => i.name).join(' ')), total: formatter.format(total), summary: renderSummary(items) };
}
