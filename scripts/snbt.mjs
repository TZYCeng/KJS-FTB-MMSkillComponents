/**
 * SNBT (stringified NBT) parser + serializer.
 *
 * Targets the dialect written by FTB Library's SNBT writer, which is what
 * FTB Quests uses for data.snbt / chapters/*.snbt / reward_tables/*.snbt /
 * chapter_groups.snbt / lang/*.snbt from Minecraft 1.16 onward.
 *
 * Supported:
 *   compounds            { key: value, ... }   (commas optional)
 *   lists                [ a, b, c ] / [ a b c ]
 *   typed arrays         [B; 1b, 2b] [I; ...] [L; ...]
 *   quoted strings       "..." / '...' with \" \\ \n \t \uXXXX escapes
 *   unquoted strings     [A-Za-z0-9_.+-]+ (MC's allowed set)
 *   numbers              1, -2, 3.5d, 1.0f, 7b, 9s, 5L, 1e4
 *   booleans             true / false
 *
 * Node kinds are plain JS values:
 *   compound -> Object (insertion ordered)
 *   list     -> Array
 *   byte     -> { __snbt: 'b', value: number }
 *   short    -> { __snbt: 's', value: number }
 *   float    -> { __snbt: 'f', value: number }
 *   long     -> { __snbt: 'L', value: number }\n *   double   -> { __snbt: 'd', value: number }   (only when a double tag is required)
 *   int      -> number
 *   double   -> number
 * Typed arrays are returned as { __snbt: 'array', type: 'B'|'I'|'L', values: [] }.
 */

class SnbtError extends Error {
  constructor(message, source, index) {
    const { line, col } = lineCol(source, index);
    super(`${message} at line ${line}, column ${col}`);
    this.name = 'SnbtError';
    this.line = line;
    this.column = col;
    this.index = index;
  }
}

