/* ──────────────────────────────────────────────────────────
   PawTrace AI — gallery.js
   IndexedDB-based SVG gallery: store, list, download, delete
──────────────────────────────────────────────────────────── */

// ── Auth Guard ────────────────────────────────────────────
const sessionStr = localStorage.getItem('pawtrace_session');
if (sessionStr) {
    const ses = JSON.parse(sessionStr);
    if (!ses.username || ses.expires < Date.now()) {
        localStorage.removeItem('pawtrace_session');
        window.location.href = 'login.html';
    } else {
        // Show user in nav
        document.getElementById('navUser').textContent = ses.username;
        document.getElementById('logoutBtn').style.display = 'block';
        // Check admin
        const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
        const u = users.find(x => x.username === ses.username);
        if (u?.role === 'admin') document.getElementById('adminLink').style.display = 'block';
    }
} else {
    const users = JSON.parse(localStorage.getItem('pawtrace_users') || '[]');
    if (users.length > 0) { window.location.href = 'login.html'; }
}

function logout() {
    localStorage.removeItem('pawtrace_session');
    window.location.href = 'login.html';
}

// ── IndexedDB Setup ───────────────────────────────────────
const DB_NAME = 'PawTraceGallery';
const DB_VERSION = 1;
const STORE = 'svgs';

let db;
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('ts', 'ts', { unique: false });
                store.createIndex('style', 'style', { unique: false });
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = e => reject(e.target.error);
    });
}

/* Public API for app.js to call: saveToGallery(record) */
async function saveToGallery(record) {
    /* record = { svg:string, style:string, petName:string, shape:string, ts:number } */
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.add({ ...record, ts: record.ts || Date.now() });
        req.onsuccess = () => resolve(req.result);
        req.onerror = e => reject(e.target.error);
    });
}

async function getAllSVGs() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.reverse()); // newest first
        req.onerror = e => reject(e.target.error);
    });
}

async function deleteSVG(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

async function clearAllSVGs() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = e => reject(e.target.error);
    });
}

// ── State ─────────────────────────────────────────────────
let allItems = [];
let activeFilter = 'all';
let modalItem = null;

const styleLabels = { kawaii: 'Chibi 🌸', minimal: '简约 ✏️', stamp: '印章 🏮' };

// ── Render ────────────────────────────────────────────────
async function loadGallery() {
    allItems = await getAllSVGs();
    renderCards();
}

function renderCards() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');
    const count = document.getElementById('galleryCount');

    const filtered = allItems.filter(item => {
        const matchStyle = activeFilter === 'all' || item.style === activeFilter;
        const matchSearch = !query || (item.petName || '').toLowerCase().includes(query);
        return matchStyle && matchSearch;
    });

    count.textContent = `共 ${filtered.length} 个作品`;

    if (filtered.length === 0) {
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    grid.innerHTML = filtered.map(item => `
        <div class="gallery-card" data-id="${item.id}">
            <div class="card-preview" onclick="openModal(${item.id})">
                ${item.svg
            ? `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:12px;">${item.svg}</div>`
            : `<span class="no-svg">🐾</span>`}
            </div>
            <div class="card-body">
                <div class="card-pet-name">${item.petName || '未命名'}</div>
                <div class="card-meta">${formatTime(item.ts)} · ${item.shape || 'circle'}</div>
                <div class="card-tags">
                    <span class="card-tag ${item.style}">${styleLabels[item.style] || item.style}</span>
                </div>
            </div>
            <div class="card-actions">
                <button class="btn-card btn-dl"  onclick="downloadOne(${item.id})">⬇️ 下载</button>
                <button class="btn-card btn-del" onclick="deleteOne(${item.id})">🗑</button>
            </div>
        </div>
    `).join('');
}

function setFilter(f, btn) {
    activeFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCards();
}

function filterCards() { renderCards(); }

function formatTime(ts) {
    const d = new Date(ts), now = new Date();
    const diff = Math.floor((now - d) / 60000);
    if (diff < 1) return '刚刚';
    if (diff < 60) return diff + ' 分钟前';
    if (diff < 1440) return Math.floor(diff / 60) + ' 小时前';
    return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Actions ───────────────────────────────────────────────
async function deleteOne(id) {
    if (!confirm('确认删除这个作品？')) return;
    await deleteSVG(id);
    allItems = allItems.filter(x => x.id !== id);
    renderCards();
}

function downloadOne(id) {
    const item = allItems.find(x => x.id === id);
    if (!item?.svg) return;
    triggerDownload(item.svg, `pawtrace_${item.petName || 'pet'}_${item.style}.svg`);
}

function triggerDownload(svgStr, filename) {
    if (window.showSaveFilePicker) {
        window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } }] })
            .then(fh => fh.createWritable())
            .then(async w => { await w.write(svgStr); await w.close(); })
            .catch(() => fallbackDownload(svgStr, filename));
    } else {
        fallbackDownload(svgStr, filename);
    }
}

function fallbackDownload(svgStr, filename) {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function clearAll() {
    if (!confirm(`确认清空所有 ${allItems.length} 个作品？此操作无法恢复。`)) return;
    await clearAllSVGs();
    allItems = [];
    renderCards();
}

// ── Modal ─────────────────────────────────────────────────
function openModal(id) {
    modalItem = allItems.find(x => x.id === id);
    if (!modalItem) return;
    document.getElementById('modalTitle').textContent = modalItem.petName || '未命名作品';
    document.getElementById('modalSvg').innerHTML = modalItem.svg || '<p style="color:var(--text-muted);text-align:center">无 SVG 数据</p>';
    document.getElementById('modalInfo').innerHTML =
        `风格：${styleLabels[modalItem.style] || modalItem.style} &nbsp;|&nbsp; 形状：${modalItem.shape || 'circle'} &nbsp;|&nbsp; ${formatTime(modalItem.ts)}`;
    document.getElementById('modal').classList.add('show');
}

function closeModal() {
    document.getElementById('modal').classList.remove('show');
    modalItem = null;
}

function modalDownload() {
    if (!modalItem) return;
    downloadOne(modalItem.id);
}

// Click outside modal to close
document.getElementById('modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
});

// ── Init ──────────────────────────────────────────────────
loadGallery();
