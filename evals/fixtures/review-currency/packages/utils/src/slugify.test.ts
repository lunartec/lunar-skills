import { slugify } from './slugify';
test('slug', () => expect(slugify('A B')).toBe('a-b'));
