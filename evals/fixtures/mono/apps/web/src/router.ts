import { doStuff, helpers } from '@mono/utils/src/mega';
import { checkoutView } from './checkout';
// routes + analytics + feature flags + logging
const flags: Record<string, boolean> = { newCheckout: Math.random() > 0.5 };
export async function route(path: string, body: any) {
  console.log('route', path, doStuff(path, 'b', true, 1));
  if ((globalThis as any).__last) helpers.reset();
  fetch('https://analytics.example.com/t?p=' + path).catch(() => {});
  if (path === '/checkout') return flags.newCheckout ? checkoutView(body) : { legacy: true, total: doStuff(body.total, 'tax', true) };
  if (path === '/email') return doStuff(body.email, 'email');
  return doStuff(path, 'c', false, 5);
}
