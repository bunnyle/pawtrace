/* ─────────────────────────────────────────────
   PawTrace AI — app.js (UI Controller)
   Powered by Google Gemini API
───────────────────────────────────────────── */

import { describePet, generateCuteArt } from './js/api.js';
import { traceToSVG, finalizeSVGForLaser } from './js/svg-processor.js';
import { saveToGalleryDB, saveToHistory } from './js/db.js';

// ── State ──────────────────────────────────────
let currentStyle = 'kawaii';
let uploadedImageBase64 = null;
let uploadedImageDataURL = null;
let generatedImageB64 = null;
let currentSVGString = null;
let currentImageB64 = null;

// ── Init ───────────────────────────────────────
function init() {
    // Session guard — redirect to login if no valid session
    const sessionStr = localStorage.getItem('pawtrace_session');
    if (sessionStr) {
        const session = JSON.parse(sessionStr);
        if (!session.username || session.expires < Date.now()) {
            localStorage.removeItem('pawtrace_session');
            window.location.href = 'login.html';
            return;
        }
        addNavUserChip(session.username);
    } else {
        // Check if any users are registered; if so, require login
        const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
        if (users.length > 0) {
            window.location.href = 'login.html';
            return;
        }
    }

    bindDOMEvents();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ── DOM Event Binding ────────────────────────────
function bindDOMEvents() {
    // Upload Zone Events
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    
    uploadZone.addEventListener('dragleave', (e) => {
        uploadZone.classList.remove('drag-over');
    });
    
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadFile(file);
    });
    
    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadFile(file);
    });

    // Style Cards
    document.querySelectorAll('.style-card').forEach(card => {
        card.addEventListener('click', () => {
            const style = card.id.replace('style-', '');
            selectStyle(style);
        });
    });

    // Generate Button
    document.getElementById('generateBtn').addEventListener('click', generateSVG);

    // Download/Regen Buttons
    document.getElementById('btnDownloadImage')?.addEventListener('click', downloadImage);
    document.getElementById('btnDownloadSVG')?.addEventListener('click', downloadSVG);
    document.getElementById('btnRegenSVG')?.addEventListener('click', regenSVG);
}

// ── UI Helpers ─────────────────────────────────
function getApiKey() {
    return localStorage.getItem('pawtrace_apikey') || '';
}

// ── File Upload ────────────────────────────────
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
        showError('请先在 ⚙️ 管理 页面设置您的 Google AI Studio API Key 🔑');
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
        const contrastLevel = document.getElementById('contrastLevel').value;
        const svgStr = await traceToSVG(imageB64, contrastLevel);
        currentSVGString = svgStr;
        completeStep(3);

        // Step 4: Finalize for laser
        activateStep(4);
        const options = {
            sizeNum: parseInt(document.getElementById('outputSize').value) || 80,
            borderStyle: document.getElementById('borderStyle').value,
            clipShape: document.getElementById('clipShape')?.value || 'circle',
            petName: document.getElementById('petName')?.value,
            tagline: document.getElementById('petTagline')?.value
        };
        const finalSVG = finalizeSVGForLaser(svgStr, options);
        currentSVGString = finalSVG;
        completeStep(4);

        // Save to history (localStorage thumbnail)
        saveToHistory(petDesc, imageB64, currentStyle, options.petName);

        // Save full SVG to gallery (IndexedDB)
        saveToGalleryDB(finalSVG, currentStyle, options.clipShape, options.petName);

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

// ── Show Results ───────────────────────────────
function showResults(imageB64, svgStr) {
    currentImageB64 = imageB64;
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

// ── Download Colored Image ──────────────────────
async function downloadImage() {
    if (!currentImageB64) {
        alert('请先生成图片再下载 🙏');
        return;
    }

    const filename = `pawtrace_color_${currentStyle}_${Date.now()}.png`;

    const byteString = atob(currentImageB64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: 'image/png' });

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'PNG 彩色图片',
                    accept: { 'image/png': ['.png'] }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error(err);
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
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
    // Fallback: use an anchor tag to force download
    const url = URL.createObjectURL(svgBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
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

// ── Nav User Chip ─────────────────────────────────────
function addNavUserChip(username) {
    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;
    const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
    const user = users.find(u => u.username === username);
    const chip = document.createElement('div');
    chip.style.cssText = 'display:flex;align-items:center;gap:8px;';
    
    // Add dynamic event listener for logout
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = '退出';
    logoutBtn.style.cssText = 'background:rgba(255,107,157,.15);border:1px solid rgba(255,107,157,.25);color:#FF6B9D;border-radius:8px;padding:5px 12px;cursor:pointer;font-size:.8rem;font-family:Inter,sans-serif;font-weight:600;';
    logoutBtn.addEventListener('click', logout);

    if (user?.role === 'admin') {
        const adminLink = document.createElement('a');
        adminLink.href = 'admin.html';
        adminLink.style.cssText = 'color:var(--text-muted);font-size:.85rem;text-decoration:none;font-weight:600;';
        adminLink.textContent = '⚙️ 管理';
        chip.appendChild(adminLink);
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-size:.85rem;color:var(--text-muted);';
    nameSpan.textContent = username;
    
    chip.appendChild(nameSpan);
    chip.appendChild(logoutBtn);
    
    navLinks.appendChild(chip);
}

function logout() {
    localStorage.removeItem('pawtrace_session');
    window.location.href = 'login.html';
}
