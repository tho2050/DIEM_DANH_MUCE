const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
    let table = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c;
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(size) {
    // Generate RGBA pixels
    const width = size;
    const height = size;
    const rawData = Buffer.alloc((width * 4 + 1) * height);

    const cx = width / 2;
    const cy = height / 2;
    const rOuter = width * 0.45;
    const rPin = width * 0.28;

    for (let y = 0; y < height; y++) {
        const rowStart = y * (width * 4 + 1);
        rawData[rowStart] = 0; // Filter type 0 (None)

        for (let x = 0; x < width; x++) {
            const pxOffset = rowStart + 1 + x * 4;
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Background: Deep dark violet rounded squircle
            // Corner radius check
            const cornerRadius = size * 0.22;
            const qx = Math.max(0, Math.abs(x - cx) - (cx - cornerRadius));
            const qy = Math.max(0, Math.abs(y - cy) - (cy - cornerRadius));
            const cornerDist = Math.sqrt(qx * qx + qy * qy);

            let r = 15, g = 15, b = 26, a = 255;

            if (cornerDist <= cornerRadius) {
                // Inside squircle: Linear gradient from #1e1b4b (top-left) to #0f172a (bottom-right)
                const gradRatio = (x + y) / (width * 2);
                r = Math.round(20 + 35 * (1 - gradRatio));
                g = Math.round(15 + 20 * (1 - gradRatio));
                b = Math.round(40 + 70 * (1 - gradRatio));

                // Outer decorative glow circle
                const glowDist = Math.abs(dist - size * 0.36);
                if (glowDist < size * 0.04) {
                    const glowAlpha = (1 - glowDist / (size * 0.04)) * 0.35;
                    r = Math.round(r * (1 - glowAlpha) + 129 * glowAlpha);
                    g = Math.round(g * (1 - glowAlpha) + 140 * glowAlpha);
                    b = Math.round(b * (1 - glowAlpha) + 248 * glowAlpha);
                }

                // Draw Pin marker:
                // Head center is at cx, cy - size * 0.08, radius size * 0.18
                const pinHeadY = cy - size * 0.08;
                const pinHeadDist = Math.sqrt((x - cx) * (x - cx) + (y - pinHeadY) * (y - pinHeadY));

                // Pin Point bottom is at cx, cy + size * 0.25
                let inPin = false;
                if (pinHeadDist <= size * 0.20) {
                    inPin = true;
                } else if (y >= pinHeadY && y <= cy + size * 0.28) {
                    // Triangle cone to bottom
                    const progress = (y - pinHeadY) / (cy + size * 0.28 - pinHeadY);
                    const coneHalfWidth = (size * 0.185) * (1 - progress * 0.95);
                    if (Math.abs(x - cx) <= coneHalfWidth) {
                        inPin = true;
                    }
                }

                if (inPin) {
                    // Inner hole in pin head
                    if (pinHeadDist <= size * 0.075) {
                        // Hole in pin (shows dark background)
                        r = 20; g = 18; b = 45;
                    } else {
                        // Pin color: Vibrant purple gradient #818cf8 to #c084fc
                        const pinGrad = (y - (cy - size * 0.28)) / (size * 0.56);
                        r = Math.round(129 + 63 * pinGrad);
                        g = Math.round(140 - 8 * pinGrad);
                        b = Math.round(248 + 4 * pinGrad);
                    }
                }
            } else {
                a = 0; // Transparent outside squircle
                r = 0; g = 0; b = 0;
            }

            rawData[pxOffset] = r;
            rawData[pxOffset + 1] = g;
            rawData[pxOffset + 2] = b;
            rawData[pxOffset + 3] = a;
        }
    }

    const compressed = zlib.deflateSync(rawData);

    // PNG signature
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // Bit depth
    ihdr[9] = 6; // Color type (RGBA)
    ihdr[10] = 0; // Compression method
    ihdr[11] = 0; // Filter method
    ihdr[12] = 0; // Interlace method

    const ihdrChunk = makeChunk('IHDR', ihdr);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

fs.writeFileSync('icon-192.png', createPng(192));
fs.writeFileSync('icon-512.png', createPng(512));
console.log('Generated icon-192.png and icon-512.png successfully!');
