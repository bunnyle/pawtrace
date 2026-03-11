// ── Gemini Flash Vision: Describe Pet ────────────────
export async function describePet(apiKey, imageB64) {
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
    throw new Error(`宠物分析失败: ${lastErr?.message}`);
}

// Style prompts — bold & laser-engravable (solid fills, thick outlines)
const stylePrompts = {
    kawaii: 'chibi cartoon style: oversized round head (fills top 60% of circle), big expressive eyes with bold black outlines, simplified cute features, THICK BLACK OUTLINES (3-4px minimum), solid black filled areas for shadows/pupils/nose, high-contrast black-and-white only, like a bold stamp or woodblock print',
    minimal: 'bold silhouette portrait: clean thick strokes outlining the pet face and key features (eyes, ears, nose), solid black fills for dark areas and shadows, enough detail to clearly recognize the breed face, bold linocut/woodcut style — NOT sparse, strokes must be thick enough to engrave',
    stamp: 'vintage rubber stamp / woodcut engraving style: bold thick black ink outlines, solid black fills on fur texture and shadow areas, white negative space, circular composition with double border ring, retro engraved aesthetic, every element must be bold and clear for laser engraving',
    floral: 'flat vector illustration style: centered pet portrait keeping realistic face shape, ear structure, and fur color distribution. Uses clean, solid color blocks (4-6 simplified colors only), soft curved edges, and large bright eyes with highlights. Surrounded by a gentle botanical wreath of leaves, wildflowers, daisies, and lavender in soft, elegant pale tones. White background, overall cute and clean aesthetic.',
    watercolor: '将这张宠物照片转换为水彩插画风格。完全保留原照片中宠物的姿势、表情和构图。柔和水彩风格，毛发用细腻精致的笔触表现，颜色忠实还原原照片的毛色色调。背景元素用松散湿润的水彩晕染表现，画面边缘自然渐变融入白色背景留白。面部细节丰富，尤其是眼睛和鼻子周围。整体氛围温暖舒适，专业水彩插画风格，高质量。'
};

// ── Nano Banana Image-to-Image: Generate Cute Art from original photo ──
// Based on official Google docs: ai.google.dev/gemini-api/docs/image-generation
export async function generateCuteArt(apiKey, petDescription, style, originalPhotoB64) {
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

// ── Helpers ────────────────────────────────────
function getImageMimeType(b64) {
    // Detect from base64 header
    const header = atob(b64.substring(0, 16));
    if (header.startsWith('\xFF\xD8')) return 'image/jpeg';
    if (header.startsWith('\x89PNG')) return 'image/png';
    if (header.startsWith('GIF')) return 'image/gif';
    return 'image/jpeg'; // default
}
