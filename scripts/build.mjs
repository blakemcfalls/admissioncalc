// Bundles the app into single self-contained HTML files:
//   dist/top20-admit-odds.html          full document, opens offline
//   dist/top20-admit-odds.fragment.html same page without <html>/<head>/<body>,
//                                       for hosts that supply their own skeleton
//
// The modules are small and follow one import/export style, so a tiny
// scope-per-module bundler is enough; no dependencies needed.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');

const order = ['js/schools.js', 'js/model.js', 'js/essay-check.js', 'js/app.js'];
const varName = (path) => `__${path.replace(/^js\//, '').replace(/\W/g, '_')}`;

function transform(path, src) {
  const exported = [];
  let code = src.replace(
    /^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)';?/gm,
    (_, names, file) => `const {${names}} = ${varName(`js/${file}`)};`,
  );
  code = code.replace(/^export\s+(const|let|function|class)\s+([\w$]+)/gm, (_, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });
  if (/^\s*export\s/m.test(code)) throw new Error(`${path}: unsupported export syntax`);
  return `const ${varName(path)} = (() => {\n${code}\nreturn { ${exported.join(', ')} };\n})();`;
}

const html = await read('index.html');
const css = await read('css/styles.css');
const modules = await Promise.all(order.map(async (p) => transform(p, await read(p))));
const script = modules.join('\n\n').replace(/<\/script/gi, '<\\/script');

const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html: missing ${label}`);
  return m[0];
};
const title = pick(/<title>[\s\S]*?<\/title>/, '<title>');
const meta = pick(/<meta name="description"[^>]*>/, 'description meta');
const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^>]*>/g)].map((m) => m[0]).join('\n');
const app = pick(/<!-- app:start -->[\s\S]*<!-- app:end -->/, 'app markers');

const head = `${title}\n${meta}\n${fonts}\n<style>\n${css}\n</style>`;
const body = `${app}\n<script type="module">\n${script}\n</script>`;

const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const fragment = `${head}\n${body}\n`;

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/top20-admit-odds.html'), full);
await writeFile(join(root, 'dist/top20-admit-odds.fragment.html'), fragment);
console.log(`Built dist/top20-admit-odds.html (${(full.length / 1024).toFixed(0)} KB) and the fragment version.`);
