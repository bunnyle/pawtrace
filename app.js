/* ─────────────────────────────────────────────
   PawTrace AI — app.js
   Full pipeline: Upload → Gemini Flash (vision) → Nano Banana (image gen) → SVG
   Powered by Google Gemini API
───────────────────────────────────────────── */

// ── State ──────────────────────────────────────
let currentStyle = 'kawaii';
let uploadedImageBase64 = null;
let uploadedImageDataURL = null;
let generatedImageB64 = null;
let currentSVGString = null;
let apiKeyPanelOpen = false;

// ── Init ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    // Session guard — redirect to login if no valid session
    const sessionStr = localStorage.getItem('pawtrace_session');
    if (sessionStr) {
        const session = JSON.parse(sessionStr);
        if (!session.username || session.expires < Date.now()) {
            localStorage.removeItem('pawtrace_session');
            window.location.href = 'login.html';
            return;
        }
    } else {
        // Check if any users are registered; if so, require login
        const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
        if (users.length > 0) {
            window.location.href = 'login.html';
            return;
        }
        // No users registered yet → allow access (first-run setup from login)
    }

    // Show logged-in user in navbar if session exists
    if (sessionStr) {
        const session = JSON.parse(sessionStr);
        addNavUserChip(session.username);
    }

    const saved = localStorage.getItem('pawtrace_apikey');
    if (saved) {
        document.getElementById('apiKeyInput').value = saved;
        updateApiStatus(true);
    }
});

// ── API Key ────────────────────────────────────
function toggleApiPanel() {
    apiKeyPanelOpen = !apiKeyPanelOpen;
    const body = document.getElementById('apiBody');
    const toggle = document.getElementById('apiToggle');
    body.style.display = apiKeyPanelOpen ? 'block' : 'none';
    toggle.classList.toggle('open', apiKeyPanelOpen);
}

function saveApiKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (key.length < 20) {
        showError('请输入有效的 Google AI Studio API Key');
        return;
    }
    localStorage.setItem('pawtrace_apikey', key);
    updateApiStatus(true);
    // Close panel after saving
    if (apiKeyPanelOpen) toggleApiPanel();
}

function updateApiStatus(isSet) {
    const el = document.getElementById('apiStatus');
    el.textContent = isSet ? '✓ 已设置' : '未设置';
    el.className = isSet ? 'api-status set' : 'api-status';
}

function getApiKey() {
    return localStorage.getItem('pawtrace_apikey') || '';
}

// ── File Upload ────────────────────────────────
function handleDragOver(e) {
    e.preventDefault();
    document.getElementById('uploadZone').classList.add('drag-over');
}

function handleDragLeave(e) {
    document.getElementById('uploadZone').classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    document.getElementById('uploadZone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) loadFile(file);
}

function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        uploadedImageDataURL = e.target.result;
        // Extract base64 (strip data URL prefix)
        uploadedImageBase64 = e.target.result.split(',')[1];

        // Show preview
        document.getElementById('previewImg').src = uploadedImageDataURL;
        document.getElementById('uploadContent').style.display = 'none';
        document.getElementById('uploadPreview').style.display = 'block';
        // Also set result original
        document.getElementById('resultOriginal').src = uploadedImageDataURL;
    };
    reader.readAsDataURL(file);
}

// ── Style Selection ────────────────────────────
function selectStyle(style) {
    currentStyle = style;
    document.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
    document.getElementById('style-' + style).classList.add('active');
}

// ── Main Generation Pipeline ───────────────────
async function generateSVG() {
    if (!uploadedImageBase64) {
        showError('请先上传一张宠物照片 📸');
        return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
        showError('请先设置 Google AI Studio API Key 🔑');
        document.getElementById('apiBody').style.display = 'block';
        return;
    }

    // Reset UI
    hideError();
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('generateBtn').disabled = true;
    document.getElementById('progressSection').style.display = 'block';
    resetProgress();

    try {
        // Step 1: Describe pet with Gemini Flash Vision
        activateStep(1);
        const petDesc = await describePet(apiKey, uploadedImageBase64);
        completeStep(1);

        // Step 2: Generate cute art with Nano Banana (image-to-image)
        activateStep(2);
        const imageB64 = await generateCuteArt(apiKey, petDesc, currentStyle, uploadedImageBase64);
        generatedImageB64 = imageB64;
        completeStep(2);

        // Step 3: Trace to SVG
        activateStep(3);
        const svgStr = await traceToSVG(imageB64);
        currentSVGString = svgStr;
        completeStep(3);

        // Step 4: Finalize for laser
        activateStep(4);
        const finalSVG = finalizeSVGForLaser(svgStr);
        currentSVGString = finalSVG;
        completeStep(4);

        // Save to history (localStorage thumbnail)
        saveToHistory(petDesc, imageB64);

        // Save full SVG to gallery (IndexedDB)
        saveToGalleryDB(finalSVG);

        // Show results
        showResults(imageB64, finalSVG);

    } catch (err) {
        console.error(err);
        showError('生成失败：' + (err.message || '未知错误。请检查 API Key 和网络连接。'));
    } finally {
        document.getElementById('generateBtn').disabled = false;
        document.getElementById('progressSection').style.display = 'none';
    }
}

