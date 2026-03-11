/* ─────────────────────────────────────────────
   PawTrace AI — admin.js
   Admin dashboard logic: auth guard, stats, history, users, API key
───────────────────────────────────────────── */

// ── Keys ────────────────────────────────────────
const USERS_KEY = 'pawtrace_users';
const SESSION_KEY = 'pawtrace_session';
const HISTORY_KEY = 'pawtrace_history';
const APIKEY_KEY = 'pawtrace_apikey';

// ── Auth Guard ───────────────────────────────────
(function checkAuth() {
    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (!sessionStr) { window.location.href = 'login.html'; return; }
    const session = JSON.parse(sessionStr);
    if (!session.username || session.expires < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        window.location.href = 'login.html';
        return;
    }
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const user = users.find(u => u.username === session.username);
    if (!user || user.role !== 'admin') {
        window.location.href = 'index.html'; // non-admin goes to app
        return;
    }

    // Show user info in sidebar
    document.getElementById('sidebarUser').textContent = session.username;
    document.getElementById('sidebarAvatar').textContent = session.username[0].toUpperCase();
    document.getElementById('welcomeMsg').textContent =
        `欢迎回来，${session.username}！最后更新：${new Date().toLocaleString('zh-TW')}`;
})();

// ── Logout ───────────────────────────────────────
function logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'login.html';
}

// ── Load Dashboard ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadHistory();
    loadApiKey();
    loadUsers();
    renderChart();
});

// ── Stats ────────────────────────────────────────
function loadStats() {
    const history = getHistory();
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');

    // Total
    document.getElementById('statTotal').textContent = history.length;

    // Today
    const today = new Date().toDateString();
    const todayCount = history.filter(h => new Date(h.ts).toDateString() === today).length;
    document.getElementById('statToday').textContent = todayCount;

    // Users
    document.getElementById('statUsers').textContent = users.length;

    // Favorite style
    const styleCounts = {};
    history.forEach(h => { styleCounts[h.style] = (styleCounts[h.style] || 0) + 1; });
    const topStyle = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0];
    const styleLabels = { kawaii: 'Chibi 🌸', minimal: '简约 ✏️', stamp: '印章 🏮' };
    document.getElementById('statFavoriteStyle').textContent =
        topStyle ? styleLabels[topStyle[0]] || topStyle[0] : '—';
}

