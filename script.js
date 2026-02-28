let allReports = [];
let currentTag = 'Все';
let selectedImageBase64 = null;
let userProfile = null;
let currentDiscussionId = null;
let ws = null;
const pendingActions = new Set();

const api = {
    async getProfile() {
        const res = await fetch('/api/profile');
        return res.json();
    },
    async setProfile(nickname) {
        const res = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname })
        });
        return res.json();
    },
    async getReports() {
        const res = await fetch('/api/reports');
        if (!res.ok) throw new Error('Failed to fetch reports');
        return res.json();
    },
    async upvote(id) {
        const res = await fetch(`/api/reports/${id}/upvote`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to upvote');
        }
        return res.json();
    },
    async getComments(id) {
        const res = await fetch(`/api/reports/${id}/comments`);
        return res.json();
    },
    async postComment(id, text) {
        const res = await fetch(`/api/reports/${id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to post comment');
        }
        return res.json();
    },
    async updateStatus(id, status) {
        const res = await fetch(`/api/reports/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error('Failed to update status');
        return res.json();
    },
    async resolve(id, result_text) {
        const res = await fetch(`/api/reports/${id}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result_text })
        });
        if (!res.ok) throw new Error('Failed to resolve');
        return res.json();
    },
    async createReport(data) {
        const res = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to create report');
        }
        return res.json();
    }
};

async function initProfile() {
    userProfile = await api.getProfile();
    if (!userProfile.nickname) {
        document.getElementById('nickname-modal').classList.remove('hidden');
    } else {
        updateProfileUI();
    }
}

function updateProfileUI() {
    const el = document.getElementById('user-profile');
    const nick = document.getElementById('user-nickname');
    if (el && nick && userProfile.nickname) {
        el.classList.remove('hidden');
        nick.textContent = userProfile.nickname;
    }
}

document.getElementById('nickname-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nick = document.getElementById('nickname-input').value;
    try {
        userProfile = await api.setProfile(nick);
        document.getElementById('nickname-modal').classList.add('hidden');
        updateProfileUI();
    } catch (e) {
        alert('Ошибка сохранения профиля');
    }
});

async function fetchData() {
    if (pendingActions.size > 0) return;
    
    try {
        allReports = await api.getReports();
        applyFilters();
    } catch (error) {
        console.error('Fetch error:', error);
        const list = document.getElementById('reports-list');
        if (list) list.innerHTML = `<div class="col-span-full text-center py-20 text-red-400">Ошибка: ${error.message}</div>`;
    }
}

function applyFilters() {
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
    
    let filtered = allReports.filter(r => {
        const matchesTag = currentTag === 'Все' || r.type === currentTag;
        const matchesSearch = !searchTerm || 
            r.description.toLowerCase().includes(searchTerm) || 
            r.location.toLowerCase().includes(searchTerm) ||
            r.type.toLowerCase().includes(searchTerm);
        return matchesTag && matchesSearch;
    });

    filtered.sort((a, b) => {
        const statusOrder = { 'принято': 0, 'в работе': 0, 'решено': 1 };
        if (statusOrder[a.status] !== statusOrder[b.status]) {
            return statusOrder[a.status] - statusOrder[b.status];
        }
        if ((b.priority || 1) !== (a.priority || 1)) {
            return (b.priority || 1) - (a.priority || 1);
        }
        return (b.upvotes || 0) - (a.upvotes || 0);
    });
    
    renderReports(filtered);
}

function renderReports(reports) {
    const list = document.getElementById('reports-list');
    if (!list) return;
    
    if (reports.length === 0) {
        list.innerHTML = '<div class="col-span-full text-center py-20 text-slate-400">Ничего не найдено</div>';
        return;
    }

    list.innerHTML = reports.map(r => {
        const isResolved = r.status === 'решено';
        const isInWork = r.status === 'в работе';
        const isAccepted = r.status === 'принято';
        const isPending = pendingActions.has(r.id);
        
        const statusConfig = {
            'решено': 'bg-green-100 text-green-700',
            'в работе': 'bg-blue-100 text-blue-700',
            'принято': 'bg-amber-100 text-amber-700'
        };

        return `
            <div class="card ${isResolved ? 'opacity-60 grayscale-[0.5]' : ''} ${isPending ? 'btn-loading' : ''}">
                ${r.priority > 1 ? `
                    <div class="absolute top-3 left-3 bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded shadow-lg animate-pulse z-10">
                        МАСШТАБНАЯ ПРОБЛЕМА (${r.priority})
                    </div>
                ` : ''}
                <img src="${r.image || '5e2c52e56b23aa47eae2c994ce951d6b220bb051.jpg'}" onerror="this.onerror=null; this.src='5e2c52e56b23aa47eae2c994ce951d6b220bb051.jpg'" alt="Problem" loading="lazy">
                <div class="card-footer">
                    <div class="flex justify-between items-start mb-2">
                        <span class="card-tag">${r.type}</span>
                        <span class="text-[9px] font-black px-2 py-1 rounded uppercase ${statusConfig[r.status] || 'bg-slate-100'}">${r.status}</span>
                    </div>
                    <div class="font-bold text-slate-800 line-clamp-2">${r.description}</div>
                    <div class="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        <span>📍</span> ${r.location}
                    </div>
                    <div class="text-[10px] text-slate-400 mt-1 italic">Служба: ${r.service || 'Ожидание...'}</div>
                    
                    ${isResolved && r.result_text ? `
                        <div class="mt-3 p-2 bg-green-50 border border-green-100 rounded text-[11px] text-green-800">
                            <strong>Результат:</strong> ${r.result_text}
                        </div>
                    ` : ''}

                    <div class="flex gap-2 mt-3">
                        <button onclick="openDiscussion(${r.id})" class="flex-1 py-1.5 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-200">ОБСУДИТЬ</button>
                        ${isAccepted ? `<button onclick="handleStatusUpdate(${r.id}, 'в работе')" class="flex-1 py-1.5 text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100" ${isPending ? 'disabled' : ''}>В РАБОТУ</button>` : ''}
                        ${(isAccepted || isInWork) ? `<button onclick="handleResolve(${r.id})" class="flex-1 py-1.5 text-[10px] font-bold bg-green-50 text-green-600 border border-green-200 rounded-lg hover:bg-green-100" ${isPending ? 'disabled' : ''}>РЕШЕНО</button>` : ''}
                    </div>
                </div>
                <button onclick="handleUpvote(${r.id})" class="upvote-btn ${localStorage.getItem('voted_'+r.id) ? 'voted' : ''} ${isPending ? 'pointer-events-none' : ''}">
                    <span>▲</span> ${r.upvotes || 0}
                </button>
            </div>
        `;
    }).join('');
}

async function handleStatusUpdate(id, status) {
    if (pendingActions.has(id)) return;
    
    const report = allReports.find(r => r.id === id);
    const oldStatus = report?.status;
    
    if (report) {
        report.status = status;
        pendingActions.add(id);
        applyFilters();
    }

    try {
        await api.updateStatus(id, status);
    } catch (e) {
        if (report) report.status = oldStatus;
        alert(e.message);
    } finally {
        pendingActions.delete(id);
        fetchData();
    }
}

async function handleResolve(id) {
    if (pendingActions.has(id)) return;
    
    const text = prompt('Результат решения:', 'Проблема устранена');
    if (text === null) return;

    const report = allReports.find(r => r.id === id);
    const oldStatus = report?.status;
    const oldResult = report?.result_text;

    if (report) {
        report.status = 'решено';
        report.result_text = text;
        pendingActions.add(id);
        applyFilters();
    }

    try {
        await api.resolve(id, text);
    } catch (e) {
        if (report) {
            report.status = oldStatus;
            report.result_text = oldResult;
        }
        alert(e.message);
    } finally {
        pendingActions.delete(id);
        fetchData();
    }
}

async function handleUpvote(id) {
    if (pendingActions.has(id)) return;
    
    const report = allReports.find(r => r.id === id);
    if (!report) return;

    const oldUpvotes = report.upvotes;
    report.upvotes++;
    pendingActions.add(id);
    applyFilters();

    try {
        const data = await api.upvote(id);
        report.upvotes = data.upvotes;
        localStorage.setItem('voted_'+id, 'true');
        applyFilters();
    } catch (e) {
        report.upvotes = oldUpvotes;
        applyFilters();
        alert(e.message);
    } finally {
        pendingActions.delete(id);
    }
}

async function openDiscussion(id) {
    currentDiscussionId = id;
    const report = allReports.find(r => r.id === id);
    document.getElementById('discussion-report-title').textContent = report?.description || '...';
    document.getElementById('discussion-modal').classList.remove('hidden');
    
    const comments = await api.getComments(id);
    renderComments(comments);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', reportId: id }));
    };
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'new_comment' && data.comment.report_id === id) {
            addCommentToUI(data.comment);
        }
    };
}

function closeDiscussion() {
    document.getElementById('discussion-modal').classList.add('hidden');
    currentDiscussionId = null;
    if (ws) {
        ws.close();
        ws = null;
    }
}

function renderComments(comments) {
    const list = document.getElementById('comments-list');
    list.innerHTML = comments.map(c => `
        <div class="bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div class="flex justify-between items-center mb-1">
                <span class="text-[10px] font-black text-green-600 uppercase">${c.nickname}</span>
                <span class="text-[9px] text-slate-400">${new Date(c.created_at).toLocaleTimeString()}</span>
            </div>
            <p class="text-sm text-slate-700">${c.text}</p>
        </div>
    `).join('');
    list.scrollTop = list.scrollHeight;
}

function addCommentToUI(c) {
    const list = document.getElementById('comments-list');
    const div = document.createElement('div');
    div.className = 'bg-slate-50 p-3 rounded-xl border border-slate-100 animate-fade-in';
    div.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] font-black text-green-600 uppercase">${c.nickname}</span>
            <span class="text-[9px] text-slate-400">${new Date(c.created_at).toLocaleTimeString()}</span>
        </div>
        <p class="text-sm text-slate-700">${c.text}</p>
    `;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

document.getElementById('comment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('comment-input');
    const text = input.value;
    if (!text || !currentDiscussionId) return;

    try {
        await api.postComment(currentDiscussionId, text);
        input.value = '';
    } catch (e) {
        alert(e.message);
    }
});

function filterByTag(tag) {
    currentTag = tag;
    document.querySelectorAll('.tag-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === tag);
    });
    const title = document.getElementById('category-title');
    if (title) title.textContent = tag === 'Все' ? 'Все события' : `Категория: ${tag}`;
    applyFilters();
}

function handleSearch() { applyFilters(); }

function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        selectedImageBase64 = e.target.result;
        const lbl = document.getElementById('file-label');
        lbl.textContent = 'Фото выбрано';
        lbl.classList.add('text-green-600', 'border-green-500');
    };
    reader.readAsDataURL(file);
}

document.getElementById('report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'ОТПРАВКА...';

    try {
        await api.createReport({
            type: document.getElementById('type').value,
            location: document.getElementById('location').value,
            description: document.getElementById('description').value,
            image: selectedImageBase64
        });
        closeModal();
        fetchData();
        e.target.reset();
        selectedImageBase64 = null;
        const lbl = document.getElementById('file-label');
        lbl.textContent = 'Выбрать фото';
        lbl.classList.remove('text-green-600', 'border-green-500');
    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'ОТПРАВИТЬ';
    }
});

function openModal() { document.getElementById('modal')?.classList.remove('hidden'); }
function closeModal() { document.getElementById('modal')?.classList.add('hidden'); }
window.addEventListener('keydown', (e) => e.key === 'Escape' && (closeModal() || closeDiscussion()));

initProfile();
fetchData();