// ── Gemini Flash Vision: Describe Pet ────────────────
async function describePet(apiKey, imageB64) {
    const mimeType = getImageMimeType(imageB64);

    // Try models in order — newest stable first (March 2026)
    const visionModels = [
        'gemini-2.0-flash-lite',   // most available
        'gemini-2.5-flash',        // stable since Jun 2025
        'gemini-3-flash',          // latest (Dec 2025+)
        'gemini-2.0-flash-001'     // specific version fallback
    ];

    let lastErr = null;
    for (const model of visionModels) {
        try {
            console.log(`尝试 Vision 模型: ${model}`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inline_data: { mime_type: mimeType, data: imageB64 } },
                            {
                                text: `You are analyzing a pet photo to create a SPECIFIC line-art portrait. Describe this exact pet with high precision:
1. Species (cat/dog) and breed
2. HEAD SHAPE: round/narrow/long? Snout: long/short/flat/wide?
3. EARS: floppy/upright/pointy/folded? Size relative to head?
4. FUR: short/medium/long? Smooth/fluffy/curly/wiry? Color/pattern (be very specific)
5. EYES: almond/round/small/large? Prominent features?
6. DISTINCTIVE MARKINGS or features that make this pet unique
7. Overall body build: slim/stocky/athletic?
Be very specific. Use descriptive adjectives. Max 120 words. This description will be used to generate an accurate illustration.` }
                        ]
                    }],
                    generationConfig: { maxOutputTokens: 200 }
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `${model} 失败 (${response.status})`);
            }
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error(`${model} 未返回文字`);
            console.log(`Vision 成功 (${model}):`, text.substring(0, 60) + '...');
            return text;
        } catch (e) {
            console.warn(`Vision 模型 ${model} 失败:`, e.message);
            lastErr = e;
        }
    }
    throw new Error(`孠物分析失败: ${lastErr?.message}`);
}

// Style prompts — bold & laser-engravable (solid fills, thick outlines)
const stylePrompts = {
    kawaii: 'chibi cartoon style: oversized round head (fills top 60% of circle), big expressive eyes with bold black outlines, simplified cute features, THICK BLACK OUTLINES (3-4px minimum), solid black filled areas for shadows/pupils/nose, high-contrast black-and-white only, like a bold stamp or woodblock print',
    minimal: 'bold silhouette portrait: clean thick strokes outlining the pet face and key features (eyes, ears, nose), solid black fills for dark areas and shadows, enough detail to clearly recognize the breed face, bold linocut/woodcut style — NOT sparse, strokes must be thick enough to engrave',
    stamp: 'vintage rubber stamp / woodcut engraving style: bold thick black ink outlines, solid black fills on fur texture and shadow areas, white negative space, circular composition with double border ring, retro engraved aesthetic, every element must be bold and clear for laser engraving'
};

