// Owner: WP-INT (W3; see PLAN.md §7.1 step 5 and DECISIONS "Fonts: Archivo + Archivo Narrow only"). Font audit of the
// shipped source (src/ without src/data/, plus index.html): no Alegreya, Georgia, Times, Consolas, monospace or serif
// faces and no italics in CSS or JSX; @font-face rules load Archivo and Archivo Narrow only; every font stack is made
// of those two families and their sans-serif fallbacks. Static: reads files, executes no app code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
// src/data/ holds team, player and place names ("Georgia"), not styling.
const SHIPPED = walk(path.join(ROOT, 'src')).filter(file => !rel(file).startsWith('src/data/') && /\.(css|m?js|jsx)$/.test(file));
const CSS = SHIPPED.filter(file => file.endsWith('.css'));
const SCRIPTS = SHIPPED.filter(file => !file.endsWith('.css'));
const FONTS_CSS = path.join(ROOT, 'src', 'fonts.css');
const read = file => readFileSync(file, 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
/** CSS without comments; comment characters become spaces so indices and line numbers stay put. */
const stripCss = text => text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));

/** The two families (DECISIONS) and the system fallbacks the token stacks name after them. */
const ALLOWED_FAMILIES = new Set(['Archivo', 'Archivo Narrow', 'Segoe UI', 'Arial Narrow']);
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const FONT_VARS = new Set(['--font-sans', '--font-narrow']);
const OTHER_GENERIC = /(?<![-\w])(serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)(?![-\w])/i;
const ANY_GENERIC = /(?<![-\w])(sans-serif|serif|monospace|cursive|fantasy|system-ui)(?![-\w])/i;

/** Split a CSS value at top-level commas (commas inside var()/calc() stay put). */
function splitTopLevel(value) {
  const items = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { items.push(value.slice(start, i)); start = i + 1; }
  }
  items.push(value.slice(start));
  return items.map(item => item.trim()).filter(Boolean);
}