function lineCol(src, index) {
  let line = 1;
  let col = 1;
  const end = Math.min(index, src.length);
  for (let i = 0; i < end; i++) {
    if (src[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

const NUMBER_RE =
  /^[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([bBsSlLfFdD])?$/;

class Parser {
  constructor(src) {
    this.src = src;
    this.i = 0;
  }

  error(msg, at = this.i) {
    throw new SnbtError(msg, this.src, at);
  }

  peek() {
    return this.src[this.i];
  }

  eof() {
    return this.i >= this.src.length;
  }

  skipWs() {
    const s = this.src;
    for (;;) {
      const c = s[this.i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.i++;
        continue;
      }
      // Tolerate // line comments (some hand-edited packs contain them).
      if (c === '/' && s[this.i + 1] === '/') {
        while (this.i < s.length && s[this.i] !== '\n') this.i++;
        continue;
      }
      return;
    }
  }

  parseDocument() {
    this.skipWs();
    const value = this.parseValue();
    this.skipWs();
    if (!this.eof()) this.error('trailing content after root value');
    return value;
  }

  parseValue() {
    this.skipWs();
    if (this.eof()) this.error('unexpected end of input');
    const c = this.peek();
    if (c === '{') return this.parseCompound();
    if (c === '[') return this.parseList();
    if (c === '"' || c === "'") return this.parseQuoted();
    return this.parseUnquotedOrNumber();
  }

  parseCompound() {
    const start = this.i;
    this.i++; // {
    const out = {};
    for (;;) {
      this.skipWs();
      if (this.eof()) this.error('unterminated compound', start);
      if (this.peek() === '}') {
        this.i++;
        return out;
      }
      const key = this.parseKey();
      this.skipWs();
      if (this.peek() !== ':') this.error(`expected ':' after key "${key}"`);
      this.i++;
      const value = this.parseValue();
      out[key] = value;
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      if (this.peek() === '}') {
        this.i++;
        return out;
      }
      if (this.eof()) this.error('unterminated compound', start);
      // MC allows whitespace-separated entries inside compounds written by
      // FTB's writer; anything else is a syntax error.
      if (this.peek() !== '"' && this.peek() !== "'" && !/[A-Za-z0-9_.+-]/.test(this.peek())) {
        this.error(`unexpected character '${this.peek()}' in compound`);
      }
    }
  }

  parseKey() {
    const c = this.peek();
    if (c === '"' || c === "'") return this.parseQuoted();
    return this.parseBare();
  }

  parseList() {
    const start = this.i;
    this.i++; // [
    this.skipWs();
    // typed array: [B; ...]
    const t = this.peek();
    if ((t === 'B' || t === 'I' || t === 'L') && this.src[this.i + 1] === ';') {
      this.i += 2;
      const values = [];
      for (;;) {
        this.skipWs();
        if (this.eof()) this.error('unterminated typed array', start);
        if (this.peek() === ']') {
          this.i++;
          return { __snbt: 'array', type: t, values };
        }
        const v = this.parseValue();
        values.push(normalizeNumeric(v));
        this.skipWs();
        if (this.peek() === ',') this.i++;
      }
    }
    const items = [];
    for (;;) {
      this.skipWs();
      if (this.eof()) this.error('unterminated list', start);
      if (this.peek() === ']') {
        this.i++;
        return items;
      }
      items.push(this.parseValue());
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      if (this.peek() === ']') {
        this.i++;
        return items;
      }
      if (this.eof()) this.error('unterminated list', start);
      if (this.peek() !== '"' && this.peek() !== "'" && this.peek() !== '{' && this.peek() !== '[') {
        this.error(`unexpected character '${this.peek()}' in list`);
      }
    }
  }

  parseQuoted() {
    const quote = this.peek();
    const start = this.i;
    this.i++;
    let out = '';
    for (;;) {
      if (this.eof()) this.error('unterminated string', start);
      const c = this.src[this.i];
      if (c === quote) {
        this.i++;
        return out;
      }
      if (c === '\\') {
        const n = this.src[this.i + 1];
        switch (n) {
          case 'n':
            out += '\n';
            this.i += 2;
            break;
          case 't':
            out += '\t';
            this.i += 2;
            break;
          case 'r':
            out += '\r';
            this.i += 2;
            break;
          case '"':
          case "'":
          case '\\':
          case '/':
            out += n;
            this.i += 2;
            break;
          case 'u': {
            const hex = this.src.slice(this.i + 2, this.i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.error('bad \\u escape');
            out += String.fromCharCode(parseInt(hex, 16));
            this.i += 6;
            break;
          }
          default:
            this.error(`bad escape \\${n}`);
        }
        continue;
      }
      out += c;
      this.i++;
    }
  }

  parseBare() {
    const start = this.i;
    while (!this.eof() && /[A-Za-z0-9_.+-]/.test(this.peek())) this.i++;
    if (this.i === start) this.error(`unexpected character '${this.peek()}'`);
    return this.src.slice(start, this.i);
  }

  parseUnquotedOrNumber() {
    const start = this.i;
    const token = this.parseBare();
    if (token === 'true') return true;
    if (token === 'false') return false;
    const m = NUMBER_RE.exec(token);
    if (!m) {
      // Unquoted string; valid in MC only if it does not look like a number.
      return token;
    }
    const suffix = m[1];
    const body = token.slice(0, token.length - (suffix ? 1 : 0));
    const n = Number(body.startsWith('0x') || body.startsWith('0X') ? parseInt(body, 16) : body);
    if (Number.isNaN(n)) this.error(`bad number "${token}"`, start);
    if (!suffix) return n;
    const kind = suffix.toLowerCase();
    if (kind === 'b') return { __snbt: 'b', value: n };
    if (kind === 's') return { __snbt: 's', value: n };
    if (kind === 'f') return { __snbt: 'f', value: n };
    if (kind === 'l') return { __snbt: 'L', value: n };
    return n; // d -> plain number
  }
}

function normalizeNumeric(v) {
  if (v && typeof v === 'object' && v.__snbt && v.__snbt !== 'array') return v.value;
  return v;
}

export function parseSnbt(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  return new Parser(src).parseDocument();
}

/* ------------------------------------------------------------------ */
/* serializer                                                          */
/* ------------------------------------------------------------------ */

const SAFE_BARE = /^[A-Za-z0-9_.+-]+$/;
const LOOKS_NUMERIC = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[bBsSlLfFdD]?$/;

function quoteString(s) {
  return (
    '"' +
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r') +
    '"'
  );
}

function keyToString(k) {
  if (SAFE_BARE.test(k) && !LOOKS_NUMERIC.test(k)) return k;
  return quoteString(k);
}

function numberToString(n) {
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 31) return String(n);
  if (!Number.isFinite(n)) return '0.0d';
  const s = String(n);
  // Keep doubles explicit so FTB's reader sees a double tag, like its writer.
  return s.includes('.') || s.includes('e') || s.includes('E') ? `${s}d` : `${s}.0d`;
}

function scalarToString(v) {
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return numberToString(v);
  if (typeof v === 'string') return quoteString(v);
  if (v === null || v === undefined) return quoteString('');
  if (typeof v === 'object' && v.__snbt) {
    switch (v.__snbt) {
      case 'b':
        return `${Math.trunc(v.value)}b`;
      case 's':
        return `${Math.trunc(v.value)}s`;
      case 'f':
        return `${v.value}f`;
      case 'L':
        return `${Math.trunc(v.value)}L`;
      case 'd': {
        const s = String(v.value);
        return s.includes('.') || s.includes('e') || s.includes('E') ? `${s}d` : `${s}.0d`;
      }
      default:
        break;
    }
  }
  return quoteString(String(v));
}

function isCompound(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !('__snbt' in v);
}

/**
 * Pretty-print using FTB Library's layout: tab indentation, one entry per
 * line, short lists inline when they contain only scalars.
 */
/**
 * FTB Quests writes coordinates, sizes and scales as doubles. The parser keeps
 * numbers as plain JS numbers, so these keys are re-emitted as `N.0d` on the way
 * out to keep round-trips byte-stable instead of silently turning them into ints.
 */
export const FTB_DOUBLE_KEYS = new Set([
  'x',
  'y',
  'z',
  'height',
  'width',
  'alpha',
  'rotation',
  'size',
  'scale',
  'icon_scale',
  'grid_scale',
  'default_quest_size',
]);

export function formatSnbt(
  value,
  { indent = '\t', doubleKeys = FTB_DOUBLE_KEYS, compactCompoundLists = false } = {},
) {
  return render(value, 0, indent, true, doubleKeys, undefined, compactCompoundLists) + '\n';
}

function render(value, depth, indent, pretty, doubleKeys, key, compactCompoundLists) {
  const pad = pretty ? indent.repeat(depth) : '';
  const padIn = pretty ? indent.repeat(depth + 1) : '';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[ ]';
    const simple = value.every((v) => !isCompound(v) && !Array.isArray(v));
    if (simple && !pretty) return `[${value.map(scalarToString).join(',')}]`;
    if (simple && pretty) return `[${value.map(scalarToString).join(', ')}]`;
    const compounds = value.every((v) => isCompound(v));
    if (compounds && pretty && compactCompoundLists) {
      // Pack generators often write `rewards: [{ ... }]` on one bracket line.
      // FTB itself (vanilla SnbtPrinterTagVisitor layout) puts the bracket alone,
      // which is the default so that generated files match what the game writes.
      const body = value
        .map((v) => render(v, depth + 1, indent, pretty, doubleKeys, undefined, compactCompoundLists))
        .join(`\n${padIn}`);
      return `[${body}\n${pad}]`;
    }
    const inner = value
      .map((v) => padIn + render(v, depth + 1, indent, pretty, doubleKeys, undefined, compactCompoundLists))
      .join('\n');
    return `[\n${inner}\n${pad}]`;
  }

  if (value && typeof value === 'object' && value.__snbt === 'array') {
    const items = value.values.map((v) => scalarToString(v)).join(', ');
    if (!pretty) return `[${value.type};${items}]`;
    return `[${value.type}; ${items}]`;
  }

  if (isCompound(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{ }';
    const sep = pretty ? '\n' : ',';
    const inner = keys
      .map(
        (k) =>
          `${padIn}${keyToString(k)}: ${render(value[k], depth + 1, indent, pretty, doubleKeys, k, compactCompoundLists)}`,
      )
      .join(sep);
    return pretty ? `{\n${inner}\n${pad}}` : `{${inner}}`;
  }

  if (doubleKeys && typeof value === 'number' && Number.isInteger(value) && doubleKeys.has(key)) {
    return `${value}.0d`;
  }

  return scalarToString(value);
}

/** Compact single-line form (useful in diagnostics/tests). */
export function stringifySnbt(value) {
  return render(value, 0, '\t', false);
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function snbtKind(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'boolean') return 'byte';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'string') return 'string';
  if (v.__snbt === 'array') return `${v.type}[]`;
  if (v.__snbt) return v.__snbt;
  return 'compound';
}

export function asNumber(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v) return Number(v.value);
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return NaN;
}

export function asString(v) {
  if (typeof v === 'string') return v;
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'value' in v) return String(v.value);
  return undefined;
}

export { SnbtError };