// ── Nano Banana Image-to-Image: Generate Cute Art from original photo ──
// Based on official Google docs: ai.google.dev/gemini-api/docs/image-generation
async function generateCuteArt(apiKey, petDescription, style, originalPhotoB64) {
    const styleDesc = stylePrompts[style] || stylePrompts.kawaii;
    const mimeType = originalPhotoB64 ? getImageMimeType(originalPhotoB64) : 'image/jpeg';

    // Compact focused prompt — model can SEE the photo so description is supplemental
    const prompt = `Using this pet photo as reference, create a ${styleDesc} circular portrait illustration.
Key breed features to preserve: ${petDescription}
Requirements: LINE ART ONLY, pure black outlines on white background, NO color fill, NO shading, like a coloring book page. Circular composition, laser-engraving ready.`;

    // Try Gemini image generation models (Nano Banana) in order
    // Key: use x-goog-api-key header (NOT Authorization: Bearer)
    // No generationConfig needed — response contains inlineData in parts
    // Gemini image generation models — confirmed working via official docs
    const imageModels = [
        'gemini-3.1-flash-image-preview',           // Latest Nano Banana (official)
        'gemini-2.0-flash-preview-image-generation', // Previous stable image model
    ];

    const allErrors = [];
    for (const model of imageModels) {
        try {
            console.log(`尝试 Nano Banana 模型: ${model}`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            // Include original photo if available (image-to-image mode)
                            ...(originalPhotoB64 ? [{
                                inline_data: { mime_type: mimeType, data: originalPhotoB64 }
                            }] : []),
                            { text: prompt }
                        ]
                    }]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                const msg = err.error?.message || `HTTP ${response.status}`;
                console.warn(`❌ ${model}: ${msg}`);
                allErrors.push(`[${model}]: ${msg}`);
                continue;
            }

            const data = await response.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find(p => p.inlineData);

            if (imagePart) {
                console.log(`✅ Nano Banana 成功 (${model})`);
                return imagePart.inlineData.data;
            }

            // Model responded with text only — show finish_reason
            const finishReason = data.candidates?.[0]?.finishReason || '?';
            const textPart = parts.find(p => p.text);
            const msg = `返回文字而非图像 (finish_reason: ${finishReason}): ${textPart?.text?.substring(0, 80) || '无内容'}`;
            console.warn(`⚠️ ${model}: ${msg}`);
            allErrors.push(`[${model}]: ${msg}`);

        } catch (e) {
            console.warn(`❌ ${model} 异常:`, e.message);
            allErrors.push(`[${model}]: ${e.message}`);
        }
    }
    throw new Error(`Nano Banana 图像生成失败:\n${allErrors.join('\n')}`);
}

