// ── Canvas → SVG Trace ────────────────────────
export async function traceToSVG(imageB64, contrastLevel) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const size = 800;
                const canvas = document.getElementById('processingCanvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');

                // White background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, size, size);

                // Draw with circular clip
                ctx.save();
                ctx.beginPath();
                ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, 0, 0, size, size);
                ctx.restore();

                // Apply contrast enhancement
                if (contrastLevel !== 'normal') {
                    applyContrastFilter(ctx, size, contrastLevel);
                }

                // Get image data for tracing
                const imageData = ctx.getImageData(0, 0, size, size);

                // Use ImageTracer if available
                if (typeof ImageTracer !== 'undefined') {
                    const svgStr = ImageTracer.imagedataToSVG(imageData, getTracerOptions(contrastLevel));
                    resolve(svgStr);
                } else {
                    // Fallback: embed as image in SVG
                    resolve(buildFallbackSVG(canvas.toDataURL(), size));
                }
            } catch (e) {
                reject(new Error('SVG 转换失败: ' + e.message));
            }
        };
        img.onerror = () => reject(new Error('图像加载失败'));
        img.src = `data:image/png;base64,${imageB64}`;
    });
}

function applyContrastFilter(ctx, size, level) {
    const imgData = ctx.getImageData(0, 0, size, size);
    const d = imgData.data;
    const threshold = level === 'ultra' ? 160 : 128;

    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const val = lum < threshold ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = val;
    }
    ctx.putImageData(imgData, 0, 0);
}

function getTracerOptions(contrast) {
    return {
        ltres: contrast === 'ultra' ? 3 : 1,
        qtres: 1,
        pathomit: contrast === 'ultra' ? 16 : 8,
        rightangleenhance: true,
        colorsampling: 0,          // 0 = use explicit palette (most reliable for B&W)
        numberofcolors: 2,
        pal: [                     // Explicit B&W palette
            { r: 0, g: 0, b: 0, a: 255 },  // black
            { r: 255, g: 255, b: 255, a: 255 }   // white
        ],
        mincolorratio: 0.01,
        colorquantcycles: 1,
        strokewidth: 0,
        scale: 1,
        roundcoords: 1,
        viewbox: true,
        blurradius: 0,
        blurdelta: 20
    };
}

function buildFallbackSVG(dataURL, size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <clipPath id="circleClip">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}"/>
    </clipPath>
  </defs>
  <rect width="${size}" height="${size}" fill="white"/>
  <image href="${dataURL}" width="${size}" height="${size}" clip-path="url(#circleClip)"/>
