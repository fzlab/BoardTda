// Carga automática del SDK de Supabase si no está presente en el HTML
if (typeof supabase === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    document.head.appendChild(script);
}

class SupabaseManager {
    constructor() {
        this.supabaseUrl = 'https://mifbcyxtafeacwkzqzsq.supabase.co';
        this.supabaseKey = 'sb_publishable_O6EAbkSba1NQPq08k_7bHg_PZ_x4ZU5';
        this.client = null;
    }

    init() {
        if (window.supabase && !this.client) {
            // Configuramos el cliente indicándole que persista y comparta sesión
            this.client = window.supabase.createClient(this.supabaseUrl, this.supabaseKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });
        }
    }

    async getActiveUser() {
        this.init();
        if (!this.client) return null;

        try {
            // 1. Intentar obtener el usuario directamente del cliente local
            let { data: { user }, error } = await this.client.auth.getUser();
            if (user) return user;

            // 2. Si estamos dentro de un iframe y el padre (Hub) tiene sesión, intentamos sincronizarla
            if (window.parent && window.parent !== window && window.parent.supabase) {
                // Opcional: recuperar la sesión desde el LocalStorage del dominio principal si comparten origen
                const sessionData = localStorage.getItem('sb-mifbcyxtafeacwkzqzsq-auth-token');
                if (sessionData) {
                    const parsed = JSON.parse(sessionData);
                    if (parsed && parsed.access_token) {
                        await this.client.auth.setSession({
                            access_token: parsed.access_token,
                            refresh_token: parsed.refresh_token
                        });
                        const res = await this.client.auth.getUser();
                        if (res.data.user) return res.data.user;
                    }
                }
            }
            return null;
        } catch (e) {
            console.error('Error obteniendo usuario en SupabaseManager:', e);
            return null;
        }
    }

    async saveNote(note) {
        this.init();
        if (!this.client) {
            console.error('Supabase Client no inicializado');
            return;
        }

        try {
            const user = await this.getActiveUser();

            if (!user) {
                console.warn('Supabase Sync Abortada: No se detectó ningún usuario con sesión activa en la subweb de notas.');
                return;
            }

            const payload = {
                id: note.id,
                user_id: user.id,
                folder_id: note.folderId && note.folderId.startsWith('folder_') ? null : (note.folderId || null),
                title: note.title || '',
                content: note.body || '',
                is_pinned: !!note.pinned,
                created_at: note.createdAt,
                updated_at: note.updatedAt
            };

            const { data, error } = await this.client
                .from('notes')
                .upsert(payload, { onConflict: 'id' });

            if (error) {
                console.error('❌ Error de Supabase al guardar la nota:', error.message, error.details);
            } else {
                console.log('✅ Nota sincronizada exitosamente con Supabase:', note.id);
            }
        } catch (err) {
            console.error('Supabase save exception:', err);
        }
    }

    async deleteNote(id) {
        this.init();
        if (!this.client) return;

        try {
            const user = await this.getActiveUser();
            if (!user) {
                console.warn('Supabase Delete Abortada: Sin sesión activa.');
                return;
            }

            const { error } = await this.client
                .from('notes')
                .delete()
                .eq('id', id)
                .eq('user_id', user.id);

            if (error) {
                console.error('❌ Error eliminando nota de Supabase:', error.message);
            } else {
                console.log('🗑️ Nota eliminada de Supabase:', id);
            }
        } catch (err) {
            console.error('Supabase delete exception:', err);
        }
    }
}