// ── Canvas → SVG Trace ────────────────────────
async function traceToSVG(imageB64) {
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
                const contrast = document.getElementById('contrastLevel').value;
                if (contrast !== 'normal') {
                    applyContrastFilter(ctx, size, contrast);
                }

                // Get image data for tracing
                const imageData = ctx.getImageData(0, 0, size, size);

                // Use ImageTracer if available
                if (typeof ImageTracer !== 'undefined') {
                    const svgStr = ImageTracer.imagedataToSVG(imageData, getTracerOptions(contrast));
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
function finalizeSVGForLaser(svgStr) {
    const sizeVal = document.getElementById('outputSize').value;
    const borderStyle = document.getElementById('borderStyle').value;
    const clipShape = document.getElementById('clipShape')?.value || 'circle';
    const sizeNum = parseInt(sizeVal);

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
        const s = colorStr.replace(/\s/g, '').toLowerCase();
        if (s === 'white') return 255;
        if (s === 'black') return 0;
        if (s === 'none') return -1;
        const hex3 = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
        if (hex3) { const rv = parseInt(hex3[1] + hex3[1], 16), gv = parseInt(hex3[2] + hex3[2], 16), bv = parseInt(hex3[3] + hex3[3], 16); return 0.299 * rv + 0.587 * gv + 0.114 * bv; }
        const hex6 = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
        if (hex6) { const rv = parseInt(hex6[1], 16), gv = parseInt(hex6[2], 16), bv = parseInt(hex6[3], 16); return 0.299 * rv + 0.587 * gv + 0.114 * bv; }
        const rgb = s.match(/^rgba?\((\d+),(\d+),(\d+)/);
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
                    clip: `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" rx="12"/>`,
                    borders: {
                        single: `<rect x="${cx - s - 2}" y="${cy - s - 2}" width="${(s + 2) * 2}" height="${(s + 2) * 2}" rx="14" stroke-width="4" fill="none" stroke="#000"/>`,
                        double: `<rect x="${cx - s - 2}" y="${cy - s - 2}" width="${(s + 2) * 2}" height="${(s + 2) * 2}" rx="14" stroke-width="5" fill="none" stroke="#000"/><rect x="${cx - s + 10}" y="${cy - s + 10}" width="${(s - 10) * 2}" height="${(s - 10) * 2}" rx="8" stroke-width="2" fill="none" stroke="#000"/>`,
                        dotted: `<rect x="${cx - s - 2}" y="${cy - s - 2}" width="${(s + 2) * 2}" height="${(s + 2) * 2}" rx="14" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>`,
                    }
                };
            }
            case 'hexagon': {
                const hr = rInner;
                const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${cx + hr * Math.cos(a)},${cy + hr * Math.sin(a)}`; }).join(' ');
                const bpts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${cx + (hr + 4) * Math.cos(a)},${cy + (hr + 4) * Math.sin(a)}`; }).join(' ');
                const bpts2 = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${cx + (hr - 14) * Math.cos(a)},${cy + (hr - 14) * Math.sin(a)}`; }).join(' ');
                return {
                    clip: `<polygon points="${pts}"/>`,
                    borders: {
                        single: `<polygon points="${bpts}" stroke-width="4" fill="none" stroke="#000"/>`,
                        double: `<polygon points="${bpts}" stroke-width="5" fill="none" stroke="#000"/><polygon points="${bpts2}" stroke-width="2" fill="none" stroke="#000"/>`,
                        dotted: `<polygon points="${bpts}" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>`,
                    }
                };
            }
            case 'diamond': {
                const dr = rInner;
                const pts = `${cx},${cy - dr} ${cx + dr * 0.75},${cy} ${cx},${cy + dr} ${cx - dr * 0.75},${cy}`;
                const bpts = `${cx},${cy - dr - 4} ${cx + dr * 0.75 + 4},${cy} ${cx},${cy + dr + 4} ${cx - dr * 0.75 - 4},${cy}`;
                return {
                    clip: `<polygon points="${pts}"/>`,
                    borders: {
                        single: `<polygon points="${bpts}" stroke-width="4" fill="none" stroke="#000"/>`,
                        double: `<polygon points="${bpts}" stroke-width="5" fill="none" stroke="#000"/><polygon points="${cx},${cy - dr + 12} ${cx + dr * 0.75 - 10},${cy} ${cx},${cy + dr - 12} ${cx - dr * 0.75 + 10},${cy}" stroke-width="2" fill="none" stroke="#000"/>`,
                        dotted: `<polygon points="${bpts}" stroke-width="4" stroke-dasharray="10,7" fill="none" stroke="#000"/>`,
                    }
                };
            }
            case 'paw': {
                const padRx = rInner * 0.52, padRy = rInner * 0.48, padCy = cy + rInner * 0.1, tr = rInner * 0.22;
                const toes = [{ tx: cx - rInner * 0.42, ty: cy - rInner * 0.42 }, { tx: cx - rInner * 0.14, ty: cy - rInner * 0.58 }, { tx: cx + rInner * 0.14, ty: cy - rInner * 0.58 }, { tx: cx + rInner * 0.42, ty: cy - rInner * 0.42 }];
                const toeClips = toes.map(t => `<ellipse cx="${t.tx}" cy="${t.ty}" rx="${tr}" ry="${tr * 0.88}"/>`).join('');
                const toeBords = toes.map(t => `<ellipse cx="${t.tx}" cy="${t.ty}" rx="${tr + 3}" ry="${(tr + 3) * 0.88}" stroke-width="4" fill="none" stroke="#000"/>`).join('');
                return {
                    clip: `<ellipse cx="${cx}" cy="${padCy}" rx="${padRx}" ry="${padRy}"/>${toeClips}`,
                    borders: {
                        single: `<ellipse cx="${cx}" cy="${padCy}" rx="${padRx + 4}" ry="${padRy + 4}" stroke-width="4" fill="none" stroke="#000"/>${toeBords}`,
                        double: `<ellipse cx="${cx}" cy="${padCy}" rx="${padRx + 4}" ry="${padRy + 4}" stroke-width="5" fill="none" stroke="#000"/><ellipse cx="${cx}" cy="${padCy}" rx="${padRx - 10}" ry="${padRy - 10}" stroke-width="2" fill="none" stroke="#000"/>${toeBords}`,
                        dotted: `<ellipse cx="${cx}" cy="${padCy}" rx="${padRx + 4}" ry="${padRy + 4}" stroke-width="4" stroke-dasharray="10,7" fill="none" stroke="#000"/>`,
                    }
                };
            }
            case 'none':
                return { clip: null, borders: { single: '', double: '', dotted: '' } };
            case 'circle':
            default:
                return {
                    clip: `<circle cx="${cx}" cy="${cy}" r="${rInner}"/>`,
                    borders: {
                        single: `<circle cx="${cx}" cy="${cy}" r="${r - 6}" stroke-width="4" fill="none" stroke="#000"/>`,
                        double: `<circle cx="${cx}" cy="${cy}" r="${r - 4}" stroke-width="5" fill="none" stroke="#000"/><circle cx="${cx}" cy="${cy}" r="${r - 18}" stroke-width="2" fill="none" stroke="#000"/>`,
                        dotted: `<circle cx="${cx}" cy="${cy}" r="${r - 6}" stroke-width="4" stroke-dasharray="12,8" fill="none" stroke="#000"/>`,
                    }
                };
        }
    }

    const { clip, borders } = buildShapeGeometry(clipShape);

    // Apply clip
    if (clip) {
        defs.innerHTML += `<clipPath id="${clipId}">${clip}</clipPath>`;
        const allContent = Array.from(svg.children).filter(el => el.tagName !== 'defs');
        const g = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('clip-path', `url(#${clipId})`);
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
    const petName = (document.getElementById('petName')?.value || '').trim().toUpperCase();
    const tagline = (document.getElementById('petTagline')?.value || '').trim();

    if (petName || tagline) {
        // Banner dimensions — bottom quarter of circle
        const bannerH = r * 0.38;
        const bannerY = cy + r - bannerH - 8;

        // White banner rectangle (clipped to circle via the same clip)
        const bannerClipId = 'bannerClip';
        defs.innerHTML += `<clipPath id="${bannerClipId}"><circle cx="${cx}" cy="${cy}" r="${r - 8}"/></clipPath>`;

        const textGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g');
        textGroup.setAttribute('id', 'text-banner');
        textGroup.setAttribute('clip-path', `url(#${bannerClipId})`);

        // White background band
        textGroup.innerHTML = `
  <rect x="${cx - r + 8}" y="${bannerY}" width="${(r - 8) * 2}" height="${bannerH + 8}" fill="white"/>
  <line x1="${cx - r + 8}" y1="${bannerY}" x2="${cx + r - 8}" y2="${bannerY}" stroke="#000" stroke-width="3"/>`;

        // Pet name text
        if (petName) {
            const nameEl = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text');
            nameEl.setAttribute('x', `${cx}`);
            nameEl.setAttribute('y', `${bannerY + bannerH * (tagline ? 0.48 : 0.62)}`);
            nameEl.setAttribute('text-anchor', 'middle');
            nameEl.setAttribute('dominant-baseline', 'middle');
            nameEl.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
            nameEl.setAttribute('font-weight', 'bold');
            nameEl.setAttribute('font-size', `${Math.min(bannerH * 0.42, r * 0.18)}`);
            nameEl.setAttribute('fill', '#000000');
            nameEl.setAttribute('letter-spacing', '3');
            nameEl.textContent = petName;
            textGroup.appendChild(nameEl);
        }

        // Tagline text
        if (tagline) {
            const tagEl = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text');
            tagEl.setAttribute('x', `${cx}`);
            tagEl.setAttribute('y', `${bannerY + bannerH * (petName ? 0.78 : 0.55)}`);
            tagEl.setAttribute('text-anchor', 'middle');
            tagEl.setAttribute('dominant-baseline', 'middle');
            tagEl.setAttribute('font-family', 'Georgia, Times New Roman, serif');
            tagEl.setAttribute('font-style', 'italic');
            tagEl.setAttribute('font-size', `${Math.min(bannerH * 0.24, r * 0.1)}`);
            tagEl.setAttribute('fill', '#333333');
            tagEl.textContent = tagline;
            textGroup.appendChild(tagEl);
        }

        svg.appendChild(textGroup);
    }

    // Set proper dimensions for xTool (mm units)
    svg.setAttribute('width', `${sizeNum}mm`);
    svg.setAttribute('height', `${sizeNum}mm`);
    svg.setAttribute('viewBox', vb);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Add xTool metadata comment
    const comment = svgDoc.createComment(
        ` PawTrace AI | xTool F2 Ultra | ${sizeNum}mm x ${sizeNum}mm | Generated ${new Date().toISOString()} `
    );
    svg.insertBefore(comment, svg.firstChild);

    return new XMLSerializer().serializeToString(svgDoc);
}

// ── Show Results ───────────────────────────────
function showResults(imageB64, svgStr) {
    // Set generated image preview
    document.getElementById('resultGenerated').src = `data:image/png;base64,${imageB64}`;

    // Render SVG preview
    const svgFrame = document.getElementById('svgPreview');
    svgFrame.innerHTML = svgStr;

    // Update size badge
    const size = document.getElementById('outputSize').value;
    document.getElementById('svgSizeBadge').textContent = `${size}mm × ${size}mm`;

    // Show section
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Download SVG ────────────────────────────────
async function downloadSVG() {
    if (!currentSVGString) {
        alert('请先生成 SVG 再下载 🙏');
        return;
    }

    const filename = `pawtrace_${currentStyle}_${Date.now()}.svg`;
    const svgBlob = new Blob([currentSVGString], { type: 'image/svg+xml;charset=utf-8' });

    // Try File System Access API first (works from file:// origin, shows proper Save dialog)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'SVG 矢量文件',
                    accept: { 'image/svg+xml': ['.svg'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(svgBlob);
            await writable.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // user cancelled dialog
            console.warn('showSaveFilePicker failed, falling back:', e.message);
        }
    }

    // Fallback: open SVG in new tab — user can File > Save As to save with correct filename
    const url = URL.createObjectURL(svgBlob);
    const tab = window.open(url, '_blank');
    if (tab) {
        if (tab.document) tab.document.title = filename;
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        // Show instruction
        setTimeout(() => {
            alert(`SVG 已在新标签页打开。\n请按 Cmd+S（Mac）或 Ctrl+S（Windows）另存为 "${filename}"`);
        }, 500);
    } else {
        alert('请允许弹出窗口以下载 SVG 文件');
        URL.revokeObjectURL(url);
    }
}

function regenSVG() {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('generate').scrollIntoView({ behavior: 'smooth' });
    generateSVG();
}

// ── Progress Steps ─────────────────────────────
function resetProgress() {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById('prog' + i);
        el.classList.remove('active', 'done');
    }
}

function activateStep(n) {
    const el = document.getElementById('prog' + n);
    el.classList.add('active');
}

function completeStep(n) {
    const el = document.getElementById('prog' + n);
    el.classList.remove('active');
    el.classList.add('done');
}

// ── Error Handling ─────────────────────────────
function showError(msg) {
    const box = document.getElementById('errorBox');
    document.getElementById('errorMsg').textContent = msg;
    box.style.display = 'flex';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
    document.getElementById('errorBox').style.display = 'none';
}

// ── Gallery (IndexedDB) ────────────────────────────────────
function saveToGalleryDB(svgStr) {
    try {
        const DB_NAME = 'PawTraceGallery';
        const STORE = 'svgs';
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            store.add({
                svg: svgStr,
                style: currentStyle,
                shape: document.getElementById('clipShape')?.value || 'circle',
                petName: document.getElementById('petName')?.value?.trim() || '',
                ts: Date.now()
            });
        };
    } catch (e) { console.warn('Gallery DB save failed:', e.message); }
}

