(function () {
    'use strict';

    const API = '/api/mockup-studio';
    const SIZE = 2000;
    const PRODUCT_TYPES = ['product_box_clean', 'product_only_clean'];
    const state = {
        initialized: false,
        view: 'templates',
        templates: [],
        products: [],
        outputs: [],
        editor: null,
        stage: null,
        contentLayer: null,
        uiLayer: null,
        transformer: null,
        baseRect: null,
        nodes: new Map(),
        selectedLayerId: null,
        selectedLayerIds: new Set(),
        selectedAssetId: null,
        selectedTemplateIds: new Set(),
        scale: 1,
        history: { undo: [], redo: [] },
        dragLayerId: null,
        createVersions: [],
        createVersionId: null,
        createProductId: null,
        busy: false
    };

    function uid() {
        return window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : 'ms-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function assetUrl(path) { return API + '?asset=' + encodeURIComponent(path); }
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function formatDate(value) {
        try { return value ? new Date(value).toLocaleString('tr-TR') : ''; }
        catch (error) { return String(value || ''); }
    }
    function safeName(value) {
        return String(value || 'mockup').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'mockup';
    }

    function blankDocument() {
        return { schemaVersion: 2, canvas: { width: SIZE, height: SIZE }, assets: [], layers: [] };
    }

    function blankEditor() {
        return {
            id: uid(), name: 'Yeni Mockup Şablonu', currentVersion: 0,
            persisted: false, document: blankDocument()
        };
    }

    function normalizeAsset(raw) {
        return {
            id: raw.id,
            type: raw.type || raw.asset_type,
            name: raw.name || raw.original_filename || 'Görsel',
            storagePath: raw.storagePath || raw.storage_path,
            mimeType: raw.mimeType || raw.mime_type,
            width: raw.width || null,
            height: raw.height || null
        };
    }

    function normalizeDocument(raw) {
        const doc = clone(raw || blankDocument());
        doc.schemaVersion = 2;
        doc.canvas = { width: SIZE, height: SIZE };
        doc.assets = (doc.assets || []).map(normalizeAsset);
        doc.layers = (doc.layers || []).map((layer) => {
            if (layer.type === 'scene') layer.type = 'scene_background';
            if (layer.type === 'slot') layer.type = 'product_slot';
            if (!layer.frame && layer.slot) layer.frame = layer.slot;
            layer.frame = Object.assign(defaultFrame(), layer.frame || {});
            layer.visible = layer.visible !== false;
            layer.locked = Boolean(layer.locked);
            return layer;
        });
        return doc;
    }

    function defaultFrame() {
        return {
            x: 1000, y: 1000, width: 700, height: 700, rotation: 0,
            opacity: 1, blur: 0,
            shadow: { enabled: false, color: '#000000', opacity: 0.35, blur: 24, offsetX: 12, offsetY: 18 }
        };
    }

    function setStatus(message, error) {
        const el = document.getElementById('mockupStatus');
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-error', Boolean(error));
        el.classList.toggle('is-visible', Boolean(message));
        window.clearTimeout(setStatus.timer);
        if (message && !error) setStatus.timer = window.setTimeout(() => el.classList.remove('is-visible'), 3500);
    }

    function setBusy(value) {
        state.busy = value;
        const root = document.getElementById('mockupStudioRoot');
        if (root) root.classList.toggle('ms-busy', value);
    }

    async function api(url, options) {
        const response = await fetch(url, options);
        const type = response.headers.get('content-type') || '';
        const body = type.includes('application/json') ? await response.json() : await response.text();
        if (!response.ok) {
            const message = body && body.error ? body.error : String(body || response.status);
            console.error('[Mockup Studio API]', { status: response.status, path: String(url).split('?')[0], message });
            const error = new Error(message);
            error.status = response.status;
            error.payload = body;
            throw error;
        }
        return body;
    }

    function renderShell() {
        document.getElementById('mockupStudioRoot').innerHTML = `
            <div id="mockupStatus" class="ms-status" role="status"></div>
            <nav class="ms-workspace-nav">
                <button data-view="templates" class="ms-workspace-tab is-active">Şablonlar</button>
                <button data-view="editor" class="ms-workspace-tab">Şablon Editörü</button>
                <button data-view="create" class="ms-workspace-tab">Ürünle Oluştur</button>
                <button data-view="outputs" class="ms-workspace-tab">Çıktılar</button>
            </nav>

            <section id="msViewTemplates" class="ms-view"></section>

            <section id="msViewEditor" class="ms-view" hidden>
                <div class="ms-toolbar">
                    <input id="msEditorName" class="fin-input ms-name" maxlength="120" aria-label="Şablon adı">
                    <button id="msUndoBtn" class="ms-btn">↶ Geri Al</button>
                    <button id="msRedoBtn" class="ms-btn">↷ Yinele</button>
                    <button id="msSaveBtn" class="ms-btn ms-btn-primary">Sürüm Kaydet</button>
                    <span id="msVersionBadge" class="ms-version-badge">Kaydedilmedi</span>
                </div>
                <div class="ms-layout">
                    <aside class="ms-panel">
                        <div class="ms-panel-title">Varlıklar ve Katmanlar</div>
                        <div class="ms-panel-body">
                            <div class="ms-section ms-section-first">
                                <label class="ms-upload-label">Boş sahne yükle<input id="msSceneInput" type="file" accept="image/png,image/jpeg,image/webp"></label>
                                <label class="ms-upload-label">Foreground mask PNG yükle<input id="msMaskInput" type="file" accept="image/png"></label>
                                <label class="ms-upload-label">Grafik/PNG yükle<input id="msGraphicInput" type="file" accept="image/png,image/jpeg,image/webp"></label>
                            </div>
                            <div class="ms-section">
                                <h4>ÜRÜN ÖNİZLEMESİ</h4>
                                <select id="msEditorProductType" class="ms-select">
                                    <option value="product_box_clean">Ürün + gerçek kutusu</option>
                                    <option value="product_only_clean">Kutusuz ürün</option>
                                    <option value="original_photo">Orijinal kaynak</option>
                                </select>
                                <label class="ms-upload-label">Ürün dosyası yükle<input id="msEditorProductInput" type="file" accept="image/png,image/jpeg"></label>
                                <div id="msEditorAssetList" class="ms-asset-list"></div>
                                <button id="msNewSlotBtn" class="ms-btn ms-full">+ Yeni ürün slotu</button>
                                <button id="msAddSlotBtn" class="ms-btn ms-btn-primary ms-full" disabled>Seçili ürünü seçili slotlara yerleştir</button>
                                <small class="ms-help">Bir veya daha fazla slot katmanına tıklayıp ürünü hepsine bağlayın.</small>
                            </div>
                            <div class="ms-section">
                                <div class="ms-inline ms-between"><h4>KATMANLAR</h4><small>Sürükleyerek sırala</small></div>
                                <div id="msLayerList" class="ms-layer-list"></div>
                            </div>
                        </div>
                    </aside>
                    <main class="ms-panel ms-canvas-panel">
                        <div class="ms-panel-title"><span>2000×2000 Tuval</span><span id="msZoom">%100</span></div>
                        <div id="msCanvasWrap" class="ms-canvas-wrap"><div id="mockupCanvasHost"></div></div>
                        <div class="ms-canvas-footer"><span>Sürükle • ölçekle • döndür</span><span>Kaynak PNG korunur</span></div>
                    </main>
                    <aside class="ms-panel ms-inspector-panel">
                        <div class="ms-panel-title">Katman Ayarları</div>
                        <div id="msInspector" class="ms-panel-body"></div>
                    </aside>
                </div>
            </section>

            <section id="msViewCreate" class="ms-view" hidden></section>
            <section id="msViewOutputs" class="ms-view" hidden></section>
            <div id="msRenderHost" style="position:fixed; left:-10000px; top:0; width:2000px; height:2000px;"></div>
        `;
    }

    function bindShell() {
        document.querySelectorAll('.ms-workspace-tab').forEach((button) => {
            button.addEventListener('click', () => showView(button.dataset.view));
        });
        document.getElementById('msEditorName').addEventListener('change', (event) => {
            const before = editorSnapshot();
            state.editor.name = event.target.value.trim() || 'Yeni Mockup Şablonu';
            event.target.value = state.editor.name;
            recordHistory(before);
        });
        document.getElementById('msUndoBtn').addEventListener('click', undo);
        document.getElementById('msRedoBtn').addEventListener('click', redo);
        document.getElementById('msSaveBtn').addEventListener('click', saveEditor);
        document.getElementById('msSceneInput').addEventListener('change', (e) => editorUpload(e, 'scene_background'));
        document.getElementById('msMaskInput').addEventListener('change', (e) => editorUpload(e, 'foreground_mask'));
        document.getElementById('msGraphicInput').addEventListener('change', (e) => editorUpload(e, 'optional_graphic'));
        document.getElementById('msEditorProductInput').addEventListener('change', editorProductUpload);
        document.getElementById('msNewSlotBtn').addEventListener('click', () => addProductSlot());
        document.getElementById('msAddSlotBtn').addEventListener('click', bindProductToSelectedSlots);
        window.addEventListener('resize', resizeStage);
        document.addEventListener('keydown', handleKeyboard);
    }

    function installTabHook() {
        const original = window.switchAiTab;
        if (typeof original !== 'function' || original.__mockupWrapped) return;
        const wrapped = function (tab) {
            const section = document.getElementById('mockupStudioSection');
            const button = document.getElementById('tabMockupStudio');
            if (tab === 'mockup') {
                document.getElementById('aiNewSection').style.display = 'none';
                document.getElementById('aiHistorySection').style.display = 'none';
                document.getElementById('tabAiNew').style.background = '#f0f4f8';
                document.getElementById('tabAiNew').style.color = '#333';
                document.getElementById('tabAiHistory').style.background = '#f0f4f8';
                document.getElementById('tabAiHistory').style.color = '#333';
                section.style.display = 'block';
                button.style.background = '#8e44ad';
                button.style.color = '#fff';
                init();
                window.setTimeout(resizeStage, 0);
                return;
            }
            section.style.display = 'none';
            button.style.background = '#f0f4f8';
            button.style.color = '#333';
            return original.call(this, tab);
        };
        wrapped.__mockupWrapped = true;
        window.switchAiTab = wrapped;
    }

    async function init() {
        if (state.initialized) return;
        state.initialized = true;
        renderShell();
        bindShell();
        if (!window.Konva) {
            setStatus('Konva.js yüklenemedi.', true);
            return;
        }
        createStage();
        newEditor(false);
        await loadTemplates();
        await loadProducts();
        await loadOutputs();
        showView('templates');
    }

    function showView(view) {
        state.view = view;
        document.querySelectorAll('.ms-workspace-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
        ['templates', 'editor', 'create', 'outputs'].forEach((name) => {
            document.getElementById('msView' + name[0].toUpperCase() + name.slice(1)).hidden = name !== view;
        });
        if (view === 'templates') renderTemplateLibrary();
        if (view === 'editor') { renderEditor(); window.setTimeout(resizeStage, 0); }
        if (view === 'create') renderCreateView();
        if (view === 'outputs') renderOutputs();
    }

    async function loadTemplates() {
        try {
            const data = await api(API + '?resource=templates');
            state.templates = data.templates || [];
            const available = new Set(state.templates.map((template) => template.id));
            state.selectedTemplateIds = new Set([...state.selectedTemplateIds].filter((id) => available.has(id)));
        } catch (error) { setStatus('Şablonlar alınamadı: ' + error.message, true); }
        renderTemplateLibrary();
    }

    async function loadProducts() {
        try {
            const data = await api(API + '?resource=products');
            state.products = (data.products || []).map(normalizeAsset);
            if (!state.createProductId) {
                const preferred = state.products.find((a) => a.type === 'product_box_clean') || state.products.find((a) => PRODUCT_TYPES.includes(a.type));
                state.createProductId = preferred ? preferred.id : null;
            }
        } catch (error) { setStatus('Ürün varlıkları alınamadı: ' + error.message, true); }
    }

    async function loadOutputs() {
        try {
            const data = await api(API + '?resource=outputs');
            state.outputs = data.outputs || [];
        } catch (error) { setStatus('Çıktılar alınamadı: ' + error.message, true); }
        renderOutputs();
    }

    function renderTemplateLibrary() {
        const root = document.getElementById('msViewTemplates');
        if (!root) return;
        root.innerHTML = `
            <div class="ms-view-header"><div><h3>Şablonlar</h3><p>Kartlara tıklayarak bir veya daha fazla şablon seçin.</p></div><div class="ms-template-header-actions"><span id="msTemplateSelectionCount" class="ms-selection-count">${state.selectedTemplateIds.size} seçili</span><button id="msNewTemplateBtn" class="ms-btn ms-btn-primary">+ Yeni Şablon</button></div></div>
            <div class="ms-card-grid" id="msTemplateGrid"></div>`;
        document.getElementById('msNewTemplateBtn').addEventListener('click', () => { newEditor(true); });
        const grid = document.getElementById('msTemplateGrid');
        if (!state.templates.length) {
            grid.innerHTML = '<div class="ms-empty-card">Henüz kayıtlı şablon yok.</div>';
            return;
        }
        state.templates.forEach((template) => {
            const card = document.createElement('article');
            const selected = state.selectedTemplateIds.has(template.id);
            card.className = 'ms-library-card ms-template-card' + (selected ? ' is-selected' : '');
            card.tabIndex = 0;
            card.setAttribute('role', 'checkbox');
            card.setAttribute('aria-checked', String(selected));
            const preview = template.thumbnail_path
                ? `<img src="${assetUrl(template.thumbnail_path)}" alt="${esc(template.name)} önizlemesi">`
                : '<div class="ms-card-placeholder">2000×2000</div>';
            card.innerHTML = `
                <div class="ms-card-preview">${preview}<span class="ms-template-check" aria-hidden="true">${selected ? '✓' : '+'}</span></div>
                <div class="ms-card-content"><h4>${esc(template.name)}</h4>
                <p>v${template.current_version} • ${template.layer_count} katman • ${template.slot_count} slot</p>
                <p>${esc(formatDate(template.updated_at))}</p>
                <div class="ms-card-actions">
                    <button data-action="open" class="ms-btn ms-btn-primary ms-btn-small">Aç/Düzenle</button>
                    <button data-action="duplicate" class="ms-btn ms-btn-small">Çoğalt</button>
                    <button data-action="rename" class="ms-btn ms-btn-small">Adlandır</button>
                    <button data-action="delete" class="ms-btn ms-btn-danger ms-btn-small">Sil</button>
                </div></div>`;
            const toggle = () => toggleTemplateSelection(template.id);
            card.addEventListener('click', (event) => { if (!event.target.closest('.ms-card-actions')) toggle(); });
            card.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.ms-card-actions')) { event.preventDefault(); toggle(); } });
            card.querySelector('[data-action="open"]').addEventListener('click', (event) => { event.stopPropagation(); openTemplate(template.id); });
            card.querySelector('[data-action="duplicate"]').addEventListener('click', (event) => { event.stopPropagation(); duplicateTemplate(template); });
            card.querySelector('[data-action="rename"]').addEventListener('click', (event) => { event.stopPropagation(); renameTemplate(template); });
            card.querySelector('[data-action="delete"]').addEventListener('click', (event) => { event.stopPropagation(); deleteTemplate(template); });
            grid.appendChild(card);
        });
    }

    function toggleTemplateSelection(id) {
        if (state.selectedTemplateIds.has(id)) state.selectedTemplateIds.delete(id);
        else state.selectedTemplateIds.add(id);
        renderTemplateLibrary();
    }

    function newEditor(openView) {
        state.editor = blankEditor();
        state.selectedLayerId = null;
        state.selectedLayerIds = new Set();
        state.selectedAssetId = null;
        resetHistory();
        clearCanvas();
        renderEditor();
        if (openView) showView('editor');
    }

    async function openTemplate(id) {
        setBusy(true);
        try {
            const data = await api(API + '?resource=template&id=' + encodeURIComponent(id));
            const item = data.template;
            state.editor = {
                id: item.id, name: item.name, currentVersion: item.current_version,
                persisted: true, document: normalizeDocument(item.document)
            };
            state.selectedLayerId = null;
            state.selectedLayerIds = new Set();
            state.selectedAssetId = preferredEditorProduct() ? preferredEditorProduct().id : null;
            resetHistory();
            await rebuildCanvas();
            showView('editor');
            setStatus('Şablon açıldı.', false);
        } catch (error) { setStatus('Şablon açılamadı: ' + error.message, true); }
        finally { setBusy(false); }
    }

    async function duplicateTemplate(template) {
        const name = window.prompt('Yeni bağımsız şablonun adı:', template.name + ' Kopya');
        if (name === null) return;
        if (!name.trim()) return setStatus('Şablon adı zorunludur.', true);
        setBusy(true);
        try {
            const data = await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'duplicate_template', id: template.id, name: name.trim() }) });
            await loadTemplates();
            if (data.template) await openTemplate(data.template.id);
        } catch (error) { setStatus('Şablon çoğaltılamadı: ' + error.message, true); }
        finally { setBusy(false); }
    }

    async function renameTemplate(template) {
        const name = window.prompt('Şablonun yeni adı:', template.name);
        if (name === null) return;
        if (!name.trim()) return setStatus('Şablon adı zorunludur.', true);
        try {
            await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename_template', id: template.id, name: name.trim() }) });
            await loadTemplates();
        } catch (error) { setStatus('Şablon yeniden adlandırılamadı: ' + error.message, true); }
    }

    async function deleteTemplate(template) {
        if (!window.confirm('“' + template.name + '” şablonu kütüphaneden kaldırılsın mı? Storage dosyaları ve eski çıktılar korunacaktır.')) return;
        try {
            await api(API + '?resource=template&id=' + encodeURIComponent(template.id), { method: 'DELETE' });
            await loadTemplates();
            setStatus('Şablon yumuşak silindi; çıktılar ve dosyalar korundu.', false);
        } catch (error) { setStatus('Şablon silinemedi: ' + error.message, true); }
    }

    function renderEditor() {
        if (!state.editor) return;
        const name = document.getElementById('msEditorName');
        if (!name) return;
        name.value = state.editor.name;
        document.getElementById('msVersionBadge').textContent = state.editor.persisted ? 'Kayıtlı v' + state.editor.currentVersion : 'Kaydedilmedi';
        renderEditorAssets();
        renderLayers();
        renderInspector();
        updateHistoryButtons();
    }

    function editorSnapshot() {
        return JSON.stringify({ name: state.editor.name, document: state.editor.document });
    }

    function recordHistory(before) {
        const after = editorSnapshot();
        if (!before || before === after) return;
        state.history.undo.push(before);
        if (state.history.undo.length > 50) state.history.undo.shift();
        state.history.redo = [];
        updateHistoryButtons();
    }

    function resetHistory() { state.history = { undo: [], redo: [] }; updateHistoryButtons(); }
    async function applyHistorySnapshot(raw) {
        const parsed = JSON.parse(raw);
        state.editor.name = parsed.name;
        state.editor.document = normalizeDocument(parsed.document);
        state.selectedLayerId = state.editor.document.layers.some((l) => l.id === state.selectedLayerId) ? state.selectedLayerId : null;
        state.selectedLayerIds = new Set([...state.selectedLayerIds].filter((id) => state.editor.document.layers.some((layer) => layer.id === id)));
        await rebuildCanvas();
        renderEditor();
    }
    async function undo() {
        if (!state.history.undo.length) return;
        state.history.redo.push(editorSnapshot());
        await applyHistorySnapshot(state.history.undo.pop());
        updateHistoryButtons();
    }
    async function redo() {
        if (!state.history.redo.length) return;
        state.history.undo.push(editorSnapshot());
        await applyHistorySnapshot(state.history.redo.pop());
        updateHistoryButtons();
    }
    function updateHistoryButtons() {
        const undoBtn = document.getElementById('msUndoBtn');
        const redoBtn = document.getElementById('msRedoBtn');
        if (undoBtn) undoBtn.disabled = !state.history.undo.length;
        if (redoBtn) redoBtn.disabled = !state.history.redo.length;
    }
    function handleKeyboard(event) {
        if (state.view !== 'editor' || !document.getElementById('mockupStudioSection') || document.getElementById('mockupStudioSection').style.display === 'none') return;
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && event.shiftKey) { event.preventDefault(); redo(); }
        else if (key === 'z') { event.preventDefault(); undo(); }
        else if (key === 'y') { event.preventDefault(); redo(); }
    }

    async function saveEditor() {
        state.editor.name = document.getElementById('msEditorName').value.trim();
        if (!state.editor.name) return setStatus('Şablon adı zorunludur.', true);
        setBusy(true);
        try {
            const data = await api(API, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_template', id: state.editor.id, name: state.editor.name, document: state.editor.document })
            });
            state.editor.persisted = true;
            state.editor.currentVersion = data.template.current_version;
            state.selectedTemplateIds.add(state.editor.id);
            await saveThumbnail();
            await loadTemplates();
            renderEditor();
            setStatus('Şablon v' + state.editor.currentVersion + ' olarak kaydedildi.', false);
        } catch (error) { setStatus('Şablon kaydedilemedi: ' + error.message, true); }
        finally { setBusy(false); }
    }

    async function saveThumbnail() {
        const blob = await exportEditorBlob(400);
        if (!blob) return;
        const asset = await uploadBlob(blob, 'template_thumbnail', state.editor.name + '-thumbnail.png', state.editor.id, 'image/png');
        if (!asset) return;
        await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_thumbnail', id: state.editor.id, asset_id: asset.id }) });
    }

    async function editorUpload(event, type) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        if (type === 'foreground_mask' && file.type !== 'image/png') return setStatus('Foreground mask şeffaf PNG olmalıdır.', true);
        const before = editorSnapshot();
        const asset = await uploadFile(file, type, state.editor.persisted ? state.editor.id : null);
        if (!asset) return;
        state.editor.document.assets.push(asset);
        if (type === 'scene_background') {
            const existing = state.editor.document.layers.find((l) => l.type === type);
            if (existing) existing.assetId = asset.id;
            else state.editor.document.layers.unshift(makeLayer(type, asset, 'Sahne Arka Planı'));
        } else {
            const layerType = type === 'optional_graphic' ? 'optional_text_or_graphic' : type;
            state.editor.document.layers.push(makeLayer(layerType, asset, type === 'foreground_mask' ? 'Foreground Mask' : 'Grafik Katmanı'));
        }
        recordHistory(before);
        await rebuildCanvas();
        renderEditor();
    }

    async function editorProductUpload(event) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        const type = document.getElementById('msEditorProductType').value;
        if (PRODUCT_TYPES.includes(type) && file.type !== 'image/png') return setStatus('Temiz ürün varlığı şeffaf PNG olmalıdır.', true);
        const before = editorSnapshot();
        const asset = await uploadFile(file, type, null);
        if (!asset) return;
        state.products.unshift(asset);
        state.editor.document.assets.push(asset);
        state.selectedAssetId = asset.id;
        if (PRODUCT_TYPES.includes(type)) {
            await addProductSlot(before);
        } else {
            recordHistory(before);
            renderEditorAssets();
            setStatus('Orijinal fotoğraf referans olarak saklandı.', false);
        }
    }

    function makeLayer(type, asset, name) {
        const frame = defaultFrame();
        if (type === 'scene_background' || type === 'foreground_mask') Object.assign(frame, { x: 1000, y: 1000, width: SIZE, height: SIZE });
        return { id: uid(), type, name, assetId: asset.id, visible: true, locked: type === 'scene_background', frame };
    }

    function preferredEditorProduct() {
        if (!state.editor) return null;
        const assets = state.editor.document.assets || [];
        return assets.find((a) => a.id === state.selectedAssetId && PRODUCT_TYPES.includes(a.type))
            || assets.find((a) => a.type === 'product_box_clean')
            || assets.find((a) => a.type === 'product_only_clean') || null;
    }

    async function addProductSlot(existingBefore) {
        const asset = preferredEditorProduct();
        if (!asset) return setStatus('Önce temizlenmiş bir ürün PNG’si seçin.', true);
        const before = existingBefore || editorSnapshot();
        const ratio = asset.width && asset.height ? asset.height / asset.width : 1;
        const count = state.editor.document.layers.filter((l) => l.type === 'product_slot').length;
        const layer = makeLayer('product_slot', asset, 'Ürün Slotu ' + (count + 1));
        layer.frame.width = 700;
        layer.frame.height = 700 * ratio;
        layer.frame.x += count * 35;
        layer.frame.y += count * 35;
        state.editor.document.layers.push(layer);
        state.selectedLayerId = layer.id;
        state.selectedLayerIds = new Set([layer.id]);
        recordHistory(before);
        await createNode(layer);
        syncOrder();
        selectLayer(layer.id);
        renderEditor();
    }

    async function bindProductToSelectedSlots() {
        const asset = preferredEditorProduct();
        const slots = state.editor.document.layers.filter((layer) => layer.type === 'product_slot' && state.selectedLayerIds.has(layer.id));
        if (!asset) return setStatus('Önce temizlenmiş bir ürün PNG’si seçin.', true);
        if (!slots.length) return setStatus('Ürünü yerleştirmek için en az bir slot seçin.', true);
        const before = editorSnapshot();
        for (const slot of slots) {
            slot.assetId = asset.id;
            const oldNode = state.nodes.get(slot.id);
            if (oldNode) oldNode.destroy();
            state.nodes.delete(slot.id);
            await createNode(slot);
        }
        recordHistory(before);
        syncOrder();
        selectLayer(state.selectedLayerId || slots[slots.length - 1].id, false, true);
        renderEditor();
        setStatus(`Ürün ${slots.length} slota yerleştirildi.`, false);
    }

    function updateSlotBindingButton() {
        const button = document.getElementById('msAddSlotBtn');
        if (!button || !state.editor) return;
        const slotCount = state.editor.document.layers.filter((layer) => layer.type === 'product_slot' && state.selectedLayerIds.has(layer.id)).length;
        button.disabled = !preferredEditorProduct() || slotCount === 0;
        button.textContent = slotCount > 0
            ? `Seçili ürünü ${slotCount} slota yerleştir`
            : 'Seçili ürünü seçili slotlara yerleştir';
    }

    function renderEditorAssets() {
        const list = document.getElementById('msEditorAssetList');
        if (!list || !state.editor) return;
        const assets = state.editor.document.assets.filter((a) => PRODUCT_TYPES.includes(a.type));
        list.innerHTML = assets.length ? '' : '<div class="ms-empty">Ürün PNG’si yok.</div>';
        assets.forEach((asset) => {
            const row = document.createElement('button');
            row.className = 'ms-asset' + (asset.id === state.selectedAssetId ? ' is-selected' : '');
            row.innerHTML = `<span>📦</span><span class="ms-asset-name">${esc(asset.name)}</span>`;
            row.addEventListener('click', () => { state.selectedAssetId = asset.id; renderEditorAssets(); updateSlotBindingButton(); });
            list.appendChild(row);
        });
        updateSlotBindingButton();
    }

    function renderLayers() {
        const list = document.getElementById('msLayerList');
        if (!list || !state.editor) return;
        list.innerHTML = '';
        if (!state.editor.document.layers.length) list.innerHTML = '<div class="ms-empty">Henüz katman yok.</div>';
        [...state.editor.document.layers].reverse().forEach((layer) => {
            const row = document.createElement('div');
            row.className = 'ms-layer' + (state.selectedLayerIds.has(layer.id) ? ' is-selected' : '');
            row.draggable = true;
            row.dataset.id = layer.id;
            row.innerHTML = `<span class="ms-layer-icon">${layerIcon(layer.type)}</span><span class="ms-layer-name">${esc(layer.name)}</span>
                <button data-action="rename" class="ms-icon-btn" title="Yeniden adlandır">✎</button>
                <button data-action="visible" class="ms-icon-btn" title="Görünürlük">${layer.visible ? '👁️' : '🙈'}</button>
                <button data-action="lock" class="ms-icon-btn" title="Kilitle">${layer.locked ? '🔒' : '🔓'}</button>`;
            row.addEventListener('click', (event) => selectLayer(layer.id, layer.type === 'product_slot' && !(event.target instanceof HTMLButtonElement)));
            row.addEventListener('dragstart', () => { state.dragLayerId = layer.id; });
            row.addEventListener('dragover', (e) => e.preventDefault());
            row.addEventListener('drop', (e) => { e.preventDefault(); reorderLayer(state.dragLayerId, layer.id); });
            row.querySelector('[data-action="rename"]').addEventListener('click', (e) => { e.stopPropagation(); renameLayer(layer); });
            row.querySelector('[data-action="visible"]').addEventListener('click', (e) => { e.stopPropagation(); toggleLayer(layer, 'visible'); });
            row.querySelector('[data-action="lock"]').addEventListener('click', (e) => { e.stopPropagation(); toggleLayer(layer, 'locked'); });
            list.appendChild(row);
        });
        updateSlotBindingButton();
    }

    function layerIcon(type) {
        return { scene_background: '🏞️', product_slot: '📦', foreground_mask: '🎭', optional_text_or_graphic: '🖼️', optional_graphic: '🖼️' }[type] || '◼';
    }
    function renameLayer(layer) {
        const name = window.prompt('Katman adı:', layer.name);
        if (name === null || !name.trim()) return;
        const before = editorSnapshot(); layer.name = name.trim(); recordHistory(before); renderLayers();
    }
    function toggleLayer(layer, key) {
        const before = editorSnapshot(); layer[key] = !layer[key]; recordHistory(before);
        const node = state.nodes.get(layer.id);
        if (node) { node.visible(layer.visible); node.draggable(!layer.locked && layer.type !== 'scene_background'); }
        selectLayer(layer.id); renderLayers(); state.stage.batchDraw();
    }
    function reorderLayer(sourceId, targetId) {
        if (!sourceId || sourceId === targetId) return;
        const layers = state.editor.document.layers;
        const source = layers.findIndex((l) => l.id === sourceId);
        const target = layers.findIndex((l) => l.id === targetId);
        if (source < 0 || target < 0) return;
        const before = editorSnapshot();
        const moved = layers.splice(source, 1)[0];
        layers.splice(target, 0, moved);
        recordHistory(before); syncOrder(); renderLayers();
    }

    function createStage() {
        state.stage = new Konva.Stage({ container: 'mockupCanvasHost', width: 600, height: 600 });
        state.contentLayer = new Konva.Layer(); state.uiLayer = new Konva.Layer();
        state.stage.add(state.contentLayer); state.stage.add(state.uiLayer);
        state.baseRect = new Konva.Rect({ x: 0, y: 0, width: SIZE, height: SIZE, fill: '#fff', listening: false });
        state.contentLayer.add(state.baseRect);
        state.transformer = new Konva.Transformer({ rotateEnabled: true, keepRatio: true, flipEnabled: false, anchorSize: 4, anchorStrokeWidth: 1, borderStrokeWidth: 1, anchorCornerRadius: 1, rotateAnchorOffset: 24, anchorFill: '#fff', anchorStroke: '#8e44ad', borderStroke: '#8e44ad', boundBoxFunc: (oldBox, newBox) => Math.abs(newBox.width) < 40 || Math.abs(newBox.height) < 40 ? oldBox : newBox });
        state.transformer.on('mouseenter', () => { state.transformer.find('Rect').forEach((anchor) => anchor.hitStrokeWidth(28)); });
        state.uiLayer.add(state.transformer); resizeStage();
    }
    function resizeStage() {
        if (!state.stage) return;
        const wrap = document.getElementById('msCanvasWrap');
        if (!wrap || wrap.clientWidth === 0) return;
        const size = Math.floor(Math.min(Math.max(280, wrap.clientWidth - 24), Math.max(280, Math.min(window.innerHeight - 250, 720))));
        state.scale = size / SIZE; state.stage.size({ width: size, height: size });
        state.contentLayer.scale({ x: state.scale, y: state.scale }); state.uiLayer.scale({ x: state.scale, y: state.scale });
        const label = document.getElementById('msZoom'); if (label) label.textContent = '%' + Math.round(state.scale * 100);
        state.stage.batchDraw();
    }
    function clearCanvas() {
        if (!state.stage) return;
        state.transformer.nodes([]); state.nodes.forEach((node) => node.destroy()); state.nodes.clear(); state.stage.batchDraw();
    }
    async function rebuildCanvas() {
        clearCanvas();
        for (const layer of state.editor.document.layers) await createNode(layer);
        syncOrder();
    }
    function getEditorAsset(id) { return state.editor.document.assets.find((asset) => asset.id === id); }
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = reject; image.src = url;
        });
    }
    async function createNode(layer) {
        const asset = getEditorAsset(layer.assetId); if (!asset) return null;
        try {
            const image = await loadImage(assetUrl(asset.storagePath));
            const node = makeImageNode(image, layer, layer.frame);
            node.setAttr('mockupLayerId', layer.id);
            node.on('click tap', (event) => { event.cancelBubble = true; selectLayer(layer.id, Boolean(event.evt && (event.evt.ctrlKey || event.evt.metaKey))); });
            node.on('dragstart', () => node.setAttr('historyBefore', editorSnapshot()));
            node.on('dragend', () => { updateFrameFromNode(layer, node, false); recordHistory(node.getAttr('historyBefore')); renderInspector(); });
            node.on('transformstart', () => node.setAttr('historyBefore', editorSnapshot()));
            node.on('transformend', () => { updateFrameFromNode(layer, node, true); recordHistory(node.getAttr('historyBefore')); renderInspector(); });
            state.contentLayer.add(node); state.nodes.set(layer.id, node); return node;
        } catch (error) { setStatus('Görsel yüklenemedi: ' + asset.name, true); return null; }
    }
    function makeImageNode(image, layer, frame) {
        const node = new Konva.Image({ image, x: frame.x, y: frame.y, width: frame.width, height: frame.height, offsetX: frame.width / 2, offsetY: frame.height / 2, rotation: frame.rotation || 0, opacity: frame.opacity == null ? 1 : frame.opacity, visible: layer.visible !== false, draggable: !layer.locked && layer.type !== 'scene_background' });
        applyEffects(node, frame); return node;
    }
    function applyEffects(node, frame) {
        const shadow = frame.shadow || defaultFrame().shadow;
        node.opacity(frame.opacity == null ? 1 : frame.opacity); node.shadowEnabled(Boolean(shadow.enabled));
        node.shadowColor(shadow.color || '#000'); node.shadowOpacity(shadow.opacity == null ? .35 : shadow.opacity); node.shadowBlur(shadow.blur || 0); node.shadowOffset({ x: shadow.offsetX || 0, y: shadow.offsetY || 0 });
        node.clearCache();
        if ((frame.blur || 0) > 0) { node.cache({ pixelRatio: 1 }); node.filters([Konva.Filters.Blur]); node.blurRadius(frame.blur); }
        else node.filters([]);
    }
    function updateFrameFromNode(layer, node, transformed) {
        const f = layer.frame; f.x = Math.round(node.x()); f.y = Math.round(node.y()); f.rotation = Math.round(node.rotation() * 10) / 10;
        if (transformed) { f.width = Math.max(40, Math.round(node.width() * node.scaleX())); f.height = Math.max(40, Math.round(node.height() * node.scaleY())); node.scale({ x: 1, y: 1 }); node.size({ width: f.width, height: f.height }); node.offset({ x: f.width / 2, y: f.height / 2 }); applyEffects(node, f); }
    }
    function syncOrder() {
        state.baseRect.moveToBottom(); state.editor.document.layers.forEach((layer, i) => { const node = state.nodes.get(layer.id); if (node) node.zIndex(i + 1); }); state.contentLayer.batchDraw();
    }
    function selectLayer(id, toggle, preserveSet) {
        if (!preserveSet) {
            const clicked = state.editor.document.layers.find((layer) => layer.id === id);
            if (toggle && clicked && clicked.type === 'product_slot') {
                if (state.selectedLayerIds.has(id)) state.selectedLayerIds.delete(id);
                else state.selectedLayerIds.add(id);
            } else {
                state.selectedLayerIds = id ? new Set([id]) : new Set();
            }
        }
        state.selectedLayerId = state.selectedLayerIds.has(id) ? id : ([...state.selectedLayerIds].pop() || null);
        const layer = state.editor.document.layers.find((item) => item.id === state.selectedLayerId);
        const node = layer ? state.nodes.get(layer.id) : null;
        state.transformer.nodes(layer && node && !layer.locked && layer.visible ? [node] : []);
        state.transformer.find('Rect').forEach((anchor) => anchor.hitStrokeWidth(28));
        state.uiLayer.batchDraw(); renderLayers(); renderInspector(); updateSlotBindingButton();
    }

    function renderInspector() {
        const root = document.getElementById('msInspector'); if (!root || !state.editor) return;
        const layer = state.editor.document.layers.find((l) => l.id === state.selectedLayerId);
        if (!layer) { root.innerHTML = '<div class="ms-empty">Bir katman seçin.</div>'; return; }
        const f = layer.frame;
        root.innerHTML = `<h4>${esc(layer.name)}</h4>${numberField('X','x',f.x,-2000,4000)}${numberField('Y','y',f.y,-2000,4000)}${numberField('Genişlik','width',f.width,40,4000)}${numberField('Yükseklik','height',f.height,40,4000)}${rangeField('Dönüş','rotation',f.rotation||0,-180,180,'°')}${rangeField('Opaklık','opacity',Math.round((f.opacity==null?1:f.opacity)*100),0,100,'%')}${rangeField('Blur','blur',f.blur||0,0,80,' px')}
            <div class="ms-section"><h4>GÖLGE</h4><label class="ms-check"><input id="msShadowToggle" type="checkbox" ${f.shadow.enabled?'checked':''}> Gölgeyi aç</label>${rangeField('Gölge blur','shadowBlur',f.shadow.blur||0,0,120,' px')}${rangeField('Gölge opaklığı','shadowOpacity',Math.round((f.shadow.opacity==null?.35:f.shadow.opacity)*100),0,100,'%')}${numberField('Gölge X','shadowOffsetX',f.shadow.offsetX||0,-300,300)}${numberField('Gölge Y','shadowOffsetY',f.shadow.offsetY||0,-300,300)}</div>
            ${layer.type==='product_slot'?'<button id="msDuplicateLayer" class="ms-btn ms-btn-primary ms-full">Slotu çoğalt</button>':''}<button id="msRemoveLayer" class="ms-btn ms-btn-danger ms-full">Katmanı sil</button>`;
        root.querySelectorAll('[data-frame-key]').forEach(bindFrameInput);
        document.getElementById('msShadowToggle').addEventListener('change', (e) => { const before=editorSnapshot(); f.shadow.enabled=e.target.checked; updateNode(layer); recordHistory(before); });
        const dup = document.getElementById('msDuplicateLayer'); if (dup) dup.addEventListener('click', () => duplicateLayer(layer));
        document.getElementById('msRemoveLayer').addEventListener('click', () => removeLayer(layer));
    }
    function numberField(label,key,value,min,max) { return `<div class="ms-field"><label>${label}</label><input data-frame-key="${key}" type="number" min="${min}" max="${max}" value="${Math.round(value*10)/10}"></div>`; }
    function rangeField(label,key,value,min,max,suffix) { return `<div class="ms-field"><label><span>${label}</span><span class="ms-field-value">${Math.round(value)}${suffix}</span></label><input data-frame-key="${key}" data-suffix="${suffix}" type="range" min="${min}" max="${max}" value="${value}"></div>`; }
    function bindFrameInput(input) {
        let before = null;
        const remember = () => { if (!before) before = editorSnapshot(); };
        input.addEventListener('pointerdown', remember); input.addEventListener('focus', remember);
        input.addEventListener('input', () => {
            const layer = state.editor.document.layers.find((l) => l.id === state.selectedLayerId); if (!layer) return;
            const key=input.dataset.frameKey, value=Number(input.value), f=layer.frame;
            if(key==='opacity') f.opacity=value/100; else if(key==='shadowOpacity') f.shadow.opacity=value/100; else if(key==='shadowBlur') f.shadow.blur=value; else if(key==='shadowOffsetX') f.shadow.offsetX=value; else if(key==='shadowOffsetY') f.shadow.offsetY=value; else f[key]=value;
            const label=input.parentElement.querySelector('.ms-field-value'); if(label) label.textContent=Math.round(value)+(input.dataset.suffix||''); updateNode(layer);
        });
        input.addEventListener('change', () => { recordHistory(before); before=null; });
    }
    function updateNode(layer) { const node=state.nodes.get(layer.id); if(!node)return; const f=layer.frame; node.position({x:f.x,y:f.y}); node.size({width:f.width,height:f.height}); node.offset({x:f.width/2,y:f.height/2}); node.rotation(f.rotation||0); applyEffects(node,f); state.transformer.forceUpdate(); state.stage.batchDraw(); }
    async function duplicateLayer(layer) { const before=editorSnapshot(), copy=clone(layer); copy.id=uid(); copy.name=layer.name+' Kopya'; copy.frame.x+=60; copy.frame.y+=60; state.editor.document.layers.push(copy); state.selectedLayerIds=new Set([copy.id]); recordHistory(before); await createNode(copy); syncOrder(); selectLayer(copy.id); renderEditor(); }
    function removeLayer(layer) { const before=editorSnapshot(), index=state.editor.document.layers.findIndex((l)=>l.id===layer.id); if(index<0)return; const node=state.nodes.get(layer.id); if(node)node.destroy(); state.nodes.delete(layer.id); state.editor.document.layers.splice(index,1); state.selectedLayerIds.delete(layer.id); state.selectedLayerId=[...state.selectedLayerIds].pop()||null; state.transformer.nodes([]); recordHistory(before); state.stage.batchDraw(); renderEditor(); }

    async function exportEditorBlob(targetSize) {
        if (!state.stage) return null;
        const selected = state.selectedLayerId; state.transformer.nodes([]); state.uiLayer.hide(); state.stage.draw();
        try { return await state.stage.toBlob({ x:0,y:0,width:state.stage.width(),height:state.stage.height(),pixelRatio:targetSize/state.stage.width(),mimeType:'image/png' }); }
        finally { state.uiLayer.show(); if(selected) selectLayer(selected); state.stage.draw(); }
    }

    async function uploadFile(file, type, templateId) {
        const dimensions = await readDimensions(file); const asset = await uploadBlob(file, type, file.name, templateId, file.type); if (!asset) return null; asset.width=dimensions.width; asset.height=dimensions.height; return asset;
    }
    async function uploadBlob(blob, type, filename, templateId, mimeType, throwOnError) {
        try {
            if (type === 'output') return await uploadBlobChunked(blob, filename, mimeType || 'image/png');
            const query = new URLSearchParams({ action:'upload', asset_type:type, filename }); if(templateId)query.set('template_id',templateId);
            const data = await api(API+'?'+query.toString(),{method:'POST',headers:{'Content-Type':mimeType||blob.type||'application/octet-stream'},body:blob}); return normalizeAsset(data.asset);
        } catch(error) {
            console.error('[Mockup Studio upload]', { type, size: blob && blob.size, message: error.message });
            if (throwOnError) throw error;
            setStatus('Dosya yüklenemedi: '+error.message,true);
            return null;
        }
    }
    async function uploadBlobChunked(blob, filename, mimeType) {
        const chunkSize = 2 * 1024 * 1024;
        const chunkCount = Math.ceil(blob.size / chunkSize);
        const uploadId = uid();
        for (let index = 0; index < chunkCount; index += 1) {
            const query = new URLSearchParams({ action:'upload_chunk', upload_id:uploadId, chunk_index:String(index) });
            await api(API+'?'+query.toString(), { method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:blob.slice(index * chunkSize, Math.min(blob.size, (index + 1) * chunkSize)) });
        }
        const data = await api(API, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'finalize_upload', upload_id:uploadId, asset_type:'output', filename, mime_type:mimeType, chunk_count:chunkCount }) });
        return normalizeAsset(data.asset);
    }
    function readDimensions(file) { return new Promise((resolve)=>{ const url=URL.createObjectURL(file),img=new Image(); img.onload=()=>{resolve({width:img.naturalWidth,height:img.naturalHeight});URL.revokeObjectURL(url);};img.onerror=()=>{resolve({width:null,height:null});URL.revokeObjectURL(url);};img.src=url; }); }

    function renderCreateView() {
        const root=document.getElementById('msViewCreate'); if(!root)return;
        const selected = state.templates.filter((template) => state.selectedTemplateIds.has(template.id));
        const templateCards = state.templates.map((template) => `<button type="button" class="ms-create-template${state.selectedTemplateIds.has(template.id)?' is-selected':''}" data-template-id="${template.id}"><span>${state.selectedTemplateIds.has(template.id)?'✓':'+'}</span>${esc(template.name)} <small>v${template.current_version}</small></button>`).join('');
        const versionPicker = selected.length === 1
            ? '<select id="msCreateVersion" class="ms-select" style="margin-top:8px;"><option value="">Sürümler yükleniyor…</option></select>'
            : `<div class="ms-selection-summary">${selected.length ? selected.length+' şablon seçili; her biri en güncel kayıtlı sürümü kullanacak.' : 'En az bir şablon seçin.'}</div>`;
        root.innerHTML=`<div class="ms-view-header"><div><h3>Ürünle Oluştur</h3><p>Kaydedilmiş bir şablon sürümünü değiştirmeden ürün PNG’siyle render alın.</p></div></div>
            <div class="ms-create-grid"><div class="ms-panel"><div class="ms-panel-title">1. Şablonlar ve Sürüm</div><div class="ms-panel-body"><div id="msCreateTemplates" class="ms-create-template-list">${templateCards||'<div class="ms-empty">Kayıtlı şablon yok.</div>'}</div>${versionPicker}</div></div>
            <div class="ms-panel"><div class="ms-panel-title">2. Ürün PNG</div><div class="ms-panel-body"><select id="msCreateProductType" class="ms-select"><option value="product_box_clean">Ürün + gerçek kutusu</option><option value="product_only_clean">Kutusuz ürün</option></select><label class="ms-upload-label">Yeni ürün PNG yükle<input id="msCreateProductInput" type="file" accept="image/png"></label><div id="msCreateProducts" class="ms-product-grid"></div></div></div>
            <div class="ms-panel"><div class="ms-panel-title">3. Çıktı</div><div class="ms-panel-body"><input id="msOutputName" class="fin-input" placeholder="Çıktı adı" maxlength="160"><button id="msGenerateBtn" class="ms-btn ms-btn-success ms-full">Seçili Şablonlardan 2000×2000 Oluştur</button><div id="msCreatePreview" class="ms-output-preview"><span>Henüz çıktı oluşturulmadı.</span></div></div></div></div>`;
        root.querySelectorAll('[data-template-id]').forEach((button) => button.addEventListener('click', () => {
            const id = button.dataset.templateId;
            if (state.selectedTemplateIds.has(id)) state.selectedTemplateIds.delete(id); else state.selectedTemplateIds.add(id);
            state.createVersions=[]; state.createVersionId=null; renderCreateView();
        }));
        const versionSelect=document.getElementById('msCreateVersion');
        if(versionSelect){versionSelect.addEventListener('change',(e)=>{state.createVersionId=e.target.value||null;updateDefaultOutputName();});loadCreateVersions(selected[0].id);}
        document.getElementById('msCreateProductInput').addEventListener('change',createProductUpload);
        document.getElementById('msGenerateBtn').addEventListener('click',generateSelectedOutputs);
        renderCreateProducts();
        updateDefaultOutputName();
    }
    async function loadCreateVersions(templateId) {
        state.createVersions=[];state.createVersionId=null;const select=document.getElementById('msCreateVersion');
        if(!templateId){select.innerHTML='<option value="">Önce şablon seçin</option>';return;}
        try{const data=await api(API+'?resource=versions&template_id='+encodeURIComponent(templateId));state.createVersions=data.versions||[];select.innerHTML=state.createVersions.map(v=>`<option value="${v.id}">v${v.version_number} — ${esc(formatDate(v.created_at))}</option>`).join('');state.createVersionId=state.createVersions[0]?state.createVersions[0].id:null;updateDefaultOutputName();}catch(error){setStatus('Sürümler alınamadı: '+error.message,true);}
    }
    function renderCreateProducts(){const root=document.getElementById('msCreateProducts');if(!root)return;const products=state.products.filter(a=>PRODUCT_TYPES.includes(a.type));root.innerHTML=products.length?'':'<div class="ms-empty">Temiz ürün PNG’si yok.</div>';products.forEach(asset=>{const card=document.createElement('button');card.className='ms-product-card'+(asset.id===state.createProductId?' is-selected':'');card.innerHTML=`<img src="${assetUrl(asset.storagePath)}" alt=""><span>${esc(asset.name)}</span>`;card.addEventListener('click',()=>{state.createProductId=asset.id;renderCreateProducts();updateDefaultOutputName();});root.appendChild(card);});}
    async function createProductUpload(event){const file=event.target.files[0];event.target.value='';if(!file)return;if(file.type!=='image/png')return setStatus('Ürün dosyası şeffaf PNG olmalıdır.',true);const type=document.getElementById('msCreateProductType').value;const asset=await uploadFile(file,type,null);if(!asset)return;state.products.unshift(asset);state.createProductId=asset.id;renderCreateProducts();updateDefaultOutputName();}
    function updateDefaultOutputName(){const input=document.getElementById('msOutputName');if(!input||input.value.trim())return;const template=state.templates.find(t=>state.selectedTemplateIds.has(t.id));const product=state.products.find(p=>p.id===state.createProductId);if(template&&product)input.value=(state.selectedTemplateIds.size>1?'Mockup Paketi':template.name)+' – '+product.name.replace(/\.[^.]+$/,'');}
    async function latestVersionFor(template){
        if(state.selectedTemplateIds.size===1){const chosen=state.createVersions.find(v=>v.id===state.createVersionId);if(chosen)return chosen;}
        const data=await api(API+'?resource=versions&template_id='+encodeURIComponent(template.id));
        return (data.versions||[])[0]||null;
    }
    async function generateSelectedOutputs(){
        const templates=state.templates.filter(template=>state.selectedTemplateIds.has(template.id));
        const product=state.products.find(item=>item.id===state.createProductId);
        const baseName=document.getElementById('msOutputName').value.trim();
        if(!templates.length)return setStatus('En az bir şablon seçin.',true);
        if(!product)return setStatus('Ürün PNG’si seçin.',true);
        if(!baseName)return setStatus('Çıktı adı zorunludur.',true);
        setBusy(true);
        const created=[];
        try{
            for(const template of templates){
                const version=await latestVersionFor(template);
                if(!version)throw new Error(template.name+' için kayıtlı sürüm bulunamadı.');
                const name=templates.length>1?baseName+' – '+template.name:baseName;
                created.push(await generateOutput({name,templateId:version.template_id,templateName:version.template_name,templateVersion:version.version_number,snapshot:normalizeDocument(version.snapshot),product},{manageBusy:false,refresh:false,rethrow:true,status:false}));
            }
            await loadOutputs();
            const preview=document.getElementById('msCreatePreview');
            if(preview)preview.innerHTML=created.map(output=>`<img src="${assetUrl(output.export_path)}" alt="${esc(output.name)}">`).join('');
            setStatus(created.length+' kalıcı çıktı oluşturuldu.',false);
        }catch(error){
            console.error('[Mockup Studio render]',error);
            setStatus('Çıktı oluşturulamadı: '+error.message,true);
        }finally{setBusy(false);}
    }
    async function generateOutput(config,options){
        const opts=options||{};if(opts.manageBusy!==false)setBusy(true);
        try{
            const blob=await renderSnapshot(config.snapshot,config.product);
            if(!blob||!blob.size)throw new Error('Tarayıcı boş bir PNG üretti.');
            const exportAsset=await uploadBlob(blob,'output',safeName(config.name)+'.png',null,'image/png',true);
            const data=await api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_output',id:uid(),name:config.name,export_asset_id:exportAsset.id,product_asset_id:config.product.id,template_id:config.templateId||null,template_name:config.templateName,template_version:config.templateVersion,template_snapshot:config.snapshot})});
            const output=Object.assign({},data.output,{export_path:exportAsset.storagePath});
            if(opts.refresh!==false)await loadOutputs();
            const preview=document.getElementById('msCreatePreview');if(preview&&opts.status!==false)preview.innerHTML=`<img src="${assetUrl(exportAsset.storagePath)}" alt="${esc(config.name)}">`;
            if(opts.status!==false)setStatus('Çıktı kalıcı kütüphaneye kaydedildi.',false);
            return output;
        }catch(error){
            console.error('[Mockup Studio output]',{name:config.name,message:error.message});
            if(opts.rethrow)throw error;
            setStatus('Çıktı oluşturulamadı: '+error.message,true);return null;
        }finally{if(opts.manageBusy!==false)setBusy(false);}
    }
    async function renderSnapshot(snapshot,product){const host=document.getElementById('msRenderHost');host.innerHTML='';const stage=new Konva.Stage({container:host,width:SIZE,height:SIZE}),layerCanvas=new Konva.Layer();stage.add(layerCanvas);layerCanvas.add(new Konva.Rect({x:0,y:0,width:SIZE,height:SIZE,fill:'#fff',listening:false}));for(const item of snapshot.layers||[]){if(item.visible===false)continue;let asset=item.type==='product_slot'?product:(snapshot.assets||[]).find(a=>a.id===item.assetId);if(!asset||!asset.storagePath)continue;try{const image=await loadImage(assetUrl(asset.storagePath));const node=makeImageNode(image,{type:item.type,visible:true,locked:true},Object.assign(defaultFrame(),item.frame||{}));node.draggable(false);layerCanvas.add(node);}catch(error){throw new Error('Render varlığı yüklenemedi: '+(asset.name||asset.storagePath));}}layerCanvas.draw();try{return await stage.toBlob({mimeType:'image/png',pixelRatio:1});}finally{stage.destroy();host.innerHTML='';}}

    function renderOutputs(){const root=document.getElementById('msViewOutputs');if(!root)return;root.innerHTML=`<div class="ms-view-header"><div><h3>Çıktılar</h3><p>Şablonlardan bağımsız kalıcı mockup görselleri</p></div></div><div id="msOutputGrid" class="ms-card-grid"></div>`;const grid=document.getElementById('msOutputGrid');if(!state.outputs.length){grid.innerHTML='<div class="ms-empty-card">Henüz kayıtlı çıktı yok.</div>';return;}state.outputs.forEach(output=>{const card=document.createElement('article');card.className='ms-library-card';card.innerHTML=`<div class="ms-card-preview"><img src="${assetUrl(output.export_path)}" alt="${esc(output.name)}"></div><div class="ms-card-content"><h4>${esc(output.name)}</h4><p>${esc(output.template_name)} • v${output.template_version}</p><p>${esc(formatDate(output.created_at))}</p><div class="ms-card-actions"><a class="ms-btn ms-btn-primary ms-btn-small" href="${assetUrl(output.export_path)}" download="${safeName(output.name)}.png">İndir</a><button data-action="rename" class="ms-btn ms-btn-small">Adlandır</button><button data-action="rerun" class="ms-btn ms-btn-small">Tekrar Üret</button><button data-action="delete" class="ms-btn ms-btn-danger ms-btn-small">Sil</button></div></div>`;card.querySelector('[data-action="rename"]').addEventListener('click',()=>renameOutput(output));card.querySelector('[data-action="rerun"]').addEventListener('click',()=>rerunOutput(output));card.querySelector('[data-action="delete"]').addEventListener('click',()=>deleteOutput(output));grid.appendChild(card);});}
    async function renameOutput(output){const name=window.prompt('Çıktının yeni adı:',output.name);if(name===null)return;if(!name.trim())return setStatus('Çıktı adı zorunludur.',true);try{await api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename_output',id:output.id,name:name.trim()})});await loadOutputs();}catch(error){setStatus('Çıktı yeniden adlandırılamadı: '+error.message,true);}}
    async function deleteOutput(output){if(!window.confirm('“'+output.name+'” çıktısı kütüphaneden kaldırılsın mı? Dosya ilk aşamada fiziksel olarak silinmeyecektir.'))return;try{await api(API+'?resource=output&id='+encodeURIComponent(output.id),{method:'DELETE'});await loadOutputs();setStatus('Çıktı yumuşak silindi.',false);}catch(error){setStatus('Çıktı silinemedi: '+error.message,true);}}
    async function rerunOutput(output){const product={id:output.product_asset_id,type:'product_box_clean',name:output.product_name||'Ürün',storagePath:output.product_path};await generateOutput({name:output.name+' Tekrar',templateId:output.template_id,templateName:output.template_name,templateVersion:output.template_version,snapshot:normalizeDocument(output.template_snapshot),product});showView('outputs');}

    installTabHook();
    window.MockupStudio={init};
})();