/** Problems in a family list ("'Archivo Narrow', 'Arial Narrow', sans-serif" or "var(--font-sans)"). */
function stackProblems(value) {
  const problems = [];
  for (const item of splitTopLevel(value.replace(/!important\s*$/i, '').trim())) {
    const quoted = item.match(/^(['"])(.+)\1$/);
    const fontVar = item.match(/^var\(\s*(--[\w-]+)\s*(?:,(.*))?\)$/s);
    if (quoted) { if (!ALLOWED_FAMILIES.has(quoted[2])) problems.push(`family '${quoted[2]}'`); }
    else if (fontVar) {
      if (!FONT_VARS.has(fontVar[1])) problems.push(`${fontVar[1]} is not a font token`);
      if (fontVar[2]) problems.push(...stackProblems(fontVar[2]));
    } else if (!(item === 'sans-serif' || CSS_WIDE.has(item) || ALLOWED_FAMILIES.has(item))) problems.push(`family ${item}`);
  }
  return problems;
}

/** Quoted family names and generic keywords anywhere in a value (for shorthands and custom properties). */
function looseProblems(value) {
  const problems = [];
  for (const [, , name] of value.matchAll(/(['"])([^'"]+)\1/g)) if (!ALLOWED_FAMILIES.has(name)) problems.push(`family '${name}'`);
  const generic = value.match(OTHER_GENERIC);
  if (generic) problems.push(`generic ${generic[1]}`);
  return problems;
}

/** Every `font-family`, `font` and `--…font…` declaration in a CSS file: [{ property, value, line }]. */
function fontDeclarations(file) {
  const text = stripCss(read(file));
  const found = [];
  for (const match of text.matchAll(/(^|[;{\s])(font-family|font|--[\w-]*font[\w-]*)\s*:\s*([^;{}]+)/gi)) {
    found.push({ property: match[2].toLowerCase(), value: match[3].trim(), line: lineOf(text, match.index + match[1].length) });
  }
  return found;
}

const asts = new Map();
function ast(file) {
  if (!asts.has(file)) {
    asts.set(file, parse(read(file), { sourceType: 'module', sourceFilename: rel(file),
      plugins: ['jsx', 'classProperties', 'classPrivateProperties', 'optionalChaining', 'nullishCoalescingOperator'] }));
  }
  return asts.get(file);
}
const keyName = node => node?.type === 'Identifier' ? node.name : node?.type === 'StringLiteral' ? node.value : null;
const stringValue = node => node?.type === 'StringLiteral' ? node.value
  : node?.type === 'JSXExpressionContainer' ? stringValue(node.expression)
    : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;

// ---------- PLAN §7.1 step 5, verbatim ----------

test('PLAN §7.1 font audit: no Georgia, Times, Consolas, monospace, serif, Alegreya or italic in shipped source', () => {
  const AUDIT = /georgia|times new roman|consolas|monospace|font-style:\s*italic|fontStyle:\s*['"]italic|alegreya|(^|[^-])serif/i;
  const files = [...SHIPPED.filter(file => file !== FONTS_CSS), path.join(ROOT, 'index.html')];
  assert.ok(files.length > 60, `audited ${files.length} files`);
  const hits = files.flatMap(file => read(file).split('\n').map((text, i) => [i + 1, text])
    .filter(([, text]) => AUDIT.test(text)).map(([line, text]) => `${rel(file)}:${line}: ${text.trim().slice(0, 120)}`));
  assert.deepEqual(hits, []);
});

test('fonts.css loads Archivo and Archivo Narrow only, upright, from files that exist (Alegreya @font-face gone)', () => {
  const text = read(FONTS_CSS);
  assert.doesNotMatch(text, /alegreya/i, 'no Alegreya @font-face (the font files may stay in public/fonts)');
  const faces = [...stripCss(text).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(faces.length >= 2);
  const families = new Set();
  for (const face of faces) {
    const family = face.match(/font-family\s*:\s*(['"])(.+?)\1/)?.[2];
    families.add(family);
    assert.ok(['Archivo', 'Archivo Narrow'].includes(family), `@font-face family ${family}`);
    assert.match(face, /font-style\s*:\s*normal/, `${family}: upright faces only`);
    for (const [, url] of face.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      assert.match(url, /^\/fonts\/archivo-/, `${family} source ${url}`);
      assert.ok(existsSync(path.join(ROOT, 'public', url)), `public${url} exists`);
    }
  }
  assert.deepEqual([...families].sort(), ['Archivo', 'Archivo Narrow']);
});

// ---------- font stacks ----------

test('tokens define the two font stacks, Archivo first, and the base rules keep controls and textareas on them', () => {
  const tokens = stripCss(read(path.join(ROOT, 'src', 'styles', 'tokens.css')));
  const value = name => tokens.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim();
  assert.equal(value('--font-sans'), "'Archivo', 'Segoe UI', sans-serif");
  assert.equal(value('--font-narrow'), "'Archivo Narrow', 'Arial Narrow', sans-serif");
  assert.match(tokens, /(^|\})\s*body\s*\{[^}]*font\s*:[^;]*var\(--font-sans\)/, 'body text is Archivo');
  assert.match(tokens, /(^|\})\s*body\s*\{[^}]*font-synthesis\s*:\s*none/, 'no synthesised italics or bold');
  // UA stylesheets give textarea a monospace face; the retired Consolas textarea rule must not come back.
  assert.match(tokens, /(^|\})[^{}]*\btextarea\b[^{}]*\{[^}]*font\s*:\s*inherit/, 'form controls incl. textarea inherit the font');
});

test('every CSS font declaration resolves to Archivo / Archivo Narrow (font tokens or the allowed stacks)', () => {
  const problems = [];
  let count = 0;
  for (const file of CSS.filter(item => item !== FONTS_CSS)) {
    for (const { property, value, line } of fontDeclarations(file)) {
      count += 1;
      const where = `${rel(file)}:${line} ${property}: ${value}`;
      const found = property === 'font-family' ? stackProblems(value) : looseProblems(value);
      if (property === 'font' && !CSS_WIDE.has(value.replace(/!important\s*$/i, '').trim())
        && !/var\(--font-(sans|narrow)\b|(['"])(Archivo|Archivo Narrow)\2/.test(value)) found.push('shorthand names no Archivo family');
      if (property === 'font') {
        for (const [, name] of value.matchAll(/var\(\s*(--font[\w-]*)/g)) if (!FONT_VARS.has(name)) found.push(`${name} is not a font token`);
      }
      problems.push(...found.map(problem => `${where} → ${problem}`));
    }
  }
  assert.ok(count > 100, `checked ${count} declarations`);
  assert.deepEqual(problems, []);
});

test('font stacks in JS/JSX (theme FONT, map label fonts, fontFamily props) use the allowed families only', async () => {
  const problems = [];
  let stacks = 0;
  for (const file of SCRIPTS) {
    const check = (value, node, label) => {
      const found = stackProblems(value);
      stacks += 1;
      problems.push(...found.map(problem => `${rel(file)}:${node.loc.start.line} ${label} "${value}" → ${problem}`));
    };
    traverse(ast(file), {
      StringLiteral(literal) {
        if (ANY_GENERIC.test(literal.node.value)) check(literal.node.value, literal.node, 'font stack');
      },
      TemplateElement(element) {
        const cooked = element.node.value.cooked || '';
        if (ANY_GENERIC.test(cooked)) problems.push(`${rel(file)}:${element.node.loc.start.line} template font stack "${cooked}" → use a constant`);
      },
      ObjectProperty(property) {
        const value = stringValue(property.node.value);
        if (keyName(property.node.key) === 'fontFamily' && value != null && !ANY_GENERIC.test(value)) check(value, property.node, 'fontFamily');
      },
      JSXAttribute(attribute) {
        const value = stringValue(attribute.node.value);
        if (attribute.node.name.name === 'fontFamily' && value != null && !ANY_GENERIC.test(value)) check(value, attribute.node, 'fontFamily');
      },
    });
  }
  assert.ok(stacks >= 4, `checked ${stacks} stacks`);
  assert.deepEqual(problems, []);
  const { FONT } = await import(pathToFileURL(path.join(ROOT, 'src', 'theme.js')).href);
  for (const [name, stack] of Object.entries(FONT)) {
    assert.match(stack, /^'Archivo( Narrow)?'/, `FONT.${name} leads with Archivo or Archivo Narrow`);
  }
});

// ---------- italics and UA-styled elements ----------

test('no italic or oblique styling in CSS, inline styles or SVG text', () => {
  const problems = [];
  for (const file of CSS) {
    const text = stripCss(read(file));
    for (const match of text.matchAll(/font-style\s*:\s*(italic|oblique)/gi)) problems.push(`${rel(file)}:${lineOf(text, match.index)} ${match[0]}`);
    for (const { property, value, line } of fontDeclarations(file)) {
      if (property === 'font' && /(?<![-\w])(italic|oblique)(?![-\w])/i.test(value)) problems.push(`${rel(file)}:${line} font: ${value}`);
    }
  }
  for (const file of SCRIPTS) {
    traverse(ast(file), {
      ObjectProperty(property) {
        const value = stringValue(property.node.value);
        if (keyName(property.node.key) === 'fontStyle' && /italic|oblique/i.test(value || '')) problems.push(`${rel(file)}:${property.node.loc.start.line} fontStyle ${value}`);
      },
      JSXAttribute(attribute) {
        const value = stringValue(attribute.node.value);
        if (['fontStyle', 'font-style'].includes(attribute.node.name.name) && /italic|oblique/i.test(value || '')) {
          problems.push(`${rel(file)}:${attribute.node.loc.start.line} ${attribute.node.name.name}=${value}`);
        }
      },
      StringLiteral(literal) {
        if (/font-style\s*:\s*(italic|oblique)/i.test(literal.node.value)) problems.push(`${rel(file)}:${literal.node.loc.start.line} "${literal.node.value}"`);
      },
    });
  }
  assert.deepEqual(problems, []);
});

test('JSX renders no element the browser sets in italics or monospace (em, cite, code, kbd, pre …); <i> marks carry no text', () => {
  // UA defaults: em/cite/var/dfn/address/i are italic, code/kbd/pre/samp/tt are monospace. Key hints are CSS
  // ::after chips (DEC D13), not <kbd>; the <i> elements in the repo are empty decorative marks.
  const BANNED = new Set(['em', 'cite', 'var', 'dfn', 'address', 'code', 'kbd', 'pre', 'samp', 'tt']);
  const problems = [];
  let marks = 0;
  for (const file of SCRIPTS.filter(item => item.endsWith('.jsx'))) {
    traverse(ast(file), {
      JSXElement(element) {
        const name = element.node.openingElement.name;
        if (name.type !== 'JSXIdentifier') return;
        const where = `${rel(file)}:${element.node.loc.start.line} <${name.name}>`;
        if (BANNED.has(name.name)) problems.push(where);
        if (name.name !== 'i') return;
        marks += 1;
        const text = element.node.children.some(child => (child.type === 'JSXText' && child.value.trim())
          || (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression')
          || child.type === 'JSXSpreadChild');
        if (text) problems.push(`${where} has text content`);
      },
    });
  }
  assert.ok(marks > 0, 'the scan sees the decorative <i> marks');
  assert.deepEqual(problems, []);
});