// ── History Recording ─────────────────────────────────
function saveToHistory(petDesc, imageB64) {
    try {
        const history = JSON.parse(localStorage.getItem('pawtrace_history') || '[]');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 80;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, 80, 80);
            const thumb = canvas.toDataURL('image/jpeg', 0.6);
            history.push({
                ts: Date.now(),
                style: currentStyle,
                petName: document.getElementById('petName')?.value?.trim() || '',
                desc: petDesc.substring(0, 100),
                thumb
            });
            if (history.length > 100) history.splice(0, history.length - 100);
            localStorage.setItem('pawtrace_history', JSON.stringify(history));
        };
        img.src = `data:image/png;base64,${imageB64}`;
    } catch (e) { console.warn('History save failed:', e.message); }
}

// ── Nav User Chip ─────────────────────────────────────
function addNavUserChip(username) {
    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;
    const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
    const user = users.find(u => u.username === username);
    const chip = document.createElement('div');
    chip.style.cssText = 'display:flex;align-items:center;gap:8px;';
    chip.innerHTML = `
        ${user?.role === 'admin' ? `<a href="admin.html" style="color:var(--text-muted);font-size:.85rem;text-decoration:none;font-weight:600;">⚙️ 管理</a>` : ''}
        <span style="font-size:.85rem;color:var(--text-muted);">${username}</span>
        <button onclick="logout()" style="background:rgba(255,107,157,.15);border:1px solid rgba(255,107,157,.25);color:#FF6B9D;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:.8rem;font-family:Inter,sans-serif;font-weight:600;">退出</button>
    `;
    navLinks.appendChild(chip);
}
function logout() {
    localStorage.removeItem('pawtrace_session');
    window.location.href = 'login.html';
}

// ── Helpers ────────────────────────────────────
function getImageMimeType(b64) {
    // Detect from base64 header
    const header = atob(b64.substring(0, 16));
    if (header.startsWith('\xFF\xD8')) return 'image/jpeg';
    if (header.startsWith('\x89PNG')) return 'image/png';
    if (header.startsWith('GIF')) return 'image/gif';
    return 'image/jpeg'; // default
}
