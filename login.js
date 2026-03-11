        const USERS_KEY = 'pawtrace_users';
        const SESSION_KEY = 'pawtrace_session';

        // If already logged in, redirect
        const existingSession = localStorage.getItem(SESSION_KEY);
        if (existingSession) {
            try {
                const ses = JSON.parse(existingSession);
                const us = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
                if (us.find(u => u.username === ses.username) && ses.expires > Date.now()) {
                    window.location.href = 'index.html';
                } else { localStorage.removeItem(SESSION_KEY); }
            } catch (e) { localStorage.removeItem(SESSION_KEY); }
        }

        const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
        const isSetup = users.length === 0;

        // Show correct UI
        if (isSetup) {
            document.getElementById('setupBadgeWrap').style.display = 'block';
            document.getElementById('setupForm').style.display = 'block';
        } else {
            document.getElementById('authTabs').style.display = 'flex';
            document.getElementById('loginForm').style.display = 'block';
        }

        function switchTab(tab) {
            hideError();
            document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
            document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
            document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
            document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
        }

        // ── SHA-256 ──────────────────────────────────────
        async function sha256(msg) {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function createSession(username) {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ username, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
        }

        // ── Login ─────────────────────────────────────────
        async function handleSubmit(e) {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            btn.disabled = true; btn.innerHTML = '<span class="spinner"><\\/span>验证中...';
            hideError();
            try {
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value;
                const hash = await sha256(password + username + 'pawtrace_salt');
                const user = users.find(u => u.username === username && u.hash === hash);
                if (!user) throw new Error('用户名或密码错误');
                await createSession(username);
                window.location.href = 'index.html';
            } catch (err) {
                showError(err.message);
                btn.disabled = false; btn.textContent = '登录 →';
            }
        }

        // ── First-time Setup ───────────────────────────────
        async function handleSetupSubmit(e) {
            e.preventDefault();
            const btn = document.getElementById('setupBtn');
            btn.disabled = true; btn.innerHTML = '<span class="spinner"><\\/span>创建中...';
            hideError();
            try {
                const username = document.getElementById('setupUsername').value.trim();
                const usernameC = document.getElementById('setupUsernameConfirm').value.trim();
                const password = document.getElementById('setupPassword').value;
                const passwordC = document.getElementById('setupPasswordConfirm').value;
                if (username.length < 2) throw new Error('用户名至少 2 个字符');
                if (username !== usernameC) throw new Error('两次用户名不一致');
                if (password.length < 8) throw new Error('密码至少 8 位');
                if (password !== passwordC) throw new Error('两次密码不一致');
                const hash = await sha256(password + username + 'pawtrace_salt');
                localStorage.setItem(USERS_KEY, JSON.stringify([{ username, hash, role: 'admin', createdAt: Date.now() }]));
                await createSession(username);
                window.location.href = 'index.html';
            } catch (err) {
                showError(err.message);
                btn.disabled = false; btn.textContent = '创建管理员账户 →';
            }
        }

        // ── Self Registration ─────────────────────────────
        async function handleRegisterSubmit(e) {
            e.preventDefault();
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true; btn.innerHTML = '<span class="spinner"><\\/span>注册中...';
            hideError();
            try {
                const username = document.getElementById('regUsername').value.trim();
                const password = document.getElementById('regPassword').value;
                const passwordC = document.getElementById('regPasswordConfirm').value;
                if (username.length < 2) throw new Error('用户名至少 2 个字符');
                if (password.length < 8) throw new Error('密码至少 8 位');
                if (password !== passwordC) throw new Error('两次密码不一致');
                const existingUsers = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
                if (existingUsers.find(u => u.username === username)) throw new Error('用户名已被使用');
                const hash = await sha256(password + username + 'pawtrace_salt');
                existingUsers.push({ username, hash, role: 'user', createdAt: Date.now() });
                localStorage.setItem(USERS_KEY, JSON.stringify(existingUsers));
                await createSession(username);
                window.location.href = 'index.html';
            } catch (err) {
                showError(err.message);
                btn.disabled = false; btn.textContent = '注册并登录 →';
            }
        }

        function showError(msg) {
            const el = document.getElementById('loginError');
            el.textContent = '⚠️ ' + msg; el.classList.add('show');
        }
        function hideError() { document.getElementById('loginError').classList.remove('show'); }
        function togglePassword(id = 'password') {
            const inp = document.getElementById(id);
            inp.type = inp.type === 'password' ? 'text' : 'password';
        }
        function resetAccount() {
            if (confirm('⚠️ 这将清除所有账户数据和历史记录，确认重置？')) {
                if (confirm('再次确认：所有数据将永久删除，无法恢复！')) {
                    ['pawtrace_users', 'pawtrace_session', 'pawtrace_history', 'pawtrace_apikey'].forEach(k => localStorage.removeItem(k));
                    window.location.reload();
                }
            }
        }
