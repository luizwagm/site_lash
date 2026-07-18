/* Auditoria SEO — varre os HTML indexáveis e valida os fundamentos. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["src", "assets", ".claude", "node_modules"]);
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".html") ? [p] : [];
  });
}
const files = walk(ROOT);
const titles = new Set(), descs = new Set(), rows = [];
let jsonldOk = true;
for (const f of files) {
  const h = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  const t = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const d = (h.match(/name="description" content="([^"]*)"/) || [])[1] || "";
  const noindex = /noindex/.test(h);
  const canon = /rel="canonical"/.test(h);
  const h1 = (h.match(/<h1[\s>]/g) || []).length;
  const ldBlocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of ldBlocks) { try { JSON.parse(m[1]); } catch { jsonldOk = false; console.log("JSON-LD INVÁLIDO em", rel); } }
  const imgs = (h.match(/<img/g) || []).length;
  const alts = (h.match(/<img[^>]*\salt="/g) || []).length;
  const og = /property="og:title"|property="og:url"/.test(h) || noindex;
  if (!noindex) { titles.add(t); descs.add(d); rows.push({ rel, h1, canon, ld: ldBlocks.length, imgs, alts, tlen: t.length, og }); }
}
const idx = rows.length;
console.log("HTML total:", files.length, "| Indexáveis:", idx);
console.log("Títulos únicos:", titles.size + "/" + idx, "| Descrições únicas:", descs.size + "/" + idx);
console.log("Exatamente 1 <h1>:", rows.every((r) => r.h1 === 1));
console.log("Canonical em todas:", rows.every((r) => r.canon));
console.log("JSON-LD presente:", rows.every((r) => r.ld >= 1), "| JSON-LD válido:", jsonldOk);
console.log("Open Graph em todas:", rows.every((r) => r.og));
console.log("alt em 100% das <img>:", rows.every((r) => r.imgs === r.alts));
console.log("Títulos 25-65 chars:", rows.filter((r) => r.tlen >= 25 && r.tlen <= 65).length + "/" + idx);
rows.filter((r) => r.h1 !== 1 || !r.canon || r.ld < 1).forEach((r) => console.log("  ! revisar:", r.rel, JSON.stringify(r)));
