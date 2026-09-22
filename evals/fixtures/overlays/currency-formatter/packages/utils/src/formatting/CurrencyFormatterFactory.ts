import { ICurrencyFormatter } from './ICurrencyFormatter';
import { GbpCurrencyFormatter } from './GbpCurrencyFormatter';

type FormatterConstructor = new (locale?: string) => ICurrencyFormatter;

export class CurrencyFormatterFactory {
  private static registry = new Map<string, FormatterConstructor>([['GBP', GbpCurrencyFormatter]]);
  private static instances = new Map<string, ICurrencyFormatter>();

  static register(code: string, ctor: FormatterConstructor): void {
    this.registry.set(code, ctor);
  }

  static create(code: string = 'GBP', locale?: string): ICurrencyFormatter {
    const key = `${code}:${locale ?? 'default'}`;
    if (!this.instances.has(key)) {
      const Ctor = this.registry.get(code);
      if (!Ctor) throw new Error(`No formatter registered for ${code}`);
      this.instances.set(key, new Ctor(locale));
    }
    return this.instances.get(key)!;
  }
}