class DatabaseManager {
    constructor() {
        this.dbName = 'FZNotasDB';
        this.version = 1;
        this.db = null;
        this.supabaseManager = new SupabaseManager();
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('notes')) {
                    const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
                    notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('folders')) {
                    db.createObjectStore('folders', { keyPath: 'id' });
                }
            };
        });
    }

    getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    save(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(item);
            
            request.onsuccess = () => {
                resolve(request.result);
                if (storeName === 'notes') {
                    this.supabaseManager.saveNote(item);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => {
                resolve();
                if (storeName === 'notes') {
                    this.supabaseManager.deleteNote(id);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

class FZNotas {
    constructor() {
        this.dbManager = new DatabaseManager();
        this.notes = [];
        this.folders = [];
        this.activeNoteId = null;
        this.currentFilter = 'all';
        this.currentSort = 'updated-desc';
        this.searchQuery = '';
        this.saveTimeout = null;

        this.initDOM();
        this.initCustomDropdowns();
        this.initEventListeners();
        this.bootstrap();
    }

    async bootstrap() {
        try {
            await this.dbManager.init();
            this.notes = await this.dbManager.getAll('notes');
            this.folders = await this.dbManager.getAll('folders');

            this.renderFolders();
            this.renderSidebar();

            if (this.notes.length > 0 && window.innerWidth > 768) {
                this.selectNote(this.notes[0].id, false);
            } else {
                this.updateEditorState();
            }
        } catch (error) {
            this.showToast('Failed to load database');
        }
    }

    initDOM() {
        this.appContainer = document.getElementById('app-container');
        this.notesListEl = document.getElementById('notes-list');
        this.foldersListEl = document.getElementById('folders-list');
        this.foldersHeader = document.getElementById('folders-header');
        this.foldersToggle = document.getElementById('folders-toggle');

        this.titleInput = document.getElementById('note-title');
        this.bodyInput = document.getElementById('note-body');
        this.noteDateEl = document.getElementById('note-date');
        this.statsCounterEl = document.getElementById('stats-counter');
        this.searchInput = document.getElementById('search-input');

        this.btnNew = document.getElementById('btn-new-note');
        this.btnEmptyNew = document.getElementById('btn-empty-new');
        this.btnImport = document.getElementById('btn-import');
        this.inputImportFile = document.getElementById('input-import-file');
        this.btnAddFolder = document.getElementById('btn-add-folder');
        this.btnBack = document.getElementById('btn-back');
        this.btnPin = document.getElementById('btn-pin');
        this.btnExport = document.getElementById('btn-export');
        this.btnDelete = document.getElementById('btn-delete');

        this.editorWrapper = document.getElementById('editor-wrapper');
        this.emptyState = document.getElementById('empty-state');

        this.countAllEl = document.getElementById('count-all');
        this.countPinnedEl = document.getElementById('count-pinned');

        this.modalOverlay = document.getElementById('custom-modal');
        this.modalIcon = document.getElementById('modal-icon-container');
        this.modalTitle = document.getElementById('modal-title');
        this.modalMessage = document.getElementById('modal-message');
        this.modalConfirmBtn = document.getElementById('modal-confirm-btn');
        this.modalCancelBtn = document.getElementById('modal-cancel-btn');

        this.inputModalOverlay = document.getElementById('custom-input-modal');
        this.inputModalField = document.getElementById('input-modal-field');
        this.inputModalConfirmBtn = document.getElementById('input-modal-confirm-btn');
        this.inputModalCancelBtn = document.getElementById('input-modal-cancel-btn');

        this.sortDropdownBtn = document.getElementById('sort-dropdown-btn');
        this.sortDropdownMenu = document.getElementById('sort-dropdown-menu');
        this.sortDropdownLabel = document.getElementById('sort-selected-label');

        this.folderDropdownBtn = document.getElementById('folder-dropdown-btn');
        this.folderDropdownMenu = document.getElementById('folder-dropdown-menu');
        this.folderDropdownLabel = document.getElementById('folder-selected-label');
    }

    initCustomDropdowns() {
        this.sortDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.folderDropdownMenu.classList.add('hidden');
            this.sortDropdownMenu.classList.toggle('hidden');
        });

        document.querySelectorAll('#sort-dropdown-menu .dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = item.dataset.value;
                const labelText = item.querySelector('span').textContent;

                document.querySelectorAll('#sort-dropdown-menu .dropdown-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                this.sortDropdownLabel.textContent = labelText;
                this.currentSort = val;
                this.sortDropdownMenu.classList.add('hidden');
                this.renderSidebar();
            });
        });

        this.folderDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sortDropdownMenu.classList.add('hidden');
            this.folderDropdownMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            this.sortDropdownMenu.classList.add('hidden');
            this.folderDropdownMenu.classList.add('hidden');
        });
    }

    initEventListeners() {
        this.btnNew.addEventListener('click', () => this.createNote());
        this.btnEmptyNew.addEventListener('click', () => this.createNote());
        this.btnImport.addEventListener('click', () => this.inputImportFile.click());
        this.inputImportFile.addEventListener('change', (e) => this.handleFileImport(e));
        this.btnAddFolder.addEventListener('click', () => this.promptCreateFolder());

        this.foldersToggle.addEventListener('click', () => {
            this.foldersHeader.classList.toggle('collapsed');
            this.foldersListEl.classList.toggle('collapsed');
        });

        this.btnBack.addEventListener('click', () => {
            this.appContainer.classList.remove('show-editor');
        });

        this.titleInput.addEventListener('input', () => this.handleEditorInput());
        this.bodyInput.addEventListener('input', () => this.handleEditorInput());

        this.btnPin.addEventListener('click', () => this.togglePinActiveNote());
        this.btnExport.addEventListener('click', () => this.exportActiveNote());
        this.btnDelete.addEventListener('click', () => this.promptDeleteNote());

        this.searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderSidebar();
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));

                const target = e.currentTarget;
                target.classList.add('active');
                this.currentFilter = target.dataset.filter;
                this.renderSidebar();
            });
        });

        this.modalCancelBtn.addEventListener('click', () => this.hideModal());
        this.inputModalCancelBtn.addEventListener('click', () => this.hideInputModal());
    }

    async createNote() {
        const activeFolder = this.currentFilter.startsWith('folder_') ? this.currentFilter : null;

        const newNote = {
            id: 'note_' + Date.now(),
            title: '',
            body: '',
            pinned: false,
            folderId: activeFolder,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.notes.unshift(newNote);
        await this.dbManager.save('notes', newNote);
        this.renderFolders();
        this.renderSidebar();
        this.selectNote(newNote.id, true);
        this.titleInput.focus();
        this.showToast('New note created');
    }

    async handleFileImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = event.target.result;
                const activeFolder = this.currentFilter.startsWith('folder_') ? this.currentFilter : null;

                if (file.name.endsWith('.json')) {
                    const parsed = JSON.parse(content);
                    const itemsToImport = Array.isArray(parsed) ? parsed : [parsed];

                    for (const item of itemsToImport) {
                        const newNote = {
                            id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                            title: item.title || 'Imported Note',
                            body: item.body || '',
                            pinned: !!item.pinned,
                            folderId: activeFolder,
                            createdAt: item.createdAt || new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        };
                        this.notes.unshift(newNote);
                        await this.dbManager.save('notes', newNote);
                    }
                    this.showToast(`Imported ${itemsToImport.length} note(s)`);
                } else {
                    const fileTitle = file.name.replace(/\.[^/.]+$/, '');
                    const newNote = {
                        id: 'note_' + Date.now(),
                        title: fileTitle,
                        body: content,
                        pinned: false,
                        folderId: activeFolder,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    this.notes.unshift(newNote);
                    await this.dbManager.save('notes', newNote);
                    this.showToast('Note imported successfully');
                }

                this.renderFolders();
                this.renderSidebar();
                if (this.notes.length > 0) {
                    this.selectNote(this.notes[0].id, true);
                }
            } catch (error) {
                this.showToast('Failed to import file');
            }
        };

        reader.readAsText(file);
        e.target.value = '';
    }

    selectNote(id, openEditorOnMobile = true) {
        this.activeNoteId = id;
        const note = this.notes.find(n => n.id === id);

        if (!note) {
            this.updateEditorState();
            return;
        }

        this.titleInput.value = note.title;
        this.bodyInput.value = note.body;
        this.updateMetaInfo(note);
        this.updatePinButtonState(note.pinned);
        this.renderFolderDropdown(note.folderId);
        this.updateEditorState();
        this.renderSidebar();

        if (openEditorOnMobile) {
            this.appContainer.classList.add('show-editor');
        }
    }

    handleEditorInput() {
        if (!this.activeNoteId) return;

        this.updateSaveStatus('Saving...');

        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            const note = this.notes.find(n => n.id === this.activeNoteId);
            if (note) {
                note.title = this.titleInput.value;
                note.body = this.bodyInput.value;
                note.updatedAt = new Date().toISOString();

                await this.dbManager.save('notes', note);
                this.renderSidebar();
                this.updateMetaInfo(note);
                this.updateSaveStatus('Saved');
            }
        }, 400);
    }

    async togglePinActiveNote() {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (note) {
            note.pinned = !note.pinned;
            await this.dbManager.save('notes', note);
            this.updatePinButtonState(note.pinned);
            this.renderSidebar();
            this.showToast(note.pinned ? 'Note pinned' : 'Note unpinned');
        }
    }

    promptDeleteNote() {
        if (!this.activeNoteId) return;

        const deleteSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

        this.showModal({
            title: 'Delete Note',
            message: 'Are you sure you want to delete this note permanently?',
            iconSvg: deleteSvg,
            onConfirm: () => {
                this.deleteActiveNote();
            }
        });
    }

    async deleteActiveNote() {
        const targetId = this.activeNoteId;
        this.notes = this.notes.filter(n => n.id !== targetId);
        await this.dbManager.delete('notes', targetId);

        this.appContainer.classList.remove('show-editor');
        this.renderFolders();

        if (this.notes.length > 0) {
            this.selectNote(this.notes[0].id, false);
        } else {
            this.activeNoteId = null;
            this.updateEditorState();
            this.renderSidebar();
        }

        this.showToast('Note deleted successfully');
    }

    promptCreateFolder() {
        this.showInputModal({
            title: 'Create New Folder',
            placeholder: 'Folder name...',
            onConfirm: async (folderName) => {
                if (!folderName.trim()) return;

                const newFolder = {
                    id: 'folder_' + Date.now(),
                    name: folderName.trim(),
                    createdAt: new Date().toISOString()
                };

                this.folders.push(newFolder);
                await this.dbManager.save('folders', newFolder);
                this.renderFolders();
                if (this.activeNoteId) {
                    const note = this.notes.find(n => n.id === this.activeNoteId);
                    if (note) this.renderFolderDropdown(note.folderId);
                }
                this.showToast('Folder created');
            }
        });
    }

    promptDeleteFolder(folderId, folderName) {
        const deleteSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"></path><line x1="9" y1="14" x2="15" y2="14"></line></svg>`;

        this.showModal({
            title: 'Delete Folder',
            message: `Are you sure you want to delete "${folderName}"? Notes in this folder will become uncategorized.`,
            iconSvg: deleteSvg,
            onConfirm: async () => {
                this.folders = this.folders.filter(f => f.id !== folderId);
                await this.dbManager.delete('folders', folderId);

                this.notes.forEach(async (note) => {
                    if (note.folderId === folderId) {
                        note.folderId = null;
                        await this.dbManager.save('notes', note);
                    }
                });

                if (this.currentFilter === folderId) {
                    this.currentFilter = 'all';
                    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
                }

                this.renderFolders();
                this.renderSidebar();
                if (this.activeNoteId) {
                    const note = this.notes.find(n => n.id === this.activeNoteId);
                    if (note) this.renderFolderDropdown(note.folderId);
                }
                this.showToast('Folder deleted');
            }
        });
    }

    async assignNoteFolder(folderId) {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (note) {
            note.folderId = folderId;
            await this.dbManager.save('notes', note);
            this.renderFolderDropdown(folderId);
            this.renderFolders();
            this.renderSidebar();
            this.showToast('Folder updated');
        }
    }

    exportActiveNote() {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (!note) return;

        const filename = (note.title.trim() || 'untitled-note') + '.txt';
        const content = `${note.title}\n${'='.repeat(note.title.length)}\n\n${note.body}`;

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);

        this.showToast('Note exported successfully');
    }

    renderFolders() {
        this.foldersListEl.innerHTML = '';

        if (this.folders.length === 0) {
            this.foldersListEl.innerHTML = `<div style="padding: 6px 12px; font-size: 0.8rem; color: var(--text-muted);">No folders created</div>`;
            return;
        }

        this.folders.forEach(folder => {
            const count = this.notes.filter(n => n.folderId === folder.id).length;
            const item = document.createElement('div');
            item.className = `folder-item ${this.currentFilter === folder.id ? 'active' : ''}`;

            item.innerHTML = `
                <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <span class="folder-name">${this.escapeHTML(folder.name)}</span>
                <span class="badge">${count}</span>
                <button class="btn-delete-folder" title="Delete Folder">
                    <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-folder')) return;
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
                item.classList.add('active');
                this.currentFilter = folder.id;
                this.renderSidebar();
            });

            item.querySelector('.btn-delete-folder').addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptDeleteFolder(folder.id, folder.name);
            });

            this.foldersListEl.appendChild(item);
        });
    }

    renderFolderDropdown(currentFolderId) {
        this.folderDropdownMenu.innerHTML = '';

        const uncategorizedItem = document.createElement('div');
        uncategorizedItem.className = `dropdown-item ${!currentFolderId ? 'active' : ''}`;
        uncategorizedItem.innerHTML = `
            <svg class="icon-sm check-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Uncategorized</span>
        `;
        uncategorizedItem.addEventListener('click', () => {
            this.assignNoteFolder(null);
            this.folderDropdownMenu.classList.add('hidden');
        });
        this.folderDropdownMenu.appendChild(uncategorizedItem);

        this.folders.forEach(folder => {
            const item = document.createElement('div');
            item.className = `dropdown-item ${currentFolderId === folder.id ? 'active' : ''}`;
            item.innerHTML = `
                <svg class="icon-sm check-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>${this.escapeHTML(folder.name)}</span>
            `;
            item.addEventListener('click', () => {
                this.assignNoteFolder(folder.id);
                this.folderDropdownMenu.classList.add('hidden');
            });
            this.folderDropdownMenu.appendChild(item);
        });

        const activeFolderObj = this.folders.find(f => f.id === currentFolderId);
        this.folderDropdownLabel.textContent = activeFolderObj ? activeFolderObj.name : 'Uncategorized';
    }

    renderSidebar() {
        let filtered = this.notes.filter(note => {
            const matchesSearch = note.title.toLowerCase().includes(this.searchQuery) ||
                                  note.body.toLowerCase().includes(this.searchQuery);
            if (this.currentFilter === 'pinned') return note.pinned && matchesSearch;
            if (this.currentFilter.startsWith('folder_')) return note.folderId === this.currentFilter && matchesSearch;
            return matchesSearch;
        });

        filtered.sort((a, b) => {
            if (this.currentSort === 'updated-desc') return new Date(b.updatedAt) - new Date(a.updatedAt);
            if (this.currentSort === 'updated-asc') return new Date(a.updatedAt) - new Date(b.updatedAt);
            if (this.currentSort === 'title-asc') return a.title.localeCompare(b.title);
            return 0;
        });

        this.countAllEl.textContent = this.notes.length;
        this.countPinnedEl.textContent = this.notes.filter(n => n.pinned).length;

        this.notesListEl.innerHTML = '';

        if (filtered.length === 0) {
            this.notesListEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">No notes found</div>`;
            return;
        }

        filtered.forEach(note => {
            const item = document.createElement('div');
            item.className = `note-item ${note.id === this.activeNoteId ? 'active' : ''}`;

            const pinIconHtml = note.pinned ? `
                <svg class="note-item-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="17" x2="12" y2="22"></line>
                    <path d="M5 17h14l-1.5-6h-11z"></path>
                    <path d="M9 11V4a3 3 0 0 1 6 0v7"></path>
                </svg>` : '';

            const displayTitle = note.title.trim() || 'Untitled Note';
            const displaySnippet = note.body.trim() || 'No additional text...';
            const formattedDate = this.formatDate(note.updatedAt);

            item.innerHTML = `
                <div class="note-item-header">
                    <div class="note-item-title">${this.escapeHTML(displayTitle)}</div>
                    ${pinIconHtml}
                </div>
                <div class="note-item-snippet">${this.escapeHTML(displaySnippet)}</div>
                <div class="note-item-date">${formattedDate}</div>
            `;

            item.addEventListener('click', () => this.selectNote(note.id, true));
            this.notesListEl.appendChild(item);
        });
    }

    updateEditorState() {
        if (!this.activeNoteId) {
            this.editorWrapper.classList.add('hidden');
            this.emptyState.classList.remove('hidden');
        } else {
            this.editorWrapper.classList.remove('hidden');
            this.emptyState.classList.add('hidden');
        }
    }

    updateMetaInfo(note) {
        this.noteDateEl.textContent = `Updated: ${this.formatDate(note.updatedAt)}`;

        const text = note.body.trim();
        const words = text ? text.split(/\s+/).length : 0;
        const chars = text.length;
        this.statsCounterEl.textContent = `${words} words, ${chars} characters`;
    }

    updatePinButtonState(isPinned) {
        if (isPinned) {
            this.btnPin.classList.add('active');
        } else {
            this.btnPin.classList.remove('active');
        }
    }

    updateSaveStatus(text) {
        document.getElementById('status-text').textContent = text;
    }

    showModal({ title, message, iconSvg, onConfirm }) {
        this.modalTitle.textContent = title;
        this.modalMessage.textContent = message;
        this.modalIcon.innerHTML = iconSvg;
        this.modalOverlay.classList.remove('hidden');

        this.modalConfirmBtn.onclick = () => {
            onConfirm();
            this.hideModal();
        };
    }

    hideModal() {
        this.modalOverlay.classList.add('hidden');
    }

    showInputModal({ title, placeholder, onConfirm }) {
        document.getElementById('input-modal-title').textContent = title;
        this.inputModalField.placeholder = placeholder;
        this.inputModalField.value = '';
        this.inputModalOverlay.classList.remove('hidden');
        this.inputModalField.focus();

        this.inputModalConfirmBtn.onclick = () => {
            onConfirm(this.inputModalField.value);
            this.hideInputModal();
        };
    }

    hideInputModal() {
        this.inputModalOverlay.classList.add('hidden');
    }

    showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';

        const checkSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        toast.innerHTML = `${checkSvg} <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.2s ease-out';
            setTimeout(() => toast.remove(), 200);
        }, 2500);
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new FZNotas();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js');
    }
});
