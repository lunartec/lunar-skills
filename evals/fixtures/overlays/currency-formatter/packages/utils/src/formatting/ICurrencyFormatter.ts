export interface ICurrencyFormatter {
  format(minorUnits: number): string;
  readonly currencyCode: string;
}
