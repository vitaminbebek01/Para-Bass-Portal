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
        selectionMarkers: new Map(),
        perspectiveHandles: new Map(),
        polygonHandles: new Map(),
        polygonDrawingLayerId: null,
        clipboardLayer: null,
        previewAssetId: null,
        slotPreviewAssetIds: new Map(),
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
        return { schemaVersion: 3, canvas: { width: SIZE, height: SIZE }, assets: [], layers: [], promptSpec: blankPromptSpec() };
    }

    function blankPromptSpec() {
        return {
            product: '', scene: '', surface: '', style: '', lighting: '', camera: '',
            colors: '', negatives: '', generatedTr: '', generatedEn: ''
        };
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
            height: raw.height || null,
            hidden: Boolean(raw.hidden)
        };
    }

    function normalizeDocument(raw) {
        const doc = clone(raw || blankDocument());
        doc.schemaVersion = 3;
        doc.canvas = { width: SIZE, height: SIZE };
        doc.promptSpec = Object.assign(blankPromptSpec(), doc.promptSpec || {});
        doc.assets = (doc.assets || []).map(normalizeAsset);
        doc.layers = (doc.layers || []).map((layer) => {
            if (layer.type === 'scene') layer.type = 'scene_background';
            if (layer.type === 'slot') layer.type = 'product_slot';
            if (!layer.frame && layer.slot) layer.frame = layer.slot;
            layer.frame = Object.assign(defaultFrame(), layer.frame || {});
            layer.frame.shadow = normalizeShadow(layer.frame.shadow);
            if (layer.frame.perspective) {
                layer.frame.perspective = normalizePerspective(layer.frame.perspective, layer.frame);
            }
            if (layer.frame.smartFit) {
                layer.frame.smartFit = normalizeSmartFit(layer.frame.smartFit);
            }
            if (layer.type === 'foreground_polygon') {
                layer.geometry = normalizePolygonGeometry(layer.geometry, layer.assetId);
            }
            layer.visible = layer.visible !== false;
            layer.locked = Boolean(layer.locked);
            return layer;
        });
        return doc;
    }

    function defaultFrame() {
        return {
            x: 1000, y: 1000, width: 700, height: 700, rotation: 0,
            opacity: 1, blur: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, sharpen: 0,
            shadow: { enabled: false, color: '#000000', opacity: 0.35, blur: 24, angle: 56, distance: 22, offsetX: 12, offsetY: 18 }
        };
    }

    function normalizeShadow(raw) {
        const defaults = defaultFrame().shadow;
        const shadow = Object.assign({}, defaults, raw || {});
        if (raw && raw.angle == null) shadow.angle = (Math.atan2(Number(shadow.offsetY) || 0, Number(shadow.offsetX) || 0) * 180 / Math.PI + 360) % 360;
        if (raw && raw.distance == null) shadow.distance = Math.hypot(Number(shadow.offsetX) || 0, Number(shadow.offsetY) || 0);
        shadow.angle = Math.max(0, Math.min(360, Number(shadow.angle) || 0));
        shadow.distance = Math.max(0, Math.min(500, Number(shadow.distance) || 0));
        return shadow;
    }

    function normalizeSmartFit(raw) {
        const crop = raw && raw.crop ? raw.crop : { x: 0, y: 0, width: 1, height: 1 };
        return {
            crop: {
                x: Math.max(0, Math.min(1, Number(crop.x) || 0)),
                y: Math.max(0, Math.min(1, Number(crop.y) || 0)),
                width: Math.max(0.001, Math.min(1, Number(crop.width) || 1)),
                height: Math.max(0.001, Math.min(1, Number(crop.height) || 1))
            },
            padding: Math.max(0, Math.min(30, Number(raw && raw.padding) || 0))
        };
    }

    function rotatedRectangleCorners(frame) {
        const angle = (Number(frame.rotation) || 0) * Math.PI / 180;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const halfWidth = frame.width / 2, halfHeight = frame.height / 2;
        return [
            { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
            { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
        ].map((point) => ({
            x: frame.x + point.x * cos - point.y * sin,
            y: frame.y + point.x * sin + point.y * cos
        }));
    }

    function normalizePerspective(raw, frame) {
        const fallback = rotatedRectangleCorners(frame);
        const corners = Array.isArray(raw && raw.corners) && raw.corners.length === 4 ? raw.corners : fallback;
        return {
            enabled: Boolean(raw && raw.enabled),
            corners: corners.map((point, index) => ({
                x: Number.isFinite(Number(point.x)) ? Number(point.x) : fallback[index].x,
                y: Number.isFinite(Number(point.y)) ? Number(point.y) : fallback[index].y
            }))
        };
    }

    function normalizePolygonGeometry(raw, assetId) {
        return {
            sourceAssetId: (raw && raw.sourceAssetId) || assetId || null,
            points: (raw && Array.isArray(raw.points) ? raw.points : []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
            closed: Boolean(raw && raw.closed)
        };
    }

    function subtleSharpen(imageData) {
        const amount = Math.max(0, Math.min(0.2, Number(this.getAttr('mockupSharpen') || 0) / 100));
        if (!amount) return;
        const data = imageData.data;
        const source = new Uint8ClampedArray(data);
        const width = imageData.width;
        const height = imageData.height;
        for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
                const offset = (y * width + x) * 4;
                for (let channel = 0; channel < 3; channel += 1) {
                    const center = source[offset + channel] * (1 + 4 * amount);
                    const neighbors = source[offset - 4 + channel] + source[offset + 4 + channel]
                        + source[offset - width * 4 + channel] + source[offset + width * 4 + channel];
                    data[offset + channel] = Math.max(0, Math.min(255, center - neighbors * amount));
                }
            }
        }
    }

    function makeCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        return canvas;
    }

    function insetQuad(corners, padding) {
        const ratio = Math.max(0, Math.min(0.3, Number(padding || 0) / 100));
        if (!ratio) return corners.map((point) => ({ x: point.x, y: point.y }));
        const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
        return corners.map((point) => ({ x: point.x + (center.x - point.x) * ratio, y: point.y + (center.y - point.y) * ratio }));
    }

    function solveLinearSystem(matrix, values) {
        const size = values.length;
        const rows = matrix.map((row, index) => row.slice().concat(values[index]));
        for (let column = 0; column < size; column += 1) {
            let pivot = column;
            for (let row = column + 1; row < size; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
            if (Math.abs(rows[pivot][column]) < 1e-10) return null;
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const divisor = rows[column][column];
            for (let cell = column; cell <= size; cell += 1) rows[column][cell] /= divisor;
            for (let row = 0; row < size; row += 1) {
                if (row === column) continue;
                const factor = rows[row][column];
                for (let cell = column; cell <= size; cell += 1) rows[row][cell] -= factor * rows[column][cell];
            }
        }
        return rows.map((row) => row[size]);
    }

    function homographyForQuad(corners) {
        const source = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const matrix = [], values = [];
        source.forEach(([u, v], index) => {
            const point = corners[index];
            matrix.push([u, v, 1, 0, 0, 0, -u * point.x, -v * point.x]); values.push(point.x);
            matrix.push([0, 0, 0, u, v, 1, -u * point.y, -v * point.y]); values.push(point.y);
        });
        return solveLinearSystem(matrix, values);
    }

    function mapHomography(matrix, u, v) {
        if (!matrix) return { x: 0, y: 0 };
        const denominator = matrix[6] * u + matrix[7] * v + 1;
        return {
            x: (matrix[0] * u + matrix[1] * v + matrix[2]) / denominator,
            y: (matrix[3] * u + matrix[4] * v + matrix[5]) / denominator
        };
    }

    function drawImageTriangle(context, image, source, target) {
        const x0 = source[0].x, y0 = source[0].y, x1 = source[1].x, y1 = source[1].y, x2 = source[2].x, y2 = source[2].y;
        const denominator = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
        if (Math.abs(denominator) < 1e-8) return;
        const a = (target[0].x * (y1 - y2) + target[1].x * (y2 - y0) + target[2].x * (y0 - y1)) / denominator;
        const c = (target[0].x * (x2 - x1) + target[1].x * (x0 - x2) + target[2].x * (x1 - x0)) / denominator;
        const e = (target[0].x * (x1 * y2 - x2 * y1) + target[1].x * (x2 * y0 - x0 * y2) + target[2].x * (x0 * y1 - x1 * y0)) / denominator;
        const b = (target[0].y * (y1 - y2) + target[1].y * (y2 - y0) + target[2].y * (y0 - y1)) / denominator;
        const d = (target[0].y * (x2 - x1) + target[1].y * (x0 - x2) + target[2].y * (x1 - x0)) / denominator;
        const f = (target[0].y * (x1 * y2 - x2 * y1) + target[1].y * (x2 * y0 - x0 * y2) + target[2].y * (x0 * y1 - x1 * y0)) / denominator;
        context.save();
        context.beginPath();
        context.moveTo(target[0].x, target[0].y); context.lineTo(target[1].x, target[1].y); context.lineTo(target[2].x, target[2].y); context.closePath();
        context.clip();
        context.transform(a, b, c, d, e, f);
        context.drawImage(image, 0, 0);
        context.restore();
    }

    function renderPerspectiveBitmap(image, frame) {
        const canvas = makeCanvas(SIZE, SIZE), context = canvas.getContext('2d');
        const perspective = normalizePerspective(frame.perspective, frame);
        const smartFit = normalizeSmartFit(frame.smartFit || {});
        const corners = insetQuad(perspective.corners, smartFit.padding);
        const homography = homographyForQuad(corners);
        const crop = smartFit.crop;
        const left = crop.x * image.naturalWidth, top = crop.y * image.naturalHeight;
        const width = crop.width * image.naturalWidth, height = crop.height * image.naturalHeight;
        const divisions = 14;
        for (let row = 0; row < divisions; row += 1) {
            for (let column = 0; column < divisions; column += 1) {
                const u0 = column / divisions, v0 = row / divisions, u1 = (column + 1) / divisions, v1 = (row + 1) / divisions;
                const source = {
                    tl: { x: left + u0 * width, y: top + v0 * height }, tr: { x: left + u1 * width, y: top + v0 * height },
                    br: { x: left + u1 * width, y: top + v1 * height }, bl: { x: left + u0 * width, y: top + v1 * height }
                };
                const target = { tl: mapHomography(homography, u0, v0), tr: mapHomography(homography, u1, v0), br: mapHomography(homography, u1, v1), bl: mapHomography(homography, u0, v1) };
                drawImageTriangle(context, image, [source.tl, source.tr, source.br], [target.tl, target.tr, target.br]);
                drawImageTriangle(context, image, [source.tl, source.br, source.bl], [target.tl, target.br, target.bl]);
            }
        }
        return canvas;
    }

    function renderPolygonBitmap(image, geometry) {
        const canvas = makeCanvas(SIZE, SIZE), context = canvas.getContext('2d');
        const points = geometry && geometry.points || [];
        if (!geometry || !geometry.closed || points.length < 3) return canvas;
        context.save();
        context.beginPath(); context.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath(); context.clip();
        context.drawImage(image, 0, 0, SIZE, SIZE);
        context.restore();
        return canvas;
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
            <div id="msUploadProgress" class="ms-upload-progress" hidden><div class="ms-upload-progress-head"><span id="msUploadProgressLabel">Dosya hazırlanıyor…</span><strong id="msUploadProgressValue">0%</strong></div><div class="ms-upload-progress-track"><span id="msUploadProgressBar"></span></div></div>
            <nav class="ms-workspace-nav">
                <button data-view="templates" class="ms-workspace-tab is-active">Şablonlar</button>
                <button data-view="editor" class="ms-workspace-tab">Şablon Editörü</button>
                <button data-view="prompt" class="ms-workspace-tab">Prompt Oluşturucu</button>
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
                                <label class="ms-upload-label">Foreground Mask PNG <span class="ms-info" title="Ürünün önüne gelecek hazır şeffaf PNG’dir. Örnek: kutunun ön kenarı, kurdele veya çiçek.">ⓘ</span><input id="msMaskInput" type="file" accept="image/png"></label>
                                <small class="ms-tool-help">Ürünün önüne gelecek hazır şeffaf PNG. Örnek: kutunun ön kenarı, kurdele veya çiçek.</small>
                                <button id="msPolygonMaskBtn" class="ms-btn ms-full">+ Polygon Foreground Mask <span class="ms-info" title="Sahne fotoğrafındaki seçilen alanı kesip ürünün önüne getirir.">ⓘ</span></button>
                                <small class="ms-tool-help">Hazır PNG yoksa sahnedeki alanı seçip ürünün önüne getirir; örneğin açık kutunun ön kenarı.</small>
                                <label class="ms-upload-label">Graphic PNG <span class="ms-info" title="Ürünün üstünde görünecek dekoratif, logo veya yazı katmanıdır.">ⓘ</span><input id="msGraphicInput" type="file" accept="image/png,image/jpeg,image/webp"></label>
                                <small class="ms-tool-help">Ürünün üstünde görünecek dekoratif, logo veya yazı katmanı.</small>
                            </div>
                            <div class="ms-section">
                                <h4>ÖRNEK ÜRÜN ÖNİZLEMESİ</h4>
                                <select id="msEditorProductType" class="ms-select">
                                    <option value="product_box_clean">Ürün + gerçek kutusu</option>
                                    <option value="product_only_clean">Kutusuz ürün</option>
                                    <option value="original_photo">Orijinal kaynak</option>
                                </select>
                                <label class="ms-upload-label">Örnek Ürün Yükle / Seç<input id="msEditorProductInput" type="file" accept="image/png,image/jpeg"></label>
                                <div id="msEditorAssetList" class="ms-asset-list"></div>
                                <button id="msPreviewAllBtn" class="ms-btn ms-full" disabled>Tüm slotlarda önizle</button>
                                <button id="msAddSlotBtn" class="ms-btn ms-btn-primary ms-full" disabled>Seçili slotlarda önizle</button>
                                <button id="msRemovePreviewBtn" class="ms-btn ms-full">Örnek Ürünü Kaldır</button>
                                <button id="msNewSlotBtn" class="ms-btn ms-full">+ Slot Ekle</button>
                                <small id="msSlotSelectionHint" class="ms-help">Önce bir slot seçin. Çoklu seçim için Ctrl/Cmd basılı tutun.</small>
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

            <section id="msViewPrompt" class="ms-view" hidden></section>
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
        document.getElementById('msPolygonMaskBtn').addEventListener('click', addPolygonMask);
        document.getElementById('msGraphicInput').addEventListener('change', (e) => editorUpload(e, 'optional_graphic'));
        document.getElementById('msEditorProductInput').addEventListener('change', editorProductUpload);
        document.getElementById('msNewSlotBtn').addEventListener('click', () => addProductSlot());
        document.getElementById('msPreviewAllBtn').addEventListener('click', previewProductInAllSlots);
        document.getElementById('msAddSlotBtn').addEventListener('click', previewProductInSelectedSlots);
        document.getElementById('msRemovePreviewBtn').addEventListener('click', removePreviewProduct);
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
        ['templates', 'editor', 'prompt', 'create', 'outputs'].forEach((name) => {
            document.getElementById('msView' + name[0].toUpperCase() + name.slice(1)).hidden = name !== view;
        });
        if (view === 'templates') renderTemplateLibrary();
        if (view === 'editor') { renderEditor(); window.setTimeout(resizeStage, 0); }
        if (view === 'prompt') renderPromptView();
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
        state.polygonDrawingLayerId = null;
        state.previewAssetId = null;
        state.slotPreviewAssetIds = new Map();
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
            state.polygonDrawingLayerId = null;
            state.previewAssetId = null;
            state.slotPreviewAssetIds = new Map();
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
        const selectedPolygon = state.editor.document.layers.find((layer) => layer.id === state.selectedLayerId && layer.type === 'foreground_polygon' && !layer.geometry.closed);
        state.polygonDrawingLayerId = selectedPolygon ? selectedPolygon.id : null;
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
        if (event.target && event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const key = event.key.toLowerCase();
        if (key === 'z' && event.shiftKey) { event.preventDefault(); redo(); }
        else if (key === 'z') { event.preventDefault(); undo(); }
        else if (key === 'y') { event.preventDefault(); redo(); }
        else if (key === 'c') { event.preventDefault(); copySelectedSlot(); }
        else if (key === 'v') { event.preventDefault(); pasteCopiedSlot(); }
        else if (key === 'd') { event.preventDefault(); duplicateSelectedSlot(); }
    }

    async function saveEditor() {
        state.editor.name = document.getElementById('msEditorName').value.trim();
        if (!state.editor.name) return setStatus('Şablon adı zorunludur.', true);
        const promptTexts = buildPromptTexts(state.editor.document.promptSpec || blankPromptSpec());
        state.editor.document.promptSpec = Object.assign(blankPromptSpec(), state.editor.document.promptSpec || {}, { generatedTr: promptTexts.tr, generatedEn: promptTexts.en });
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
        if(type==='scene_background')setStatus('Boş sahne draft çalışma belgesine eklendi; kaydetmeden slot ekleyebilirsiniz.',false);
    }

    async function addPolygonMask() {
        const scene = state.editor.document.layers.find((layer) => layer.type === 'scene_background');
        const asset = scene && getEditorAsset(scene.assetId);
        if (!scene || !asset) return setStatus('Poligon maskesi için önce boş sahne yükleyin.', true);
        const before = editorSnapshot();
        const layer = makeLayer('foreground_polygon', asset, 'Poligon Foreground Maskesi');
        layer.locked = false;
        layer.geometry = normalizePolygonGeometry({ sourceAssetId: asset.id, points: [], closed: false }, asset.id);
        state.editor.document.layers.push(layer);
        state.selectedLayerId = layer.id; state.selectedLayerIds = new Set([layer.id]); state.polygonDrawingLayerId = layer.id;
        recordHistory(before);
        await createNode(layer); syncOrder(); selectLayer(layer.id); renderEditor();
        setStatus('Tuvale tıklayarak poligon noktalarını ekleyin.', false);
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
            state.previewAssetId = asset.id;
            state.slotPreviewAssetIds.clear();
            recordHistory(before);
            await rebuildCanvas(); renderEditor();
            setStatus('Örnek ürün yüklendi ve tüm slotlarda önizlemeye alındı.', false);
        } else {
            recordHistory(before);
            renderEditorAssets();
            setStatus('Orijinal fotoğraf referans olarak saklandı.', false);
        }
    }

    function makeLayer(type, asset, name) {
        const frame = defaultFrame();
        if (type === 'scene_background' || type === 'foreground_mask') Object.assign(frame, { x: 1000, y: 1000, width: SIZE, height: SIZE });
        return { id: uid(), type, name, assetId: asset ? asset.id : null, visible: true, locked: type === 'scene_background', frame };
    }

    function preferredEditorProduct() {
        if (!state.editor) return null;
        const assets = state.editor.document.assets || [];
        return assets.find((a) => !a.hidden && a.id === state.selectedAssetId && PRODUCT_TYPES.includes(a.type))
            || assets.find((a) => !a.hidden && a.type === 'product_box_clean')
            || assets.find((a) => !a.hidden && a.type === 'product_only_clean') || null;
    }

    async function addProductSlot(existingBefore) {
        const asset = preferredEditorProduct();
        const before = existingBefore || editorSnapshot();
        const ratio = asset && asset.width && asset.height ? asset.height / asset.width : 1;
        const count = state.editor.document.layers.filter((l) => l.type === 'product_slot').length;
        const layer = makeLayer('product_slot', null, 'Slot ' + (count + 1));
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
        setStatus(`${layer.name} sahnenin merkezine eklendi.`, false);
    }

    async function previewProductInSelectedSlots() {
        const asset = preferredEditorProduct();
        const slots = state.editor.document.layers.filter((layer) => layer.type === 'product_slot' && state.selectedLayerIds.has(layer.id));
        if (!asset) return setStatus('Önce bir örnek ürün seçin.', true);
        if (!slots.length) return setStatus('Önizleme için en az bir slot seçin.', true);
        for (const slot of slots) {
            state.slotPreviewAssetIds.set(slot.id, asset.id);
            const oldNode = state.nodes.get(slot.id);
            if (oldNode) oldNode.destroy();
            state.nodes.delete(slot.id);
            await createNode(slot);
        }
        syncOrder();
        selectLayer(state.selectedLayerId || slots[slots.length - 1].id, false, true);
        renderEditor();
        setStatus(`Örnek ürün ${slots.length} slotta önizleniyor.`, false);
    }

    async function previewProductInAllSlots() {
        const asset = preferredEditorProduct();
        if (!asset) return setStatus('Önce bir örnek ürün seçin.', true);
        state.previewAssetId = asset.id; state.slotPreviewAssetIds.clear();
        await rebuildCanvas(); renderEditor(); setStatus('Örnek ürün tüm slotlarda önizleniyor.', false);
    }

    async function removePreviewProduct() {
        state.previewAssetId = null; state.slotPreviewAssetIds.clear();
        await rebuildCanvas(); renderEditor(); setStatus('Örnek ürün önizlemesi kaldırıldı.', false);
    }

    function updateSlotBindingButton() {
        const button = document.getElementById('msAddSlotBtn');
        const allButton = document.getElementById('msPreviewAllBtn');
        const hint = document.getElementById('msSlotSelectionHint');
        if (!button || !state.editor) return;
        const slotCount = state.editor.document.layers.filter((layer) => layer.type === 'product_slot' && state.selectedLayerIds.has(layer.id)).length;
        button.disabled = !preferredEditorProduct() || slotCount === 0;
        if (allButton) allButton.disabled = !preferredEditorProduct();
        button.textContent = slotCount > 0
            ? `Seçili slotlarda önizle (${slotCount})`
            : 'Seçili slotlarda önizle';
        if (hint) hint.textContent = slotCount > 0
            ? `${slotCount} slot seçili. Ctrl/Cmd+tıklama ile seçime ekleyip çıkarabilirsiniz.`
            : 'Önce bir slot seçin. Çoklu seçim için Ctrl/Cmd basılı tutun.';
    }

    function renderEditorAssets() {
        const list = document.getElementById('msEditorAssetList');
        if (!list || !state.editor) return;
        const assets = state.editor.document.assets.filter((a) => PRODUCT_TYPES.includes(a.type) && !a.hidden);
        list.innerHTML = assets.length ? '' : '<div class="ms-empty">Ürün PNG’si yok.</div>';
        assets.forEach((asset) => {
            const row = document.createElement('div');
            row.className = 'ms-asset' + (asset.id === state.selectedAssetId ? ' is-selected' : '');
            row.innerHTML = `<button type="button" class="ms-asset-select"><span>📦</span><span class="ms-asset-name">${esc(asset.name)}</span></button><button type="button" class="ms-icon-btn ms-product-delete" title="Ürünü sil" aria-label="${esc(asset.name)} ürününü sil">🗑️</button>`;
            row.querySelector('.ms-asset-select').addEventListener('click', () => { state.selectedAssetId = asset.id; renderEditorAssets(); updateSlotBindingButton(); });
            row.querySelector('.ms-product-delete').addEventListener('click', () => deleteProductAsset(asset));
            list.appendChild(row);
        });
        updateSlotBindingButton();
    }

    async function deleteProductAsset(asset) {
        if (!window.confirm(`“${asset.name}” aktif ürün kütüphanesinden silinsin mi? Daha önce kullanılmış çıktılar korunacaktır.`)) return;
        setBusy(true);
        try {
            const result = await api(API + '?resource=product&id=' + encodeURIComponent(asset.id), { method: 'DELETE' });
            state.products = state.products.filter((item) => item.id !== asset.id);
            if (state.selectedAssetId === asset.id) state.selectedAssetId = null;
            if (state.createProductId === asset.id) state.createProductId = null;
            if (state.previewAssetId === asset.id) state.previewAssetId = null;
            state.slotPreviewAssetIds.forEach((value, key) => { if (value === asset.id) state.slotPreviewAssetIds.delete(key); });
            if (state.editor) {
                const editorAsset = state.editor.document.assets.find((item) => item.id === asset.id);
                if (editorAsset && result.physical_deleted) {
                    state.editor.document.assets = state.editor.document.assets.filter((item) => item.id !== asset.id);
                    state.editor.document.layers.forEach((layer) => {
                        if (layer.assetId !== asset.id) return;
                        layer.assetId = null;
                        const node = state.nodes.get(layer.id);
                        if (node) node.destroy();
                        state.nodes.delete(layer.id);
                    });
                } else if (editorAsset) {
                    editorAsset.hidden = true;
                }
            }
            renderEditorAssets();
            renderCreateProducts();
            renderLayers();
            renderInspector();
            updateSlotBindingButton();
            if (state.stage) state.stage.batchDraw();
            setStatus(result.physical_deleted
                ? 'Kullanılmamış ürün Storage ve ürün kütüphanesinden silindi.'
                : 'Kullanılmış ürün aktif listeden kaldırıldı; eski çıktılar korundu.', false);
        } catch (error) {
            setStatus('Ürün silinemedi: ' + error.message, true);
        } finally {
            setBusy(false);
        }
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
            row.addEventListener('click', (event) => selectLayer(layer.id, layer.type === 'product_slot' && (event.ctrlKey || event.metaKey)));
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
        return { scene_background: '🏞️', product_slot: '📦', foreground_mask: '🎭', foreground_polygon: '🔷', optional_text_or_graphic: '🖼️', optional_graphic: '🖼️' }[type] || '◼';
    }
    function renameLayer(layer) {
        const name = window.prompt('Katman adı:', layer.name);
        if (name === null || !name.trim()) return;
        const before = editorSnapshot(); layer.name = name.trim(); recordHistory(before); renderLayers();
    }
    function toggleLayer(layer, key) {
        const before = editorSnapshot(); layer[key] = !layer[key]; recordHistory(before);
        const node = state.nodes.get(layer.id);
        if (node) { node.visible(layer.visible); node.draggable(!layer.locked && layer.type !== 'scene_background' && layer.type !== 'foreground_polygon' && !(layer.type === 'product_slot' && layer.frame.perspective && layer.frame.perspective.enabled)); }
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
        state.stage.on('click tap', handleStagePolygonPoint);
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
        state.transformer.nodes([]); state.nodes.forEach((node) => node.destroy()); state.nodes.clear();
        state.selectionMarkers.forEach((marker) => marker.destroy()); state.selectionMarkers.clear(); state.stage.batchDraw();
        state.perspectiveHandles.forEach((marker) => marker.destroy()); state.perspectiveHandles.clear();
        state.polygonHandles.forEach((marker) => marker.destroy()); state.polygonHandles.clear();
    }
    async function rebuildCanvas() {
        clearCanvas();
        for (const layer of state.editor.document.layers) await createNode(layer);
        syncOrder();
    }
    function getEditorAsset(id) { return state.editor.document.assets.find((asset) => asset.id === id); }
    function resolveEditorLayerAsset(layer) {
        if (layer.type !== 'product_slot') return getEditorAsset(layer.assetId);
        return getEditorAsset(state.slotPreviewAssetIds.get(layer.id)) || getEditorAsset(state.previewAssetId) || getEditorAsset(layer.assetId);
    }
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = reject; image.src = url;
        });
    }
    async function createNode(layer) {
        const asset = resolveEditorLayerAsset(layer);
        if (!asset && layer.type !== 'product_slot') return null;
        try {
            const image = asset ? await loadImage(assetUrl(asset.storagePath)) : null;
            const node = image ? makeImageNode(image, layer, layer.frame) : new Konva.Rect({ x: layer.frame.x, y: layer.frame.y, width: layer.frame.width, height: layer.frame.height, offsetX: layer.frame.width/2, offsetY: layer.frame.height/2, rotation: layer.frame.rotation||0, fill:'rgba(0,0,0,0)', draggable:!layer.locked });
            node.setAttr('mockupLayerId', layer.id);
            node.on('click tap', (event) => { event.cancelBubble = true; selectLayer(layer.id, Boolean(event.evt && (event.evt.ctrlKey || event.evt.metaKey))); });
            node.on('dragstart', () => node.setAttr('historyBefore', editorSnapshot()));
            node.on('dragmove transform', renderSelectionMarkers);
            node.on('dragend', () => { updateFrameFromNode(layer, node, false); recordHistory(node.getAttr('historyBefore')); renderInspector(); renderSelectionMarkers(); });
            node.on('transformstart', () => node.setAttr('historyBefore', editorSnapshot()));
            node.on('transformend', () => { updateFrameFromNode(layer, node, true); recordHistory(node.getAttr('historyBefore')); renderInspector(); renderSelectionMarkers(); });
            state.contentLayer.add(node); state.nodes.set(layer.id, node); return node;
        } catch (error) { setStatus('Görsel yüklenemedi: ' + (asset ? asset.name : layer.name), true); return null; }
    }
    function makeImageNode(image, layer, frame) {
        const perspective = layer.type === 'product_slot' && frame.perspective && frame.perspective.enabled;
        const polygon = layer.type === 'foreground_polygon';
        const renderedImage = perspective ? renderPerspectiveBitmap(image, frame) : (polygon ? renderPolygonBitmap(image, layer.geometry) : image);
        const node = new Konva.Image(perspective || polygon
            ? { image: renderedImage, x: 0, y: 0, width: SIZE, height: SIZE, opacity: frame.opacity == null ? 1 : frame.opacity, visible: layer.visible !== false, draggable: false, listening: false }
            : { image: renderedImage, x: frame.x, y: frame.y, width: frame.width, height: frame.height, offsetX: frame.width / 2, offsetY: frame.height / 2, rotation: frame.rotation || 0, opacity: frame.opacity == null ? 1 : frame.opacity, visible: layer.visible !== false, draggable: !layer.locked && layer.type !== 'scene_background' });
        node.setAttr('mockupSourceImage', image);
        applyEffects(node, frame, layer.type); return node;
    }
    function applyEffects(node, frame, layerType) {
        const shadow = frame.shadow || defaultFrame().shadow;
        node.opacity(frame.opacity == null ? 1 : frame.opacity); node.shadowEnabled(Boolean(shadow.enabled));
        node.shadowColor(shadow.color || '#000'); node.shadowOpacity(shadow.opacity == null ? .35 : shadow.opacity); node.shadowBlur(shadow.blur || 0); node.shadowOffset({ x: shadow.offsetX || 0, y: shadow.offsetY || 0 });
        node.clearCache();
        const filters = [];
        if (layerType === 'product_slot') {
            const brightness = Number(frame.brightness || 0);
            const contrast = Number(frame.contrast || 0);
            const saturation = Number(frame.saturation || 0);
            const hue = Number(frame.hue || 0);
            const sharpen = Number(frame.sharpen || 0);
            if (brightness) { node.brightness(brightness / 100); filters.push(Konva.Filters.Brighten); }
            if (contrast) { node.contrast(contrast); filters.push(Konva.Filters.Contrast); }
            if (saturation || hue) {
                node.hue(hue); node.saturation(saturation / 100); node.luminance(0);
                filters.push(Konva.Filters.HSL);
            }
            if (sharpen) { node.setAttr('mockupSharpen', sharpen); filters.push(subtleSharpen); }
        }
        if ((frame.blur || 0) > 0) { node.blurRadius(frame.blur); filters.push(Konva.Filters.Blur); }
        if (filters.length) { node.cache({ pixelRatio: 1 }); node.filters(filters); }
        else node.filters([]);
    }
    function refreshSpecialNode(layer) {
        const node = state.nodes.get(layer.id), source = node && node.getAttr('mockupSourceImage');
        if (!node || !source) return;
        if (layer.type === 'product_slot' && layer.frame.perspective && layer.frame.perspective.enabled) node.image(renderPerspectiveBitmap(source, layer.frame));
        if (layer.type === 'foreground_polygon') node.image(renderPolygonBitmap(source, layer.geometry));
        applyEffects(node, layer.frame, layer.type);
        node.getLayer().batchDraw();
    }
    function updateFrameFromNode(layer, node, transformed) {
        if ((layer.type === 'product_slot' && layer.frame.perspective && layer.frame.perspective.enabled) || layer.type === 'foreground_polygon') return;
        const f = layer.frame; f.x = Math.round(node.x()); f.y = Math.round(node.y()); f.rotation = Math.round(node.rotation() * 10) / 10;
        if (transformed) { f.width = Math.max(40, Math.round(node.width() * node.scaleX())); f.height = Math.max(40, Math.round(node.height() * node.scaleY())); node.scale({ x: 1, y: 1 }); node.size({ width: f.width, height: f.height }); node.offset({ x: f.width / 2, y: f.height / 2 }); applyEffects(node, f, layer.type); }
    }
    function syncOrder() {
        state.baseRect.moveToBottom(); state.editor.document.layers.forEach((layer, i) => { const node = state.nodes.get(layer.id); if (node) node.zIndex(i + 1); }); state.contentLayer.batchDraw(); renderSelectionMarkers();
    }
    function renderPerspectiveControls(layer) {
        const corners = layer.frame.perspective.corners;
        const line = new Konva.Line({ points: corners.flatMap((point) => [point.x, point.y]), closed: true, stroke: '#8e44ad', strokeWidth: 7, dash: [18, 10], fill: 'rgba(142,68,173,.05)', listening: false });
        state.uiLayer.add(line); state.perspectiveHandles.set(layer.id + '-line', line);
        renderSlotLabel(layer, corners[0], true);
        corners.forEach((point, index) => {
            const handle = new Konva.Circle({ x: point.x, y: point.y, radius: 12, fill: '#fff', stroke: '#8e44ad', strokeWidth: 6, hitStrokeWidth: 22, draggable: !layer.locked, name: 'ms-perspective-handle' });
            handle.on('dragstart', () => handle.setAttr('historyBefore', editorSnapshot()));
            handle.on('dragmove', () => {
                point.x = Math.round(handle.x()); point.y = Math.round(handle.y());
                line.points(corners.flatMap((item) => [item.x, item.y]));
                refreshSpecialNode(layer); state.uiLayer.batchDraw();
            });
            handle.on('dragend', () => { recordHistory(handle.getAttr('historyBefore')); renderInspector(); });
            state.uiLayer.add(handle); state.perspectiveHandles.set(layer.id + '-' + index, handle);
        });
    }

    function renderSlotLabel(layer, point, selected) {
        const label = new Konva.Label({ x: point.x + 8, y: point.y - 30, listening: false });
        label.add(new Konva.Tag({ fill: selected ? '#8e44ad' : '#243746', cornerRadius: 5, opacity: .92 }));
        label.add(new Konva.Text({ text: layer.name, fontSize: 28, fontStyle: 'bold', padding: 8, fill: '#fff' }));
        state.uiLayer.add(label); state.selectionMarkers.set(layer.id + '-label', label);
    }

    function renderPolygonControls(layer) {
        const geometry = normalizePolygonGeometry(layer.geometry, layer.assetId); layer.geometry = geometry;
        const points = geometry.points;
        if (state.polygonDrawingLayerId === layer.id && !geometry.closed) {
            const capture = new Konva.Rect({ x: 0, y: 0, width: SIZE, height: SIZE, fill: 'rgba(0,0,0,0.001)' });
            capture.on('click tap', (event) => { event.cancelBubble = true; addPolygonPointFromPointer(layer); });
            state.uiLayer.add(capture); state.polygonHandles.set(layer.id + '-capture', capture);
        }
        if (points.length) {
            const line = new Konva.Line({ points: points.flatMap((point) => [point.x, point.y]), closed: geometry.closed, stroke: '#16a085', strokeWidth: 6, dash: geometry.closed ? [] : [16, 10], fill: geometry.closed ? 'rgba(22,160,133,.08)' : undefined, listening: false });
            state.uiLayer.add(line); state.polygonHandles.set(layer.id + '-line', line);
            points.forEach((point, index) => {
                const handle = new Konva.Circle({ x: point.x, y: point.y, radius: 15, fill: '#fff', stroke: '#16a085', strokeWidth: 6, draggable: !layer.locked });
                handle.on('dragstart', () => handle.setAttr('historyBefore', editorSnapshot()));
                handle.on('dragmove', () => {
                    point.x = Math.round(handle.x()); point.y = Math.round(handle.y());
                    line.points(points.flatMap((item) => [item.x, item.y]));
                    refreshSpecialNode(layer); state.uiLayer.batchDraw();
                });
                handle.on('dragend', () => recordHistory(handle.getAttr('historyBefore')));
                state.uiLayer.add(handle); state.polygonHandles.set(layer.id + '-' + index, handle);
            });
        }
    }

    function handleStagePolygonPoint(event) {
        const layer = state.editor && state.editor.document.layers.find((item) => item.id === state.polygonDrawingLayerId);
        if (!layer || layer.locked || layer.geometry.closed || event.target !== state.stage) return;
        addPolygonPointFromPointer(layer);
    }
    function addPolygonPointFromPointer(layer) {
        const pointer = state.stage.getPointerPosition(); if (!pointer) return;
        const before = editorSnapshot();
        layer.geometry.points.push({ x: Math.round(pointer.x / state.scale), y: Math.round(pointer.y / state.scale) });
        recordHistory(before); refreshSpecialNode(layer); renderSelectionMarkers(); renderInspector();
    }
    function renderSelectionMarkers() {
        if (!state.uiLayer || !state.editor) return;
        state.selectionMarkers.forEach((marker) => marker.destroy());
        state.selectionMarkers.clear();
        state.perspectiveHandles.forEach((marker) => marker.destroy()); state.perspectiveHandles.clear();
        state.polygonHandles.forEach((marker) => marker.destroy()); state.polygonHandles.clear();
        state.editor.document.layers.forEach((layer) => {
            if (layer.type !== 'product_slot' || layer.visible === false) return;
            const node = state.nodes.get(layer.id);
            if (!node) return;
            const selected = state.selectedLayerIds.has(layer.id);
            if (layer.type === 'product_slot' && layer.frame.perspective && layer.frame.perspective.enabled) {
                if (selected) renderPerspectiveControls(layer);
                else {
                    const corners = layer.frame.perspective.corners;
                    const marker = new Konva.Line({ points: corners.flatMap((point) => [point.x, point.y]), closed: true, stroke: '#263746', strokeWidth: 4, dash: [14, 9], listening: false });
                    state.uiLayer.add(marker); state.selectionMarkers.set(layer.id, marker); renderSlotLabel(layer, corners[0], false);
                }
                return;
            }
            const marker = new Konva.Rect({
                x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY(),
                offsetX: node.width() * node.scaleX() / 2, offsetY: node.height() * node.scaleY() / 2,
                rotation: node.rotation(), stroke: selected ? '#8e44ad' : '#263746', strokeWidth: selected ? 7 : 4, dash: selected ? [18, 10] : [13, 8], listening: false
            });
            state.uiLayer.add(marker); marker.moveToBottom(); state.selectionMarkers.set(layer.id, marker);
            renderSlotLabel(layer, { x: node.x() - node.width()/2, y: node.y() - node.height()/2 }, selected);
        });
        const selectedPolygon = state.editor.document.layers.find((layer) => layer.id === state.selectedLayerId && layer.type === 'foreground_polygon' && layer.visible !== false);
        if (selectedPolygon && state.nodes.get(selectedPolygon.id)) renderPolygonControls(selectedPolygon);
        state.transformer.moveToTop(); state.uiLayer.batchDraw();
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
        const special = layer && ((layer.type === 'product_slot' && layer.frame.perspective && layer.frame.perspective.enabled) || layer.type === 'foreground_polygon');
        state.transformer.nodes(layer && node && !special && !layer.locked && layer.visible ? [node] : []);
        state.transformer.find('Rect').forEach((anchor) => anchor.hitStrokeWidth(28));
        renderSelectionMarkers(); state.uiLayer.batchDraw(); renderLayers(); renderInspector(); updateSlotBindingButton();
    }

    function renderInspector() {
        const root = document.getElementById('msInspector'); if (!root || !state.editor) return;
        const layer = state.editor.document.layers.find((l) => l.id === state.selectedLayerId);
        if (!layer) { root.innerHTML = '<div class="ms-empty">Bir katman seçin.</div>'; return; }
        const f = layer.frame;
        const isProduct = layer.type === 'product_slot';
        const isPolygon = layer.type === 'foreground_polygon';
        const perspectiveEnabled = Boolean(isProduct && f.perspective && f.perspective.enabled);
        const transformFields = perspectiveEnabled || isPolygon ? '' : `${numberField('X','x',f.x,-2000,4000)}${numberField('Y','y',f.y,-2000,4000)}${numberField('Genişlik','width',f.width,40,4000)}${numberField('Yükseklik','height',f.height,40,4000)}${rangeField('Dönüş','rotation',f.rotation||0,-180,180,'°')}`;
        const previewAsset = isProduct ? resolveEditorLayerAsset(layer) : null;
        const productAdjustments = isProduct ? `<div class="ms-product-controls"><h4>ÜRÜN GÖRSEL AYARLARI</h4><div class="ms-selected-product-preview">${previewAsset?`<img src="${assetUrl(previewAsset.storagePath)}" alt="${esc(previewAsset.name)}"><span>${esc(previewAsset.name)}</span>`:'<span>Örnek ürün seçilmedi</span>'}</div>${rangeField('Opaklık','opacity',Math.round((f.opacity==null?1:f.opacity)*100),0,100,'%')}${rangeField('Blur','blur',f.blur||0,0,80,' px')}${rangeField('Parlaklık','brightness',f.brightness||0,-100,100,'%')}${rangeField('Kontrast','contrast',f.contrast||0,-100,100,'%')}${rangeField('Doygunluk','saturation',f.saturation||0,-100,100,'%')}${rangeField('Hue','hue',f.hue||0,-180,180,'°')}${rangeField('Keskinlik','sharpen',f.sharpen||0,0,20,'%')}<button id="msResetProductVisuals" class="ms-btn ms-full">Tüm ürün ayarlarını sıfırla</button><small class="ms-help">Slider veya sayı kutusunu kullanın. Shift + yön tuşu 0,1 hassasiyetle ayarlar.</small></div>` : '';
        const perspectiveTools = isProduct ? `<div class="ms-section"><h4>PERSPEKTİF SLOTU</h4><label class="ms-check"><input id="msPerspectiveToggle" type="checkbox" ${perspectiveEnabled?'checked':''}> Dört köşeli perspektifi aç</label>${perspectiveEnabled ? `${rangeField('Güvenli iç boşluk','smartPadding',(f.smartFit&&f.smartFit.padding)||0,0,30,'%')}<button id="msSmartPlaceBtn" class="ms-btn ms-btn-primary ms-full">Akıllı yerleştir</button><button id="msResetPerspectiveBtn" class="ms-btn ms-full">Köşeleri sıfırla</button><small class="ms-help">Mor köşeleri tuval üzerinde sürükleyin. Akıllı yerleştirme şeffaf kenarları algılar.</small>` : '<small class="ms-help">Açıldığında mevcut konum ve dönüş dört düzenlenebilir köşeye çevrilir.</small>'}</div>` : '';
        const polygonTools = isPolygon ? `<div class="ms-section"><h4>POLİGON MASKESİ</h4><p class="ms-help">${layer.geometry.points.length} nokta • ${layer.geometry.closed?'Kapalı':'Çiziliyor'}</p><button id="msPolygonDrawBtn" class="ms-btn ms-full">Nokta eklemeye devam et</button><button id="msPolygonCloseBtn" class="ms-btn ms-btn-primary ms-full" ${layer.geometry.points.length<3?'disabled':''}>Poligonu kapat</button><button id="msPolygonUndoPointBtn" class="ms-btn ms-full" ${!layer.geometry.points.length?'disabled':''}>Son noktayı sil</button><button id="msPolygonResetBtn" class="ms-btn ms-btn-danger ms-full">Poligonu sıfırla</button></div>` : '';
        const commonVisuals = isProduct ? '' : `${rangeField('Opaklık','opacity',Math.round((f.opacity==null?1:f.opacity)*100),0,100,'%')}${rangeField('Blur','blur',f.blur||0,0,80,' px')}`;
        const shadowTools = `<div class="ms-section"><h4>GÖLGE</h4><label class="ms-check"><input id="msShadowToggle" type="checkbox" ${f.shadow.enabled?'checked':''}> Gölgeyi aç</label>${rangeField('Açı','shadowAngle',f.shadow.angle||0,0,360,'°')}${rangeField('Mesafe','shadowDistance',f.shadow.distance||0,0,300,' px')}${numberField('X ofset','shadowOffsetX',f.shadow.offsetX||0,-300,300)}${numberField('Y ofset','shadowOffsetY',f.shadow.offsetY||0,-300,300)}${rangeField('Blur / yumuşaklık','shadowBlur',f.shadow.blur||0,0,120,' px')}${rangeField('Opaklık','shadowOpacity',Math.round((f.shadow.opacity==null?.35:f.shadow.opacity)*100),0,100,'%')}<div class="ms-field"><label for="msShadowColor">Renk</label><div class="ms-control-inputs"><input id="msShadowColor" type="color" value="${esc(f.shadow.color||'#000000')}"><button type="button" class="ms-control-reset" data-reset-frame-key="shadowColor">Sıfırla</button></div></div></div>`;
        root.innerHTML = `<h4>${esc(layer.name)}</h4>${productAdjustments}${transformFields}${commonVisuals}
            ${perspectiveTools}${polygonTools}${shadowTools}
            ${layer.type==='product_slot'?'<button id="msDuplicateLayer" class="ms-btn ms-btn-primary ms-full">Slotu çoğalt</button>':''}<button id="msRemoveLayer" class="ms-btn ms-btn-danger ms-full">Katmanı sil</button>`;
        root.querySelectorAll('[data-frame-key]').forEach(bindFrameInput);
        root.querySelectorAll('[data-reset-frame-key]').forEach((button) => button.addEventListener('click', () => resetFrameControl(layer, button.dataset.resetFrameKey)));
        document.getElementById('msShadowToggle').addEventListener('change', (e) => { const before=editorSnapshot(); f.shadow.enabled=e.target.checked; updateNode(layer); recordHistory(before); });
        const shadowColor = document.getElementById('msShadowColor'); let shadowColorBefore = null;
        if (shadowColor) { const rememberColor=()=>{shadowColorBefore=shadowColorBefore||editorSnapshot();};shadowColor.addEventListener('pointerdown',rememberColor);shadowColor.addEventListener('focus',rememberColor);shadowColor.addEventListener('input', () => { f.shadow.color=shadowColor.value; updateNode(layer); });shadowColor.addEventListener('change', () => {recordHistory(shadowColorBefore);shadowColorBefore=null;}); }
        const reset = document.getElementById('msResetProductVisuals');
        if (reset) reset.addEventListener('click', () => {
            const before = editorSnapshot();
            Object.assign(f, { opacity: 1, blur: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, sharpen: 0, shadow: clone(defaultFrame().shadow) });
            updateNode(layer); recordHistory(before); renderInspector();
        });
        const dup = document.getElementById('msDuplicateLayer'); if (dup) dup.addEventListener('click', () => duplicateLayer(layer));
        const perspectiveToggle = document.getElementById('msPerspectiveToggle'); if (perspectiveToggle) perspectiveToggle.addEventListener('change', () => togglePerspective(layer, perspectiveToggle.checked));
        const smartPlace = document.getElementById('msSmartPlaceBtn'); if (smartPlace) smartPlace.addEventListener('click', () => smartPlaceProduct(layer));
        const resetPerspective = document.getElementById('msResetPerspectiveBtn'); if (resetPerspective) resetPerspective.addEventListener('click', () => resetPerspectiveCorners(layer));
        const polygonDraw = document.getElementById('msPolygonDrawBtn'); if (polygonDraw) polygonDraw.addEventListener('click', () => { const before=editorSnapshot(); layer.geometry.closed=false; state.polygonDrawingLayerId=layer.id; recordHistory(before); refreshSpecialNode(layer); renderInspector(); renderSelectionMarkers(); });
        const polygonClose = document.getElementById('msPolygonCloseBtn'); if (polygonClose) polygonClose.addEventListener('click', () => closePolygon(layer));
        const polygonUndo = document.getElementById('msPolygonUndoPointBtn'); if (polygonUndo) polygonUndo.addEventListener('click', () => removeLastPolygonPoint(layer));
        const polygonReset = document.getElementById('msPolygonResetBtn'); if (polygonReset) polygonReset.addEventListener('click', () => resetPolygon(layer));
        document.getElementById('msRemoveLayer').addEventListener('click', () => removeLayer(layer));
    }
    async function replaceLayerNode(layer) {
        const oldNode = state.nodes.get(layer.id); if (oldNode) oldNode.destroy(); state.nodes.delete(layer.id);
        await createNode(layer); syncOrder(); selectLayer(layer.id); renderEditor();
    }
    async function togglePerspective(layer, enabled) {
        const before = editorSnapshot();
        layer.frame.perspective = normalizePerspective(layer.frame.perspective || { corners: rotatedRectangleCorners(layer.frame) }, layer.frame);
        layer.frame.perspective.enabled = enabled;
        layer.frame.smartFit = normalizeSmartFit(layer.frame.smartFit || {});
        recordHistory(before); await replaceLayerNode(layer);
        setStatus(enabled ? 'Perspektif modu açıldı; dört köşeyi sürükleyebilirsiniz.' : 'Normal dikdörtgen dönüşümüne dönüldü.', false);
    }
    async function resetPerspectiveCorners(layer) {
        const before = editorSnapshot(); layer.frame.perspective.corners = rotatedRectangleCorners(layer.frame); recordHistory(before);
        refreshSpecialNode(layer); renderSelectionMarkers(); renderInspector();
    }
    function alphaBounds(image) {
        const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight;
        const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
        const canvas = makeCanvas(sourceWidth * scale, sourceHeight * scale), context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
        for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
            if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
        }
        if (right < left || bottom < top) return { x: 0, y: 0, width: 1, height: 1 };
        return { x: left / canvas.width, y: top / canvas.height, width: (right - left + 1) / canvas.width, height: (bottom - top + 1) / canvas.height };
    }
    function smartPlaceProduct(layer) {
        const node = state.nodes.get(layer.id), image = node && node.getAttr('mockupSourceImage');
        if (!image || !layer.frame.perspective || !layer.frame.perspective.enabled) return setStatus('Akıllı yerleştirme için perspektif modunu açın.', true);
        try {
            const before = editorSnapshot();
            layer.frame.smartFit = normalizeSmartFit(layer.frame.smartFit || {}); layer.frame.smartFit.crop = alphaBounds(image);
            recordHistory(before); refreshSpecialNode(layer); renderInspector();
            setStatus('Şeffaf kenarlar algılandı ve ürün perspektif slotuna yerleştirildi.', false);
        } catch (error) { setStatus('Ürün şeffaf alanı analiz edilemedi: ' + error.message, true); }
    }
    function closePolygon(layer) {
        if (layer.geometry.points.length < 3) return setStatus('Poligonu kapatmak için en az 3 nokta gerekir.', true);
        const before = editorSnapshot(); layer.geometry.closed = true; state.polygonDrawingLayerId = null; recordHistory(before);
        refreshSpecialNode(layer); renderInspector(); renderSelectionMarkers(); setStatus('Foreground poligonu kapatıldı.', false);
    }
    function removeLastPolygonPoint(layer) {
        if (!layer.geometry.points.length) return;
        const before = editorSnapshot(); layer.geometry.points.pop(); layer.geometry.closed = false; state.polygonDrawingLayerId = layer.id; recordHistory(before);
        refreshSpecialNode(layer); renderInspector(); renderSelectionMarkers();
    }
    function resetPolygon(layer) {
        const before = editorSnapshot(); layer.geometry.points = []; layer.geometry.closed = false; state.polygonDrawingLayerId = layer.id; recordHistory(before);
        refreshSpecialNode(layer); renderInspector(); renderSelectionMarkers(); setStatus('Poligon sıfırlandı; tuvale tıklayarak yeniden çizin.', false);
    }
    const CONTROL_DEFAULTS = { opacity:100, blur:0, brightness:0, contrast:0, saturation:0, hue:0, sharpen:0, rotation:0, smartPadding:0, shadowAngle:56, shadowDistance:22, shadowOffsetX:12, shadowOffsetY:18, shadowBlur:24, shadowOpacity:35, shadowColor:'#000000' };
    function numberField(label,key,value,min,max) { return `<div class="ms-field"><label>${label}</label><div class="ms-control-inputs"><input data-frame-key="${key}" type="number" step="0.1" min="${min}" max="${max}" value="${Math.round(value*10)/10}"><button type="button" class="ms-control-reset" data-reset-frame-key="${key}">Sıfırla</button></div></div>`; }
    function rangeField(label,key,value,min,max,suffix) { return `<div class="ms-field"><label><span>${label}</span><span class="ms-field-value">${Math.round(value*10)/10}${suffix}</span></label><div class="ms-control-inputs"><input data-frame-key="${key}" data-suffix="${suffix}" type="range" step="0.1" min="${min}" max="${max}" value="${value}"><input data-frame-key="${key}" data-suffix="${suffix}" class="ms-control-number" type="number" step="0.1" min="${min}" max="${max}" value="${Math.round(value*10)/10}"><button type="button" class="ms-control-reset" data-reset-frame-key="${key}">Sıfırla</button></div></div>`; }
    function syncControlInputs(root,key,value) {
        root.querySelectorAll(`[data-frame-key="${key}"]`).forEach((field) => { if (document.activeElement!==field || Number(field.value)!==value) field.value=Math.round(value*10)/10; });
        const label=root.querySelector(`[data-frame-key="${key}"]`)?.closest('.ms-field')?.querySelector('.ms-field-value'); if(label)label.textContent=Math.round(value*10)/10+(root.querySelector(`[data-frame-key="${key}"]`)?.dataset.suffix||'');
    }
    function setFrameControlValue(layer,key,value) {
        const f=layer.frame; f.shadow=normalizeShadow(f.shadow);
        if(key==='opacity') f.opacity=value/100;
        else if(key==='shadowOpacity') f.shadow.opacity=value/100;
        else if(key==='shadowBlur') f.shadow.blur=value;
        else if(key==='shadowAngle'||key==='shadowDistance') { if(key==='shadowAngle')f.shadow.angle=value;else f.shadow.distance=value;const radians=f.shadow.angle*Math.PI/180;f.shadow.offsetX=Math.round(Math.cos(radians)*f.shadow.distance*10)/10;f.shadow.offsetY=Math.round(Math.sin(radians)*f.shadow.distance*10)/10; }
        else if(key==='shadowOffsetX'||key==='shadowOffsetY') { if(key==='shadowOffsetX')f.shadow.offsetX=value;else f.shadow.offsetY=value;f.shadow.distance=Math.round(Math.hypot(f.shadow.offsetX,f.shadow.offsetY)*10)/10;f.shadow.angle=Math.round((((Math.atan2(f.shadow.offsetY,f.shadow.offsetX)*180/Math.PI)+360)%360)*10)/10; }
        else if(key==='smartPadding') { f.smartFit=normalizeSmartFit(f.smartFit||{});f.smartFit.padding=value; }
        else f[key]=value;
    }
    function bindFrameInput(input) {
        let before = null;
        const remember = () => { if (!before) before = editorSnapshot(); };
        input.addEventListener('pointerdown', remember); input.addEventListener('focus', remember);
        input.addEventListener('keydown', (event) => { if(input.type==='range'&&event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight'||event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();remember();const direction=(event.key==='ArrowRight'||event.key==='ArrowUp')?1:-1;input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),Number(input.value)+direction*.1)));input.dispatchEvent(new Event('input',{bubbles:true}));} });
        input.addEventListener('input', () => {
            const layer = state.editor.document.layers.find((l) => l.id === state.selectedLayerId); if (!layer) return;
            const key=input.dataset.frameKey, value=Number(input.value); setFrameControlValue(layer,key,value); syncControlInputs(document.getElementById('msInspector'),key,value);
            if(key.startsWith('shadow')) { syncControlInputs(document.getElementById('msInspector'),'shadowAngle',layer.frame.shadow.angle);syncControlInputs(document.getElementById('msInspector'),'shadowDistance',layer.frame.shadow.distance);syncControlInputs(document.getElementById('msInspector'),'shadowOffsetX',layer.frame.shadow.offsetX);syncControlInputs(document.getElementById('msInspector'),'shadowOffsetY',layer.frame.shadow.offsetY); }
            updateNode(layer);
        });
        input.addEventListener('change', () => { recordHistory(before); before=null; });
    }
    function resetFrameControl(layer,key) { const before=editorSnapshot(); if(key==='shadowColor')layer.frame.shadow.color=CONTROL_DEFAULTS.shadowColor;else setFrameControlValue(layer,key,CONTROL_DEFAULTS[key]??0);recordHistory(before);updateNode(layer);renderInspector(); }
    function updateNode(layer) { const node=state.nodes.get(layer.id); if(!node)return; const f=layer.frame; if((layer.type==='product_slot'&&f.perspective&&f.perspective.enabled)||layer.type==='foreground_polygon'){refreshSpecialNode(layer);}else{node.position({x:f.x,y:f.y});node.size({width:f.width,height:f.height});node.offset({x:f.width/2,y:f.height/2});node.rotation(f.rotation||0);applyEffects(node,f,layer.type);} state.transformer.forceUpdate(); renderSelectionMarkers(); state.stage.batchDraw(); }
    function nextSlotName() { return 'Slot ' + (state.editor.document.layers.filter((layer) => layer.type === 'product_slot').length + 1); }
    function offsetSlotCopy(source) {
        const copy = clone(source); copy.id = uid(); copy.name = nextSlotName(); copy.frame.x += 25; copy.frame.y += 25;
        if (copy.frame.perspective && copy.frame.perspective.corners) copy.frame.perspective.corners.forEach((point) => { point.x += 25; point.y += 25; });
        return copy;
    }
    function copySelectedSlot() {
        const layer = state.editor.document.layers.find((item) => item.id === state.selectedLayerId && item.type === 'product_slot');
        if (!layer) return setStatus('Kopyalamak için bir slot seçin.', true);
        state.clipboardLayer = clone(layer); setStatus(`${layer.name} kopyalandı. Ctrl/Cmd+V ile yapıştırabilirsiniz.`, false);
    }
    async function pasteCopiedSlot() {
        if (!state.clipboardLayer) return setStatus('Yapıştırılacak bir slot yok. Önce Ctrl/Cmd+C kullanın.', true);
        const before = editorSnapshot(), copy = offsetSlotCopy(state.clipboardLayer);
        state.editor.document.layers.push(copy); state.selectedLayerId = copy.id; state.selectedLayerIds = new Set([copy.id]); recordHistory(before);
        await createNode(copy); syncOrder(); selectLayer(copy.id); renderEditor(); setStatus(`${copy.name} yapıştırıldı.`, false);
    }
    async function duplicateSelectedSlot() {
        const layer = state.editor.document.layers.find((item) => item.id === state.selectedLayerId && item.type === 'product_slot');
        if (!layer) return setStatus('Çoğaltmak için bir slot seçin.', true);
        await duplicateLayer(layer);
    }
    async function duplicateLayer(layer) {
        const before=editorSnapshot(), copy=offsetSlotCopy(layer); state.editor.document.layers.push(copy);
        const previewId = state.slotPreviewAssetIds.get(layer.id); if (previewId) state.slotPreviewAssetIds.set(copy.id, previewId);
        state.selectedLayerId=copy.id; state.selectedLayerIds=new Set([copy.id]); recordHistory(before); await createNode(copy); syncOrder(); selectLayer(copy.id); renderEditor(); setStatus(`${copy.name} çoğaltıldı.`,false);
    }
    function removeLayer(layer) { const before=editorSnapshot(), index=state.editor.document.layers.findIndex((l)=>l.id===layer.id); if(index<0)return; const node=state.nodes.get(layer.id); if(node)node.destroy(); state.nodes.delete(layer.id); state.editor.document.layers.splice(index,1); state.selectedLayerIds.delete(layer.id); state.selectedLayerId=[...state.selectedLayerIds].pop()||null; if(state.polygonDrawingLayerId===layer.id)state.polygonDrawingLayerId=null; state.transformer.nodes([]); recordHistory(before); state.stage.batchDraw(); renderEditor(); }

    async function exportEditorBlob(targetSize) {
        if (!state.stage) return null;
        const selected = state.selectedLayerId; state.transformer.nodes([]); state.uiLayer.hide(); state.stage.draw();
        try { return await ensurePngBlob(await state.stage.toBlob({ x:0,y:0,width:state.stage.width(),height:state.stage.height(),pixelRatio:targetSize/state.stage.width(),mimeType:'image/png' })); }
        finally { state.uiLayer.show(); if(selected) selectLayer(selected); state.stage.draw(); }
    }

    async function ensurePngBlob(data) {
        if (!data) return null;
        const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
        return new Blob([bytes], { type: 'image/png' });
    }

    async function uploadFile(file, type, templateId) {
        const dimensions = await readDimensions(file); const asset = await uploadBlob(file, type, file.name, templateId, file.type); if (!asset) return null; asset.width=dimensions.width; asset.height=dimensions.height; return asset;
    }
    async function uploadBlob(blob, type, filename, templateId, mimeType, throwOnError) {
        try {
            if (!blob || !blob.size) throw new Error('Yüklenecek dosya boş olamaz.');
            if (blob.size > 20*1024*1024) throw new Error('Dosya boyutu en fazla 20 MB olabilir.');
            const contentType=mimeType||blob.type||'application/octet-stream';
            setUploadProgress(true,0,`${filename} • ${formatFileSize(blob.size)}`);
            const signed=await api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_signed_upload',asset_type:type,filename,mime_type:contentType,size_bytes:blob.size,template_id:templateId||null})});
            await uploadDirectToSignedUrl(signed.upload_url,blob,filename,(percent)=>setUploadProgress(true,percent,`${filename} • ${formatFileSize(blob.size)}`));
            setUploadProgress(true,100,`${filename} • metadata kaydediliyor`);
            const data=await api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete_signed_upload',upload_ticket:signed.upload_ticket})});
            setUploadProgress(false,100,'');
            return normalizeAsset(data.asset);
        } catch(error) {
            setUploadProgress(false,0,'');
            console.error('[Mockup Studio upload]', { type, size: blob && blob.size, message: error.message });
            if (throwOnError) throw error;
            setStatus(`Dosya yüklenemedi (${formatFileSize(blob&&blob.size||0)}): ${error.message}`,true);
            return null;
        }
    }
    function uploadDirectToSignedUrl(url,blob,filename,onProgress) {
        return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url,true);xhr.setRequestHeader('x-upsert','false');xhr.upload.onprogress=(event)=>{if(event.lengthComputable&&onProgress)onProgress(Math.round(event.loaded/event.total*100));};xhr.onerror=()=>reject(new Error('Storage bağlantısı kurulamadı.'));xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)return resolve();let message=xhr.responseText||`Storage HTTP ${xhr.status}`;try{const parsed=JSON.parse(message);message=parsed.message||parsed.error||message;}catch(ignore){}reject(new Error(message));};const form=new FormData();form.append('cacheControl','3600');form.append('',blob,filename);xhr.send(form);});
    }
    function setUploadProgress(visible,percent,label){const root=document.getElementById('msUploadProgress');if(!root)return;root.hidden=!visible;document.getElementById('msUploadProgressLabel').textContent=label||'Dosya yükleniyor';document.getElementById('msUploadProgressValue').textContent=`${Math.round(percent||0)}%`;document.getElementById('msUploadProgressBar').style.width=`${Math.max(0,Math.min(100,percent||0))}%`;}
    function formatFileSize(bytes){if(!bytes)return '0 B';const units=['B','KB','MB','GB'];const index=Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));return `${(bytes/Math.pow(1024,index)).toFixed(index?1:0)} ${units[index]}`;}
    function readDimensions(file) { return new Promise((resolve)=>{ const url=URL.createObjectURL(file),img=new Image(); img.onload=()=>{resolve({width:img.naturalWidth,height:img.naturalHeight});URL.revokeObjectURL(url);};img.onerror=()=>{resolve({width:null,height:null});URL.revokeObjectURL(url);};img.src=url; }); }

    function promptTemplateFacts() {
        const slots = state.editor.document.layers.filter((layer) => layer.type === 'product_slot');
        return { slotCount: slots.length, perspectiveCount: slots.filter((layer) => layer.frame.perspective && layer.frame.perspective.enabled).length };
    }
    function buildPromptTexts(spec) {
        const facts = promptTemplateFacts();
        const tr = [`${spec.product || 'ürün'} için profesyonel e-ticaret mockup görseli`, spec.scene && `${spec.scene} sahnesinde`, spec.surface && `${spec.surface} yüzeyi üzerinde`, spec.style && `${spec.style} stilinde`, spec.lighting && `${spec.lighting} ışıklandırma`, spec.camera && `${spec.camera} kamera açısı`, spec.colors && `${spec.colors} renk paleti`, `${facts.slotCount} ürün yerleşim alanı${facts.perspectiveCount ? `, ${facts.perspectiveCount} perspektifli alan` : ''}`, 'gerçekçi temas gölgeleri, doğru ölçek, temiz kenarlar, 2000×2000 kare kompozisyon', spec.negatives && `kaçınılacak öğeler: ${spec.negatives}`].filter(Boolean).join(', ') + '.';
        const en = [`Professional ecommerce mockup image for ${spec.product || 'the product'}`, spec.scene && `in a ${spec.scene} scene`, spec.surface && `placed on ${spec.surface}`, spec.style && `${spec.style} style`, spec.lighting && `${spec.lighting} lighting`, spec.camera && `${spec.camera} camera angle`, spec.colors && `${spec.colors} color palette`, `${facts.slotCount} product placement area${facts.slotCount === 1 ? '' : 's'}${facts.perspectiveCount ? `, ${facts.perspectiveCount} with four-corner perspective` : ''}`, 'realistic contact shadows, accurate scale, clean edges, square 2000x2000 composition', spec.negatives && `avoid: ${spec.negatives}`].filter(Boolean).join(', ') + '.';
        return { tr, en };
    }
    function updateGeneratedPrompts() {
        const spec = state.editor.document.promptSpec = Object.assign(blankPromptSpec(), state.editor.document.promptSpec || {});
        const texts = buildPromptTexts(spec); spec.generatedTr = texts.tr; spec.generatedEn = texts.en;
        const tr = document.getElementById('msPromptTr'), en = document.getElementById('msPromptEn'); if (tr) tr.value = texts.tr; if (en) en.value = texts.en;
    }
    function promptField(label, key, placeholder) {
        return `<div class="ms-field"><label for="msPrompt-${key}">${label}</label><input id="msPrompt-${key}" class="fin-input" data-prompt-key="${key}" value="${esc(state.editor.document.promptSpec[key] || '')}" placeholder="${esc(placeholder)}"></div>`;
    }
    function renderPromptView() {
        const root = document.getElementById('msViewPrompt'); if (!root || !state.editor) return;
        state.editor.document.promptSpec = Object.assign(blankPromptSpec(), state.editor.document.promptSpec || {});
        const facts = promptTemplateFacts();
        root.innerHTML = `<div class="ms-view-header"><div><h3>Mockup Prompt Oluşturucu</h3><p>Harici API kullanmadan Türkçe ve İngilizce üretim promptu hazırlar.</p></div><span class="ms-version-badge">${facts.slotCount} slot • ${facts.perspectiveCount} perspektif</span></div><div class="ms-prompt-grid"><section class="ms-panel"><div class="ms-panel-title">Prompt Bilgileri</div><div class="ms-panel-body">${promptField('Ürün','product','ör. beyaz kozmetik kutusu')}${promptField('Sahne','scene','ör. modern banyo tezgâhı')}${promptField('Yüzey','surface','ör. açık renk traverten')}${promptField('Stil','style','ör. premium ve minimal')}${promptField('Işık','lighting','ör. yumuşak pencere ışığı')}${promptField('Kamera','camera','ör. göz hizasında 50 mm')}${promptField('Renkler','colors','ör. krem, adaçayı, beyaz')}${promptField('İstenmeyen öğeler','negatives','ör. yazı, logo bozulması, ekstra ürün')}</div></section><section class="ms-panel"><div class="ms-panel-title">Oluşturulan Metinler</div><div class="ms-panel-body"><label class="ms-prompt-label">Türkçe</label><textarea id="msPromptTr" class="ms-prompt-output" readonly></textarea><button class="ms-btn ms-btn-primary ms-full" data-copy-prompt="msPromptTr">Türkçe promptu kopyala</button><label class="ms-prompt-label">English</label><textarea id="msPromptEn" class="ms-prompt-output" readonly></textarea><button class="ms-btn ms-btn-primary ms-full" data-copy-prompt="msPromptEn">Copy English prompt</button><small class="ms-help">Metinler şablon snapshot’ına kaydedilir; herhangi bir AI servisine gönderilmez.</small></div></section></div>`;
        root.querySelectorAll('[data-prompt-key]').forEach((input) => { let before = null; input.addEventListener('focus', () => { before = before || editorSnapshot(); }); input.addEventListener('input', () => { state.editor.document.promptSpec[input.dataset.promptKey] = input.value.trim(); updateGeneratedPrompts(); }); input.addEventListener('change', () => { recordHistory(before); before = null; }); });
        root.querySelectorAll('[data-copy-prompt]').forEach((button) => button.addEventListener('click', () => copyPromptText(button.dataset.copyPrompt)));
        updateGeneratedPrompts();
    }
    async function copyPromptText(id) {
        const field = document.getElementById(id); if (!field) return;
        try { if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(field.value); else { field.focus(); field.select(); document.execCommand('copy'); } setStatus('Prompt panoya kopyalandı.', false); }
        catch (error) { setStatus('Prompt kopyalanamadı; metni elle seçebilirsiniz.', true); }
    }

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
    function renderCreateProducts(){const root=document.getElementById('msCreateProducts');if(!root)return;const products=state.products.filter(a=>PRODUCT_TYPES.includes(a.type));root.innerHTML=products.length?'':'<div class="ms-empty">Temiz ürün PNG’si yok.</div>';products.forEach(asset=>{const card=document.createElement('article');card.className='ms-product-card'+(asset.id===state.createProductId?' is-selected':'');card.innerHTML=`<button type="button" class="ms-product-select"><img src="${assetUrl(asset.storagePath)}" alt=""><span>${esc(asset.name)}</span></button><button type="button" class="ms-product-delete ms-btn ms-btn-danger ms-btn-small" aria-label="${esc(asset.name)} ürününü sil">Sil</button>`;card.querySelector('.ms-product-select').addEventListener('click',()=>{state.createProductId=asset.id;renderCreateProducts();updateDefaultOutputName();});card.querySelector('.ms-product-delete').addEventListener('click',()=>deleteProductAsset(asset));root.appendChild(card);});}
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
    async function renderSnapshot(snapshot,product){snapshot=normalizeDocument(snapshot);const host=document.getElementById('msRenderHost');host.innerHTML='';const stage=new Konva.Stage({container:host,width:SIZE,height:SIZE}),layerCanvas=new Konva.Layer();stage.add(layerCanvas);layerCanvas.add(new Konva.Rect({x:0,y:0,width:SIZE,height:SIZE,fill:'#fff',listening:false}));for(const item of snapshot.layers||[]){if(item.visible===false)continue;let asset=item.type==='product_slot'?product:(snapshot.assets||[]).find(a=>a.id===item.assetId);if(!asset||!asset.storagePath)continue;try{const image=await loadImage(assetUrl(asset.storagePath));const node=makeImageNode(image,{type:item.type,visible:true,locked:true,geometry:item.geometry},Object.assign(defaultFrame(),item.frame||{}));node.draggable(false);layerCanvas.add(node);}catch(error){throw new Error('Render varlığı yüklenemedi: '+(asset.name||asset.storagePath));}}layerCanvas.draw();try{return await ensurePngBlob(await stage.toBlob({mimeType:'image/png',pixelRatio:1}));}finally{stage.destroy();host.innerHTML='';}}

    function renderOutputs(){const root=document.getElementById('msViewOutputs');if(!root)return;root.innerHTML=`<div class="ms-view-header"><div><h3>Çıktılar</h3><p>Şablonlardan bağımsız kalıcı mockup görselleri</p></div></div><div id="msOutputGrid" class="ms-card-grid"></div>`;const grid=document.getElementById('msOutputGrid');if(!state.outputs.length){grid.innerHTML='<div class="ms-empty-card">Henüz kayıtlı çıktı yok.</div>';return;}state.outputs.forEach(output=>{const card=document.createElement('article');card.className='ms-library-card';card.innerHTML=`<div class="ms-card-preview"><img src="${assetUrl(output.export_path)}" alt="${esc(output.name)}"></div><div class="ms-card-content"><h4>${esc(output.name)}</h4><p>${esc(output.template_name)} • v${output.template_version}</p><p>${esc(formatDate(output.created_at))}</p><div class="ms-card-actions"><a class="ms-btn ms-btn-primary ms-btn-small" href="${assetUrl(output.export_path)}" download="${safeName(output.name)}.png">İndir</a><button data-action="rename" class="ms-btn ms-btn-small">Adlandır</button><button data-action="rerun" class="ms-btn ms-btn-small">Tekrar Üret</button><button data-action="delete" class="ms-btn ms-btn-danger ms-btn-small">Sil</button></div></div>`;card.querySelector('[data-action="rename"]').addEventListener('click',()=>renameOutput(output));card.querySelector('[data-action="rerun"]').addEventListener('click',()=>rerunOutput(output));card.querySelector('[data-action="delete"]').addEventListener('click',()=>deleteOutput(output));grid.appendChild(card);});}
    async function renameOutput(output){const name=window.prompt('Çıktının yeni adı:',output.name);if(name===null)return;if(!name.trim())return setStatus('Çıktı adı zorunludur.',true);try{await api(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename_output',id:output.id,name:name.trim()})});await loadOutputs();}catch(error){setStatus('Çıktı yeniden adlandırılamadı: '+error.message,true);}}
    async function deleteOutput(output){if(!window.confirm('“'+output.name+'” çıktısı kütüphaneden kaldırılsın mı? Dosya ilk aşamada fiziksel olarak silinmeyecektir.'))return;try{await api(API+'?resource=output&id='+encodeURIComponent(output.id),{method:'DELETE'});await loadOutputs();setStatus('Çıktı yumuşak silindi.',false);}catch(error){setStatus('Çıktı silinemedi: '+error.message,true);}}
    async function rerunOutput(output){const product={id:output.product_asset_id,type:'product_box_clean',name:output.product_name||'Ürün',storagePath:output.product_path};await generateOutput({name:output.name+' Tekrar',templateId:output.template_id,templateName:output.template_name,templateVersion:output.template_version,snapshot:normalizeDocument(output.template_snapshot),product});showView('outputs');}

    installTabHook();
    window.MockupStudio={init};
})();
