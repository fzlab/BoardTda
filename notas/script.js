class SupabaseNotesManager {
    constructor() {
        const SUPABASE_URL = 'https://mifbcyxtafeacwkzqzsq.supabase.co';
        const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_O6EAbkSba1NQPq08k_7bHg_PZ_x4ZU5';

        // 1. Intentar capturar el cliente de la ventana principal (si se abre en iframe) o crear uno compartido
        try {
            if (window.parent && window.parent.supabaseClient) {
                this.supabase = window.parent.supabaseClient;
            } else if (window.supabaseClient) {
                this.supabase = window.supabaseClient;
            } else if (window.supabase) {
                this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                    auth: { persistSession: true, autoRefreshToken: true }
                });
            }
        } catch (e) {
            console.warn("No se pudo enlazar con el padre, usando cliente local:", e);
        }

        if (!this.supabase && window.supabase) {
            this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true }
            });
        }

        this.userId = null;
    }

        async init() {
        if (!this.supabase) {
            throw new Error('Supabase no está disponible.');
        }

        // Usamos una pequeña promesa para asegurar que Supabase recuperó la sesión del almacenamiento
        const session = await new Promise(async (resolve) => {
            const { data: { session } } = await this.supabase.auth.getSession();
            if (session) {
                resolve(session);
                return;
            }

            // Si no hay sesión inmediata, esperamos al evento de cambio de estado o usamos getUser
            const { data: userData } = await this.supabase.auth.getUser();
            if (userData && userData.user) {
                resolve({ user: userData.user });
                return;
            }

            // Damos un pequeño margen por si el storage es lento (ej. PWA / Iframe)
            const { data: { subscription } } = this.supabase.auth.onAuthStateChange((event, session) => {
                if (session) {
                    subscription.unsubscribe();
                    resolve(session);
                }
            });

            // Timeout de seguridad de 2 segundos por si no hay sesión real
            setTimeout(() => {
                subscription?.unsubscribe();
                resolve(null);
            }, 2000);
        });

        if (!session || !session.user) {
            // Si de verdad no hay sesión en ningún lado, redirigir al login principal
            window.location.href = '../index.html'; 
            throw new Error('No hay una sesión activa');
        }

        this.userId = session.user.id;
        return session.user;
    }


    async getAll(storeName) {
        const { data, error } = await this.supabase
            .from(storeName)
            .select('*')
            .eq('user_id', this.userId);

        if (error) throw error;
        
        if (storeName === 'notes') {
            return data.map(n => ({
                id: n.id,
                title: n.title,
                body: n.content,
                pinned: n.is_pinned,
                folderId: n.folder_id,
                createdAt: n.created_at,
                updatedAt: n.updated_at
            }));
        } else if (storeName === 'folders') {
            return data.map(f => ({
                id: f.id,
                name: f.name,
                createdAt: f.created_at
            }));
        }
        return data;
    }

    async save(storeName, item) {
        if (storeName === 'notes') {
            const dbNote = {
                id: item.id,
                user_id: this.userId,
                title: item.title,
                content: item.body,
                is_pinned: item.pinned,
                folder_id: item.folderId || null,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await this.supabase
                .from('notes')
                .upsert(dbNote)
                .select()
                .single();

            if (error) throw error;
            return data;
        } else if (storeName === 'folders') {
            const dbFolder = {
                id: item.id,
                user_id: this.userId,
                name: item.name
            };

            const { data, error } = await this.supabase
                .from('folders')
                .upsert(dbFolder)
                .select()
                .single();

            if (error) throw error;
            return data;
        }
    }

    async delete(storeName, id) {
        const { error } = await this.supabase
            .from(storeName)
            .delete()
            .eq('id', id)
            .eq('user_id', this.userId);

        if (error) throw error;
    }
}
class LuminaNotes {
    constructor() {
        this.dbManager = new SupabaseNotesManager();
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
    // Método para guardar inmediatamente si hay un borrador pendiente en el editor
    async flushPendingSave() {
        if (this.saveTimeout && this.activeNoteId) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;

            const note = this.notes.find(n => n.id === this.activeNoteId);
            if (note) {
                note.title = this.titleInput.value;
                note.body = this.bodyInput.value;
                note.updatedAt = new Date().toISOString();

                try {
                    await this.dbManager.save('notes', note);
                } catch (error) {
                    console.error('Error al guardar antes de salir:', error);
                }
            }
        }
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
            console.error(error);
            this.showToast('Error al conectar con la base de datos');
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

        // --- CONTROL DE NAVEGACIÓN SEGURO ---

        // 1. Si el usuario oculta la pestaña, guardamos de inmediato lo que esté escribiendo
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flushPendingSave();
            }
        });

        // 2. Si el navegador restaura la página desde el caché (Bfcache) al usar el botón Atrás/Adelante
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                this.bootstrap();
            }
        });

        // 3. Forzar guardado antes de cerrar o cambiar de web
        window.addEventListener('beforeunload', () => {
            this.flushPendingSave();
        });
    }



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
            id: crypto.randomUUID ? crypto.randomUUID() : ('note_' + Date.now()),
            title: '',
            body: '',
            pinned: false,
            folderId: activeFolder,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            await this.dbManager.save('notes', newNote);
            this.notes.unshift(newNote);
            this.renderFolders();
            this.renderSidebar();
            this.selectNote(newNote.id, true);
            this.titleInput.focus();
            this.showToast('Nueva nota creada');
        } catch (error) {
            console.error(error);
            this.showToast('Error al crear nota');
        }
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
                            id: crypto.randomUUID ? crypto.randomUUID() : ('note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4)),
                            title: item.title || 'Imported Note',
                            body: item.body || '',
                            pinned: !!item.pinned,
                            folderId: activeFolder,
                            createdAt: item.createdAt || new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        };
                        await this.dbManager.save('notes', newNote);
                        this.notes.unshift(newNote);
                    }
                    this.showToast(`Importada(s) ${itemsToImport.length} nota(s)`);
                } else {
                    const fileTitle = file.name.replace(/\.[^/.]+$/, '');
                    const newNote = {
                        id: crypto.randomUUID ? crypto.randomUUID() : ('note_' + Date.now()),
                        title: fileTitle,
                        body: content,
                        pinned: false,
                        folderId: activeFolder,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    await this.dbManager.save('notes', newNote);
                    this.notes.unshift(newNote);
                    this.showToast('Nota importada correctamente');
                }

                this.renderFolders();
                this.renderSidebar();
                if (this.notes.length > 0) {
                    this.selectNote(this.notes[0].id, true);
                }
            } catch (error) {
                console.error(error);
                this.showToast('Error al importar archivo');
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

        this.updateSaveStatus('Guardando...');

        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            const note = this.notes.find(n => n.id === this.activeNoteId);
            if (note) {
                note.title = this.titleInput.value;
                note.body = this.bodyInput.value;
                note.updatedAt = new Date().toISOString();

                try {
                    await this.dbManager.save('notes', note);
                    this.renderSidebar();
                    this.updateMetaInfo(note);
                    this.updateSaveStatus('Guardado');
                } catch (error) {
                    console.error(error);
                    this.updateSaveStatus('Error al guardar');
                }
            }
        }, 600);
    }

    async togglePinActiveNote() {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (note) {
            note.pinned = !note.pinned;
            try {
                await this.dbManager.save('notes', note);
                this.updatePinButtonState(note.pinned);
                this.renderSidebar();
                this.showToast(note.pinned ? 'Nota marcada' : 'Se eliminó la marca');
            } catch (error) {
                console.error(error);
                this.showToast('Error al actualizar marca');
            }
        }
    }

    promptDeleteNote() {
        if (!this.activeNoteId) return;

        const deleteSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

        this.showModal({
            title: 'Borrar Nota',
            message: 'Seguro que quieres eliminar esta nota permanentemente?',
            iconSvg: deleteSvg,
            onConfirm: () => {
                this.deleteActiveNote();
            }
        });
    }

    async deleteActiveNote() {
        const targetId = this.activeNoteId;
        try {
            await this.dbManager.delete('notes', targetId);
            this.notes = this.notes.filter(n => n.id !== targetId);

            this.appContainer.classList.remove('show-editor');
            this.renderFolders();

            if (this.notes.length > 0) {
                this.selectNote(this.notes[0].id, false);
            } else {
                this.activeNoteId = null;
                this.updateEditorState();
                this.renderSidebar();
            }

            this.showToast('Nota eliminada');
        } catch (error) {
            console.error(error);
            this.showToast('Error al eliminar la nota');
        }
    }

    promptCreateFolder() {
        this.showInputModal({
            title: 'Crear nueva carpeta',
            placeholder: 'Nombre de la carpeta...',
            onConfirm: async (folderName) => {
                if (!folderName.trim()) return;

                const newFolder = {
                    id: crypto.randomUUID ? crypto.randomUUID() : ('folder_' + Date.now()),
                    name: folderName.trim(),
                    createdAt: new Date().toISOString()
                };

                try {
                    await this.dbManager.save('folders', newFolder);
                    this.folders.push(newFolder);
                    this.renderFolders();
                    if (this.activeNoteId) {
                        const note = this.notes.find(n => n.id === this.activeNoteId);
                        if (note) this.renderFolderDropdown(note.folderId);
                    }
                    this.showToast('Carpeta creada');
                } catch (error) {
                    console.error(error);
                    this.showToast('Error al crear la carpeta');
                }
            }
        });
    }

    promptDeleteFolder(folderId, folderName) {
        const deleteSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z"></path><line x1="9" y1="14" x2="15" y2="14"></line></svg>`;

        this.showModal({
            title: 'Borrar Carpeta',
            message: `Seguro que quieres borrar la carpeta "${folderName}"? Las notas en esta carpeta quedarán Sin Categoría.`,
            iconSvg: deleteSvg,
            onConfirm: async () => {
                try {
                    await this.dbManager.delete('folders', folderId);
                    this.folders = this.folders.filter(f => f.id !== folderId);

                    for (const note of this.notes) {
                        if (note.folderId === folderId) {
                            note.folderId = null;
                            await this.dbManager.save('notes', note);
                        }
                    }

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
                    this.showToast('Carpeta eliminada');
                } catch (error) {
                    console.error(error);
                    this.showToast('Error al eliminar la carpeta');
                }
            }
        });
    }

    async assignNoteFolder(folderId) {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (note) {
            note.folderId = folderId;
            try {
                await this.dbManager.save('notes', note);
                this.renderFolderDropdown(folderId);
                this.renderFolders();
                this.renderSidebar();
                this.showToast('Carpeta Actualizada');
            } catch (error) {
                console.error(error);
                this.showToast('Error al actualizar carpeta');
            }
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

        this.showToast('Nota exportada correctamente');
    }

    renderFolders() {
        this.foldersListEl.innerHTML = '';

        if (this.folders.length === 0) {
            this.foldersListEl.innerHTML = `<div style="padding: 6px 12px; font-size: 0.8rem; color: var(--text-muted);">No hay carpetas creadas</div>`;
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
            <span>Sin categoría</span>
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
        this.folderDropdownLabel.textContent = activeFolderObj ? activeFolderObj.name : 'Sin Categoría';
    }

    renderSidebar() {
        let filtered = this.notes.filter(note => {
            const matchesSearch = note.title.toLowerCase().includes(this.searchQuery) ||
                                  note.body.toLowerCase().includes(this.searchQuery);
            if (this.currentFilter === 'pinned') return note.pinned && matchesSearch;
            if (this.currentFilter !== 'all' && this.currentFilter !== 'pinned') {
                return note.folderId === this.currentFilter && matchesSearch;
            }
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
            this.notesListEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">No hay notas por aqui</div>`;
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

            const displayTitle = note.title.trim() || 'Sin Título';
            const displaySnippet = note.body.trim() || 'Sin texto...';
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
        this.noteDateEl.textContent = `Actualizado: ${this.formatDate(note.updatedAt)}`;

        const text = note.body.trim();
        const words = text ? text.split(/\s+/).length : 0;
        const chars = text.length;
        this.statsCounterEl.textContent = `${words} palabras, ${chars} caracteres`;
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
        return date.toLocaleDateString('es-MX', {
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
    window.app = new LuminaNotes();
});