// ── History ───────────────────────────────────────
function getHistory() {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

function loadHistory() {
    const history = getHistory();
    const tbody = document.getElementById('historyBody');
    const noHistory = document.getElementById('noHistory');
    const table = document.getElementById('historyTable');

    if (history.length === 0) {
        noHistory.style.display = 'block';
        table.style.display = 'none';
        return;
    }

    noHistory.style.display = 'none';
    table.style.display = 'table';
    tbody.innerHTML = '';

    // Show most recent first
    const sorted = [...history].reverse().slice(0, 50);
    sorted.forEach(item => {
        const tr = document.createElement('tr');
        const styleLabels = { kawaii: 'kawaii', minimal: 'minimal', stamp: 'stamp' };

        tr.innerHTML = `
            <td>
                ${item.thumb
                ? `<img class="history-thumb" src="${item.thumb}" alt="thumbnail" loading="lazy">`
                : `<div class="thumb-placeholder">🐾</div>`}
            </td>
            <td style="font-size:.88rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${item.petName || '—'}
            </td>
            <td>
                <span class="style-tag ${item.style}">${styleLabels[item.style] || item.style}</span>
            </td>
            <td style="font-size:.78rem;color:var(--text-muted);white-space:nowrap;">
                ${formatTime(item.ts)}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function clearHistory() {
    if (!confirm('确认清空所有 ' + getHistory().length + ' 条生成记录？')) return;
    localStorage.removeItem(HISTORY_KEY);
    loadHistory();
    loadStats();
    renderChart();
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return diffMin + ' 分钟前';
    if (diffMin < 1440) return Math.floor(diffMin / 60) + ' 小时前';
    return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Style Chart ───────────────────────────────────
let chartInstance = null;

function renderChart() {
    const history = getHistory();
    const canvas = document.getElementById('styleChart');
    const noChart = document.getElementById('noChart');

    if (history.length === 0) {
        canvas.style.display = 'none';
        noChart.style.display = 'block';
        return;
    }
    canvas.style.display = 'block';
    noChart.style.display = 'none';

    const counts = { kawaii: 0, minimal: 0, stamp: 0 };
    history.forEach(h => { if (counts[h.style] !== undefined) counts[h.style]++; });

    const data = {
        labels: ['Chibi 🌸', '简约 ✏️', '印章 🏮'],
        datasets: [{
            data: [counts.kawaii, counts.minimal, counts.stamp],
            backgroundColor: ['rgba(10, 132, 255, .7)', 'rgba(94, 92, 230, .7)', 'rgba(48, 209, 88, .7)'],
            borderColor: ['#0A84FF', '#5E5CE6', '#30D158'],
            borderWidth: 2,
        }]
    };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas, {
        type: 'doughnut',
        data,
        options: {
            plugins: {
                legend: { labels: { color: '#F0EEFF', font: { family: 'Inter', size: 12 }, padding: 16 } }
            },
            cutout: '60%',
        }
    });
}

// ── API Key ───────────────────────────────────────
function loadApiKey() {
    const key = localStorage.getItem(APIKEY_KEY) || '';
    const disp = document.getElementById('apiKeyDisplay');
    if (key) {
        disp.textContent = key.substring(0, 8) + '••••••••••••••••••••••••••••••' + key.slice(-4);
        disp.style.color = 'var(--text)';
    } else {
        disp.textContent = '（未设置）';
        disp.style.color = 'var(--text-muted)';
    }
}

function editApiKey() {
    const current = localStorage.getItem(APIKEY_KEY) || '';
    const newKey = prompt('输入新的 Google AI Studio API Key：', current);
    if (newKey === null) return;
    if (newKey.trim().length < 20) { alert('API Key 太短，请检查'); return; }
    localStorage.setItem(APIKEY_KEY, newKey.trim());
    loadApiKey();
    alert('✅ API Key 已更新');
}

function deleteApiKey() {
    if (!confirm('确认删除 API Key？删除后无法生成图像。')) return;
    localStorage.removeItem(APIKEY_KEY);
    loadApiKey();
}

// ── User Management ──────────────────────────────
function loadUsers() {
    let users = [];
    try { users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (e) {}
    if (!Array.isArray(users)) users = [];

    const list = document.getElementById('userList');
    list.innerHTML = '';

    users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'user-row';
        div.innerHTML = `
            <div class="user-row-avatar">${u.username[0].toUpperCase()}</div>
            <div class="user-row-info">
                <div class="user-row-name">${u.username}</div>
                <div class="user-row-meta">创建于 ${new Date(u.createdAt).toLocaleDateString('zh-TW')}</div>
            </div>
            <span class="role-badge ${u.role}">${u.role === 'admin' ? '管理员' : '用户'}</span>
        `;
        // Don't allow deleting the only admin
        if (u.role !== 'admin' || users.filter(x => x.role === 'admin').length > 1) {
            const delBtn = document.createElement('button');
            delBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.9rem;';
            delBtn.textContent = '🗑';
            delBtn.onclick = () => deleteUser(u.username);
            div.appendChild(delBtn);
        }
        list.appendChild(div);
    });
}

function toggleAddUser() {
    const form = document.getElementById('addUserForm');
    form.classList.toggle('show');
}

async function addUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;

    if (!username || username.length < 2) { alert('用户名至少 2 个字符'); return; }
    if (password.length < 8) { alert('密码至少 8 位'); return; }

    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    if (users.find(u => u.username === username)) { alert('该用户名已存在'); return; }

    const hash = await sha256(password + username + 'pawtrace_salt');
    users.push({ username, hash, role: 'user', createdAt: Date.now() });
    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('addUserForm').classList.remove('show');
    loadUsers();
    loadStats();
    alert(`✅ 用户 "${username}" 创建成功！`);
}

function deleteUser(username) {
    if (!confirm(`确认删除用户 "${username}"？`)) return;
    const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]').filter(u => u.username !== username);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    loadUsers();
    loadStats();
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
