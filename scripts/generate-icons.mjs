// Genera los iconos PNG de la PWA a partir de un único SVG maestro.
// Uso: node scripts/generate-icons.mjs
// (sharp es solo devDependency; los iconos resultantes van en public/.)
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// SVG maestro (512x512): fondo azul "meteo", anillos de radar tenues y una
// gota de lluvia blanca como elemento principal. Todo el contenido queda dentro
// de la zona segura central para que también valga como icono "maskable"
// (Android recorta en círculo/redondeado sin comerse la gota).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b93f0"/>
      <stop offset="1" stop-color="#12579f"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.30" stroke-width="7">
    <circle cx="256" cy="256" r="74"/>
    <circle cx="256" cy="256" r="128"/>
    <circle cx="256" cy="256" r="182"/>
  </g>
  <path d="M256 150 C300 224 330 262 330 302 a74 74 0 0 1 -148 0 C182 262 212 224 256 150 Z"
        fill="#ffffff"/>
  <path d="M238 300 a18 26 0 0 0 8 44" fill="none" stroke="#bcd8f7" stroke-width="10"
        stroke-linecap="round" opacity="0.9"/>
</svg>`;

const svgBuffer = Buffer.from(svg);

const outputs = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-icon.png", size: 180 },
];

for (const { file, size } of outputs) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(join(publicDir, file));
  console.log(`✓ ${file} (${size}x${size})`);
}

console.log("Iconos generados en public/.");
