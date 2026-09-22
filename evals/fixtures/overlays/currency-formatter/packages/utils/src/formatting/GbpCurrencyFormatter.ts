import { ICurrencyFormatter } from './ICurrencyFormatter';

export class GbpCurrencyFormatter implements ICurrencyFormatter {
  readonly currencyCode = 'GBP';
  private readonly locale: string;

  constructor(locale: string = 'en-GB') {
    this.locale = locale;
  }

  format(minorUnits: number): string {
    const major = minorUnits / 100;
    const fixed = major.toFixed(2);
    const [whole, frac] = fixed.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `£${grouped}.${frac}`;
  }
}
