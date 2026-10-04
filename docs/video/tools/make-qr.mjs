// Writes the QR code shown on the laptop in composition 5. It encodes the
// repository's URL — a real, scannable code pointing somewhere true, not a
// made-up invite.
import QRCode from 'qrcode';
import { writeFileSync } from 'node:fs';

const url = 'https://github.com/lewisjohnvillamor/homesync';
const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
const n = qr.modules.size;
const cells = [];
for (let y = 0; y < n; y += 1) {
  for (let x = 0; x < n; x += 1) {
    if (qr.modules.get(x, y)) cells.push(`M${x} ${y}h1v1h-1z`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#e9eef5"/><path d="${cells.join('')}" fill="#0b0e13"/></svg>`;
writeFileSync(new URL('../src/assets/qr-repo.svg', import.meta.url), svg);
console.log(`${n}x${n} modules -> src/assets/qr-repo.svg`);