</svg>`;
}

// ── Finalize SVG for Laser Engraving ──────────
export function finalizeSVGForLaser(svgStr, options) {
    const { sizeNum, borderStyle, clipShape, petName, tagline } = options;

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
    const svg = svgDoc.querySelector('svg');

    const vb = svg.getAttribute('viewBox') || '0 0 800 800';
    const parts = vb.split(' ').map(Number);
    const w = parts[2] || 800, h = parts[3] || 800;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;

    // ── Fix fill colors (luminance-based) ────────────────────
    function parseColorLuminance(colorStr) {
        if (!colorStr) return -1;
        const s = colorStr.replace(/\\s/g, '').toLowerCase();
        if (s === 'white') return 255;
        if (s === 'black') return 0;
        if (s === 'none') return -1;
        const hex3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
        if (hex3) { const rv = parseInt(hex3[1] + hex3[1], 16), gv = parseInt(hex3[2] + hex3[2], 16), bv = parseInt(hex3[3] + hex3[3], 16); return 0.299 * rv + 0.587 * gv + 0.114 * bv; }
        const hex6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
        if (hex6) { const rv = parseInt(hex6[1], 16), gv = parseInt(hex6[2], 16), bv = parseInt(hex6[3], 16); return 0.299 * rv + 0.587 * gv + 0.114 * bv; }
        const rgb = s.match(/^rgba?\\((\\d+),(\\d+),(\\d+)/);
        if (rgb) return 0.299 * parseInt(rgb[1]) + 0.587 * parseInt(rgb[2]) + 0.114 * parseInt(rgb[3]);
        return -1;
    }
    svg.querySelectorAll('[fill]').forEach(el => {
        const fill = el.getAttribute('fill');
        if (!fill || fill === 'none') return;
        const lum = parseColorLuminance(fill);
        if (lum < 0) return;
        el.setAttribute('fill', lum > 180 ? 'none' : '#000000');
    });

    // ── Shape geometry builder ────────────────────────────────
    let defs = svg.querySelector('defs');
    if (!defs) { defs = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.insertBefore(defs, svg.firstChild); }

    const clipId = 'laserShapeClip';
    const rInner = r - 8;

    function buildShapeGeometry(shape) {
        switch (shape) {
            case 'square': {
                const s = rInner * 0.92;
                return {
                    clip: \`<rect x="\${cx - s}" y="\${cy - s}" width="\${s * 2}" height="\${s * 2}" rx="12"/>\`,
                    borders: {
                        single: \`<rect x="\${cx - s - 2}" y="\${cy - s - 2}" width="\${(s + 2) * 2}" height="\${(s + 2) * 2}" rx="14" stroke-width="4" fill="none" stroke="#000"/>\`,
                        double: \`<rect x="\${cx - s - 2}" y="\${cy - s - 2}" width="\${(s + 2) * 2}" height="\${(s + 2) * 2}" rx="14" stroke-width="5" fill="none" stroke="#000"/><rect x="\${cx - s + 10}" y="\${cy - s + 10}" width="\${(s - 10) * 2}" height="\${(s - 10) * 2}" rx="8" stroke-width="2" fill="none" stroke="#000"/>\`,
                        dotted: \`<rect x="\${cx - s - 2}" y="\${cy - s - 2}" width="\${(s + 2) * 2}" height="\${(s + 2) * 2}" rx="14" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>\`,
                    }
                };
            }
            case 'hexagon': {
                const hr = rInner;
                const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return \`\${cx + hr * Math.cos(a)},\${cy + hr * Math.sin(a)}\`; }).join(' ');
                const bpts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return \`\${cx + (hr + 4) * Math.cos(a)},\${cy + (hr + 4) * Math.sin(a)}\`; }).join(' ');
                const bpts2 = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return \`\${cx + (hr - 14) * Math.cos(a)},\${cy + (hr - 14) * Math.sin(a)}\`; }).join(' ');
                return {
                    clip: \`<polygon points="\${pts}"/>\`,
                    borders: {
                        single: \`<polygon points="\${bpts}" stroke-width="4" fill="none" stroke="#000"/>\`,
                        double: \`<polygon points="\${bpts}" stroke-width="5" fill="none" stroke="#000"/><polygon points="\${bpts2}" stroke-width="2" fill="none" stroke="#000"/>\`,
                        dotted: \`<polygon points="\${bpts}" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>\`,
                    }
                };
            }
            case 'diamond': {
                const dr = rInner;
                const pts = \`\${cx},\${cy - dr} \${cx + dr * 0.75},\${cy} \${cx},\${cy + dr} \${cx - dr * 0.75},\${cy}\`;
                const bpts = \`\${cx},\${cy - dr - 4} \${cx + dr * 0.75 + 4},\${cy} \${cx},\${cy + dr + 4} \${cx - dr * 0.75 - 4},\${cy}\`;
                return {
                    clip: \`<polygon points="\${pts}"/>\`,
                    borders: {
                        single: \`<polygon points="\${bpts}" stroke-width="4" fill="none" stroke="#000"/>\`,
                        double: \`<polygon points="\${bpts}" stroke-width="5" fill="none" stroke="#000"/><polygon points="\${cx},\${cy - dr + 12} \${cx + dr * 0.75 - 10},\${cy} \${cx},\${cy + dr - 12} \${cx - dr * 0.75 + 10},\${cy}" stroke-width="2" fill="none" stroke="#000"/>\`,
                        dotted: \`<polygon points="\${bpts}" stroke-width="4" stroke-dasharray="10,7" fill="none" stroke="#000"/>\`,
                    }
                };
            }
            case 'paw': {
                const padRx = rInner * 0.52, padRy = rInner * 0.48, padCy = cy + rInner * 0.1, tr = rInner * 0.22;
                const toes = [{ tx: cx - rInner * 0.42, ty: cy - rInner * 0.42 }, { tx: cx - rInner * 0.14, ty: cy - rInner * 0.58 }, { tx: cx + rInner * 0.14, ty: cy - rInner * 0.58 }, { tx: cx + rInner * 0.42, ty: cy - rInner * 0.42 }];
                const toeClips = toes.map(t => \`<ellipse cx="\${t.tx}" cy="\${t.ty}" rx="\${tr}" ry="\${tr * 0.88}"/>\`).join('');
                const toeBords = toes.map(t => \`<ellipse cx="\${t.tx}" cy="\${t.ty}" rx="\${tr + 3}" ry="\${(tr + 3) * 0.88}" stroke-width="4" fill="none" stroke="#000"/>\`).join('');
                return {
                    clip: \`<ellipse cx="\${cx}" cy="\${padCy}" rx="\${padRx}" ry="\${padRy}"/>\${toeClips}\`,
                    borders: {
                        single: \`<ellipse cx="\${cx}" cy="\${padCy}" rx="\${padRx + 4}" ry="\${padRy + 4}" stroke-width="4" fill="none" stroke="#000"/>\${toeBords}\`,
                        double: \`<ellipse cx="\${cx}" cy="\${padCy}" rx="\${padRx + 4}" ry="\${padRy + 4}" stroke-width="5" fill="none" stroke="#000"/><ellipse cx="\${cx}" cy="\${padCy}" rx="\${padRx - 10}" ry="\${padRy - 10}" stroke-width="2" fill="none" stroke="#000"/>\${toeBords}\`,
                        dotted: \`<ellipse cx="\${cx}" cy="\${padCy}" rx="\${padRx + 4}" ry="\${padRy + 4}" stroke-width="4" stroke-dasharray="10,7" fill="none" stroke="#000"/>\`,
                    }
                };
            }
            case 'none':
                return { clip: null, borders: { single: '', double: '', dotted: '' } };
            case 'circle':
            default:
                return {
                    clip: \`<circle cx="\${cx}" cy="\${cy}" r="\${rInner}"/>\`,
                    borders: {
                        single: \`<circle cx="\${cx}" cy="\${cy}" r="\${r - 6}" stroke-width="4" fill="none" stroke="#000"/>\`,
                        double: \`<circle cx="\${cx}" cy="\${cy}" r="\${r - 4}" stroke-width="5" fill="none" stroke="#000"/><circle cx="\${cx}" cy="\${cy}" r="\${r - 18}" stroke-width="2" fill="none" stroke="#000"/>\`,
                        dotted: \`<circle cx="\${cx}" cy="\${cy}" r="\${r - 6}" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>\`,
                    }
                };
        }
    }

    const { clip, borders } = buildShapeGeometry(clipShape);

    // Apply clip
    if (clip) {
        defs.innerHTML += \`<clipPath id="\${clipId}">\${clip}</clipPath>\`;
        const allContent = Array.from(svg.children).filter(el => el.tagName !== 'defs');
        const g = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('clip-path', \`url(#\${clipId})\`);
        allContent.forEach(el => g.appendChild(el));
        svg.appendChild(g);
    }

    // Apply border
    if (borderStyle !== 'none') {
        const borderGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
        borderGroup.setAttribute('id', 'laser-border');
        borderGroup.innerHTML = borders[borderStyle] || borders.single || '';
        svg.appendChild(borderGroup);
    }


    // ── Custom Text Banner (bottom of circle) ──────────
    if (petName || tagline) {
        // Banner dimensions — bottom quarter of circle
        const bannerH = r * 0.40;
        const bannerY = cy + r - bannerH;

        // White banner rectangle (clipped to circle via the same clip if needed, but here we just draw it)
        const bannerClipId = 'bannerClip';
        defs.innerHTML += \`<clipPath id="\${bannerClipId}"><circle cx="\${cx}" cy="\${cy}" r="\${r}"/></clipPath>\`;

        const textGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
        textGroup.setAttribute('id', 'text-banner');

        // Only clip to circle if it's a circular shape to maintain the border, otherwise just draw over
        if (clipShape === 'circle') {
            textGroup.setAttribute('clip-path', \`url(#\${bannerClipId})\`);
        }

        // White background band - made wider and taller to fully cover the bottom section
        textGroup.innerHTML = \`
  <rect x="0" y="\${bannerY}" width="\${w}" height="\${h - bannerY}" fill="white"/>
  <line x1="0" y1="\${bannerY}" x2="\${w}" y2="\${bannerY}" stroke="#000" stroke-width="4"/>\`;

        // Pet name text
        if (petName) {
            const nameEl = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text');
            nameEl.setAttribute('x', \`\${cx}\`);
            nameEl.setAttribute('y', \`\${bannerY + (h - bannerY) * (tagline ? 0.45 : 0.55)}\`);
            nameEl.setAttribute('text-anchor', 'middle');
            nameEl.setAttribute('dominant-baseline', 'middle');
            nameEl.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
            nameEl.setAttribute('font-weight', 'bold');
            nameEl.setAttribute('font-size', \`\${Math.min(bannerH * 0.45, r * 0.20)}\`);
            nameEl.setAttribute('fill', '#000000');
            nameEl.setAttribute('letter-spacing', '2');
            nameEl.textContent = petName;
            textGroup.appendChild(nameEl);
        }

        // Tagline text
        if (tagline) {
            const tagEl = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text');
            tagEl.setAttribute('x', \`\${cx}\`);
            tagEl.setAttribute('y', \`\${bannerY + (h - bannerY) * (petName ? 0.75 : 0.55)}\`);
            tagEl.setAttribute('text-anchor', 'middle');
            tagEl.setAttribute('dominant-baseline', 'middle');
            tagEl.setAttribute('font-family', 'Georgia, Times New Roman, serif');
            tagEl.setAttribute('font-style', 'italic');
            tagEl.setAttribute('font-size', \`\${Math.min(bannerH * 0.25, r * 0.12)}\`);
            tagEl.setAttribute('fill', '#333333');
            tagEl.textContent = tagline;
            textGroup.appendChild(tagEl);
        }

        svg.appendChild(textGroup);
    }

    // Set proper dimensions for xTool (mm units)
    svg.setAttribute('width', \`\${sizeNum}mm\`);
    svg.setAttribute('height', \`\${sizeNum}mm\`);
    svg.setAttribute('viewBox', vb);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Add xTool metadata comment
    const comment = svgDoc.createComment(
        \` PawTrace AI | xTool F2 Ultra | \${sizeNum}mm x \${sizeNum}mm | Generated \${new Date().toISOString()} \`
    );
    svg.insertBefore(comment, svg.firstChild);

    return new XMLSerializer().serializeToString(svgDoc);
}
