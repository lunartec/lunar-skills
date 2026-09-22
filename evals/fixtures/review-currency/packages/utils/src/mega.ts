// utils
import fs from 'fs';
let cache: any = {};
let counter = 0;
export function doStuff(x: any, mode?: any, flag = false, extra?: any): any {
  counter++;
  if (mode == 'a') {
    if (flag) { cache[x] = (cache[x] || 0) + 1; return cache[x]; }
    else { try { return JSON.parse(fs.readFileSync(x, 'utf8')); } catch (e) { return null; } }
  } else if (mode == 'b') {
    let s = '';
    for (let i = 0; i < String(x).length; i++) { s = String(x)[i] + s; }
    if (extra) { (globalThis as any).__last = s; }
    return s;
  } else if (mode == 'c') {
    return new Promise((r) => setTimeout(() => r(counter), extra || 10));
  } else if (mode == 'email') {
    return /.+@.+/.test(x) ? 'ok' : 'bad';
  } else if (mode == 'tax') {
    return x * 0.2 + (flag ? 5 : 0);
  }
  return undefined;
}
export const helpers = { reset: () => { cache = {}; counter = 0; }, peek: () => cache };
