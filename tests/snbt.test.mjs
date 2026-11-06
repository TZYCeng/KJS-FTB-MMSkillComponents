import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnbt, formatSnbt, stringifySnbt, snbtKind, asNumber } from '../scripts/snbt.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'ftbq-1211');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');

/** Strip SNBT ordering differences so two parses can be compared structurally. */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object' && value.__snbt) {
    return { __snbt: value.__snbt, value: value.value ?? value.values };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

test('parses the compound layout FTB writes', () => {
  const value = parseSnbt(`{
\tdefault_hide_dependency_lines: false
\tfilename: "welcome"
\tid: "5B00676D79306EA2"
\tgrid_scale: 0.5d
\tdetection_delay: 60
\ttags: ["a", "b"]
\tempty: [ ]
}`);
  assert.equal(value.default_hide_dependency_lines, false);
  assert.equal(value.filename, 'welcome');
  assert.equal(value.grid_scale, 0.5);
  assert.equal(value.detection_delay, 60);
  assert.deepEqual(value.tags, ['a', 'b']);
  assert.deepEqual(value.empty, []);
});

test('keeps numeric suffixes and typed arrays', () => {
  const value = parseSnbt('{ b: 1b, s: 2s, f: 1.5f, l: 9000000000L, arr: [I; 1, 2, 3] }');
  assert.equal(snbtKind(value.b), 'b');
  assert.equal(snbtKind(value.s), 's');
  assert.equal(snbtKind(value.f), 'f');
  assert.equal(snbtKind(value.l), 'L');
  assert.equal(asNumber(value.l), 9000000000);
  assert.equal(value.arr.__snbt, 'array');
  assert.equal(value.arr.type, 'I');
  assert.deepEqual(value.arr.values, [1, 2, 3]);
});

test('handles escapes, single quotes, comments and bare words', () => {
  const value = parseSnbt(`{
// the trailing comma is optional in SNBT, comments are not part of the format
\ta: 'single \\'quoted\\''
\tb: "line\\nbreak\\ttab \\u00e9"
\tc: unquoted_value
}`);
  assert.equal(value.a, "single 'quoted'");
  assert.equal(value.b, 'line\nbreak\ttab \u00e9');
  assert.equal(value.c, 'unquoted_value');
});

test('reports syntax errors with a line number', () => {
  assert.throws(
    () => parseSnbt('{\n\ta: 1\n\tb: { c: 1 }\n'),
    (err) => /\bline\b/i.test(err.message),
  );
});

test('round-trips the real FTB Quests 1.21.1 fixtures structurally', () => {
  for (const name of ['1211-data.snbt', '1211-chapter_groups.snbt', '1211-welcome.snbt']) {
    const source = read(name);
    const first = parseSnbt(source);
    const text = formatSnbt(first);
    const second = parseSnbt(text);
    assert.deepEqual(normalize(second), normalize(first), `${name} must survive a round-trip`);
    assert.ok(text.includes('\t'), 'output uses tab indentation');
    assert.ok(!text.includes(','), 'output does not use separator commas');
  }
});

test('re-emits doubles for FTB coordinate keys', () => {
  const text = formatSnbt(parseSnbt(read('1211-welcome.snbt')));
  assert.ok(text.includes('x: 0.0d'), 'x stays a double');
  assert.ok(text.includes('size: 3.0d'), 'size stays a double');
  assert.ok(text.includes('xp: 10') && !text.includes('xp: 10.0d'), 'xp stays an int');
});

test('compactCompoundLists keeps bracket lines dense', () => {
  const value = parseSnbt(read('1211-welcome.snbt'));
  const spaced = formatSnbt(value);
  const compact = formatSnbt(value, { compactCompoundLists: true });
  assert.ok(compact.split('\n').length < spaced.split('\n').length);
  assert.ok(compact.includes('rewards: [{'));
});

test('stringifySnbt produces one line', () => {
  const text = stringifySnbt({ a: 1, b: ['x', 'y'] });
  assert.equal(text.includes('\n'), false);
  assert.equal(text, '{a: 1,b: ["x","y"]}');
});
