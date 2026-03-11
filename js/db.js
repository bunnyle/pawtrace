// ── Gallery (IndexedDB) ────────────────────────────────────
export function saveToGalleryDB(svgStr, currentStyle, clipShape, petName) {
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
                shape: clipShape || 'circle',
                petName: petName?.trim() || '',
                ts: Date.now()
            });
        };
    } catch (e) { console.warn('Gallery DB save failed:', e.message); }
}

// ── History Recording ─────────────────────────────────
export function saveToHistory(petDesc, imageB64, currentStyle, petName) {
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
                petName: petName?.trim() || '',
                desc: petDesc.substring(0, 100),
                thumb
            });
            if (history.length > 100) history.splice(0, history.length - 100);
            localStorage.setItem('pawtrace_history', JSON.stringify(history));
        };
        img.src = `data:image/png;base64,${imageB64}`;
    } catch (e) { console.warn('History save failed:', e.message); }
}
