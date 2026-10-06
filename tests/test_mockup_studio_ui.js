const { chromium } = require('playwright');
const crypto = require('crypto');
const assert = require('assert');
const fs = require('fs');

const baseUrl = process.env.MOCKUP_TEST_URL || 'http://localhost:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69d9WQAAAABJRU5ErkJggg==', 'base64');
const largePng = Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024 - png.length)]);
const now = () => new Date().toISOString();

const presetFrame = (x, y, width, height, rotation = 0) => ({ x, y, width, height, rotation });
const gridPreset = (id, name, cols, rows) => ({ id, name, is_system: true, created_at: now(), slots: Array.from({ length: cols * rows }, (_, index) => ({ order: index, frame: presetFrame(300 + (index % cols) * (1400 / Math.max(1, cols - 1)), 300 + Math.floor(index / cols) * (1400 / Math.max(1, rows - 1)), cols === 3 ? 430 : 620, cols === 3 ? 430 : 620) })) });
const db = { templates: [], versions: [], products: [], outputs: [], assets: [], storage: new Set(), signed: new Map(), directUploads: [], maxApiPayload: 0, presets: [] };
db.presets.push(gridPreset('10000000-0000-4000-8000-000000000001', '2×2 Düz Grid', 2, 2), gridPreset('10000000-0000-4000-8000-000000000002', '3×3 Düz Grid', 3, 3), { id: '10000000-0000-4000-8000-000000000008', name: 'Tek Büyük Hero Slot', is_system: true, created_at: now(), slots: [{ order: 0, frame: presetFrame(1000, 1000, 1250, 1250) }] });

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    db.maxApiPayload = Math.max(db.maxApiPayload, request.postDataBuffer()?.length || 0);

    if (method === 'GET' && url.searchParams.has('asset')) {
        if (!db.storage.has(url.searchParams.get('asset'))) return json(route, { error: 'Dosya bulunamadı.' }, 404);
        return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    if (method === 'GET') {
        const resource = url.searchParams.get('resource') || 'templates';
        if (resource === 'asset_url') return json(route, { success: true, url: `${url.origin}/api/mockup-studio?asset=${encodeURIComponent(url.searchParams.get('path'))}`, expires_in: 300 });
        if (resource === 'slot_presets') return json(route, { presets: db.presets.filter(preset => !preset.deleted_at) });
        if (resource === 'templates') return json(route, { templates: db.templates.filter(t => !t.deleted_at) });
        if (resource === 'template') return json(route, { template: db.templates.find(t => t.id === url.searchParams.get('id')) });
        if (resource === 'versions') return json(route, { versions: db.versions.filter(v => v.template_id === url.searchParams.get('template_id')).sort((a, b) => b.version_number - a.version_number) });
        if (resource === 'products') return json(route, { products: db.products.filter(product => !product.deleted_at) });
        if (resource === 'outputs') return json(route, { outputs: db.outputs.filter(o => !o.deleted_at) });
    }
    if (method === 'POST' && url.searchParams.get('action') === 'upload') {
        const type = url.searchParams.get('asset_type');
        const id = crypto.randomUUID();
        const asset = {
            id, asset_type: type, original_filename: url.searchParams.get('filename'),
            mime_type: request.headers()['content-type'], storage_path: `${type}/${id}.png`
        };
        db.assets.push(asset);
        db.storage.add(asset.storage_path);
        if (type === 'product_box_clean' || type === 'product_only_clean') db.products.unshift(asset);
        return json(route, { asset }, 201);
    }
    if (method === 'POST' && url.searchParams.get('action') === 'upload_chunk') {
        assert.strictEqual(request.headers()['content-type'], 'image/png', 'Çıktı parçaları image/png gönderilmeli');
        return json(route, { success: true, chunk_index: Number(url.searchParams.get('chunk_index')) }, 201);
    }
    if (method === 'POST') {
        const body = request.postDataJSON();
        if (body.action === 'create_signed_upload') {
            const id = crypto.randomUUID();
            const ticket = crypto.randomUUID();
            const scope = body.asset_type === 'output' ? 'output' : (body.asset_type.startsWith('product_') ? 'product' : 'template');
            const path = `${scope}/${body.template_id || 'library'}/${id}.png`;
            db.signed.set(ticket, { id, path, body, uploaded: false });
            return json(route, { success: true, upload_url: `https://mock-storage.local/${ticket}`, upload_ticket: ticket, storage_path: path, expires_in: 900 }, 201);
        }
        if (body.action === 'complete_signed_upload') {
            const pending = db.signed.get(body.upload_ticket);
            assert(pending?.uploaded, 'Metadata kaydından önce doğrudan Storage yüklemesi tamamlanmalı');
            const asset = { id: pending.id, asset_type: pending.body.asset_type, original_filename: pending.body.filename, mime_type: pending.body.mime_type, size_bytes: pending.body.size_bytes, storage_path: pending.path };
            db.assets.push(asset); db.storage.add(asset.storage_path);
            if (asset.asset_type === 'product_box_clean' || asset.asset_type === 'product_only_clean') db.products.unshift(asset);
            return json(route, { success: true, asset }, 201);
        }
        if (body.action === 'finalize_upload') {
            assert.strictEqual(body.mime_type, 'image/png', 'Finalize işlemi PNG MIME türünü zorlamalı');
            assert(body.filename.endsWith('.png'), 'Çıktı dosya adı .png olmalı');
            const id = crypto.randomUUID();
            const asset = { id, asset_type: 'output', original_filename: body.filename, mime_type: 'image/png', storage_path: `output/library/${id}.png` };
            db.assets.push(asset);
            db.storage.add(asset.storage_path);
            return json(route, { asset }, 201);
        }
        if (body.action === 'save_template') {
            let template = db.templates.find(t => t.id === body.id);
            if (!template) {
                template = { id: body.id, current_version: 0, created_at: now() };
                db.templates.push(template);
            }
            template.name = body.name;
            template.document = body.document;
            template.current_version += 1;
            template.layer_count = body.document.layers.length;
            template.slot_count = body.document.layers.filter(l => l.type === 'product_slot').length;
            template.updated_at = now();
            db.versions.push({ id: crypto.randomUUID(), template_id: template.id, template_name: template.name, version_number: template.current_version, snapshot: JSON.parse(JSON.stringify(template.document)), created_at: now() });
            return json(route, { template });
        }
        if (body.action === 'set_thumbnail') return json(route, { success: true });
        if (body.action === 'create_output') {
            const exportAsset = db.assets.find(a => a.id === body.export_asset_id);
            const productAsset = db.assets.find(a => a.id === body.product_asset_id);
            const output = {
                id: body.id, name: body.name, export_asset_id: body.export_asset_id,
                product_asset_id: body.product_asset_id, template_id: body.template_id,
                template_name: body.template_name, template_version: body.template_version,
                template_snapshot: body.template_snapshot, created_at: now(),
                export_path: exportAsset.storage_path, product_path: productAsset.storage_path,
                product_name: productAsset.original_filename
            };
            db.outputs.unshift(output);
            return json(route, { output }, 201);
        }
        if (body.action === 'save_slot_preset') {
            let preset = db.presets.find(item => item.id === body.id);
            if (!preset) { preset = { id: body.id, created_at: now(), is_system: false }; db.presets.push(preset); }
            Object.assign(preset, { name: body.name, slots: body.slots, deleted_at: null });
            return json(route, { preset });
        }
        if (body.action === 'duplicate_slot_preset') {
            const source = db.presets.find(item => item.id === body.id), preset = { ...JSON.parse(JSON.stringify(source)), id: crypto.randomUUID(), name: body.name, is_system: false, created_at: now() };
            db.presets.push(preset); return json(route, { preset }, 201);
        }
        if (body.action === 'rename_slot_preset') {
            const preset = db.presets.find(item => item.id === body.id); preset.name = body.name; return json(route, { preset });
        }
    }
    if (method === 'DELETE' && url.searchParams.get('resource') === 'product') {
        const id = url.searchParams.get('id');
        const asset = db.assets.find(item => item.id === id);
        if (!asset) return json(route, { error: 'Ürün varlığı bulunamadı.' }, 404);
        const used = db.outputs.some(output => output.product_asset_id === id);
        if (used) {
            asset.deleted_at = now();
            return json(route, { success: true, deleted_id: id, soft_deleted: true, physical_deleted: false, used_by_outputs: true });
        }
        db.assets = db.assets.filter(item => item.id !== id);
        db.products = db.products.filter(item => item.id !== id);
        db.storage.delete(asset.storage_path);
        return json(route, { success: true, deleted_id: id, soft_deleted: false, physical_deleted: true, used_by_outputs: false });
    }
    if (method === 'DELETE' && url.searchParams.get('resource') === 'slot_preset') {
        const preset = db.presets.find(item => item.id === url.searchParams.get('id')); preset.deleted_at = now(); return json(route, { success: true });
    }
    return json(route, { error: 'Unhandled mock request' }, 400);
}

async function mockStorage(route) {
    const request = route.request();
    assert.strictEqual(request.method(), 'PUT', 'Dosya signed URL ile doğrudan PUT edilmelidir');
    const ticket = new URL(request.url()).pathname.slice(1);
    const pending = db.signed.get(ticket);
    assert(pending, 'Signed upload bileti bulunmalı');
    const transferred = request.postDataBuffer()?.length || 0;
    pending.uploaded = true;
    db.directUploads.push({ type: pending.body.asset_type, declaredSize: pending.body.size_bytes, transferred });
    return json(route, { Key: pending.path }, 200);
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.MOCKUP_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
        localStorage.setItem('paraBassAuth', 'true');
        localStorage.setItem('paraBassRole', 'patron');
    });
    await page.route('**/api/mockup-studio**', mockApi);
    await page.route('https://mock-storage.local/**', mockStorage);

    const openMockup = async () => {
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.locator('[data-view="editor"]').click();
    };
    const controlNumber = (key) => page.locator(`[data-frame-key="${key}"][type="number"]`).last();

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await openMockup();

        await page.locator('#msSceneInput').setInputFiles({ name: 'large_open_box_scene.png', mimeType: 'image/png', buffer: largePng });
        await page.getByText(/kaydetmeden slot ekleyebilirsiniz/).waitFor();
        await page.locator('#msNewSlotBtn').click();
        await page.getByText(/Slot 1 sahnenin merkezine eklendi/).waitFor();
        assert.strictEqual(await page.locator('.ms-layer').filter({ hasText: 'Slot 1' }).count(), 1, 'Kaydedilmemiş yeni şablona slot eklenmeli');

        const productInput = page.locator('#msEditorProductInput');
        await productInput.setInputFiles({ name: 'large_product_box_clean.png', mimeType: 'image/png', buffer: largePng });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        assert(await page.locator('.ms-selected-product-preview img').isVisible(), 'Örnek ürün seçili slot panelinde görünmeli');
        await page.locator('#msRemovePreviewBtn').click();
        await page.getByText('Örnek ürün önizlemesi kaldırıldı.').waitFor();
        assert.strictEqual(await page.locator('.ms-selected-product-preview img').count(), 0, 'Örnek ürün kaldırılabilmeli');
        await page.locator('.ms-asset-select').filter({ hasText: 'large_product_box_clean.png' }).click();
        await page.locator('#msPreviewAllBtn').click();
        await page.getByText('Örnek ürün tüm slotlarda önizleniyor.').waitFor();

        await page.locator('.ms-layer').filter({ hasText: 'Slot 1' }).click();
        await controlNumber('brightness').fill('15'); await controlNumber('brightness').press('Tab');
        await controlNumber('blur').fill('3'); await controlNumber('blur').press('Tab');
        await controlNumber('opacity').fill('90'); await controlNumber('opacity').press('Tab');
        await page.locator('body').press('Control+c');
        await page.locator('body').press('Control+v');
        await page.getByText('Slot 2 yapıştırıldı.').waitFor();
        await page.locator('body').press('Control+d');
        await page.getByText('Slot 3 çoğaltıldı.').waitFor();
        const slotRows = page.locator('.ms-layer').filter({ hasText: /Slot \d/ });
        assert.strictEqual(await slotRows.count(), 3, 'Kopyala/yapıştır ve çoğalt ile 3 slot oluşmalı');
        assert.strictEqual(db.directUploads.filter(item => item.declaredSize === largePng.length).length, 2, '20 MB ürün ve sahne doğrudan Storage’a yüklenmeli');
        assert(db.directUploads.filter(item => item.declaredSize === largePng.length).every(item => item.transferred > item.declaredSize), 'Signed upload multipart gövdesi doğrudan Storage endpointine gitmeli');
        assert(db.maxApiPayload < 100000, '20 MB dosya Vercel API payload’una girmemeli');

        const frames = [
            { x: '400', rotation: '-12' },
            { x: '1000', rotation: '0' },
            { x: '1600', rotation: '18' }
        ];
        for (let index = 0; index < frames.length; index += 1) {
            await slotRows.nth(index).click();
            await controlNumber('x').fill(frames[index].x);
            await controlNumber('x').press('Tab');
            await controlNumber('rotation').fill(frames[index].rotation);
            await controlNumber('rotation').press('Tab');
        }

        await slotRows.nth(0).click();
        await controlNumber('brightness').fill('35');
        await controlNumber('brightness').press('Tab');
        await controlNumber('contrast').fill('20');
        await controlNumber('contrast').press('Tab');
        await slotRows.nth(1).click();
        assert.strictEqual(await controlNumber('brightness').inputValue(), '15', 'Kopyalanan slot ürün ayarlarını taşımalı');
        assert.strictEqual(await controlNumber('contrast').inputValue(), '0', 'İkinci slotun kontrastı bağımsız kalmalı');

        await slotRows.nth(0).click();
        await page.locator('#msPerspectiveToggle').check();
        await page.getByText(/Perspektif modu açıldı/).waitFor();
        await controlNumber('smartPadding').fill('8');
        await controlNumber('smartPadding').press('Tab');
        await page.locator('#msSmartPlaceBtn').click();
        await page.getByText(/Şeffaf kenarlar algılandı/).waitFor();
        await page.locator('#msShadowToggle').check();
        await controlNumber('shadowAngle').fill('135'); await controlNumber('shadowAngle').press('Tab');
        await controlNumber('shadowDistance').fill('40'); await controlNumber('shadowDistance').press('Tab');

        await slotRows.nth(1).click();
        await page.locator('#msShadowToggle').check();
        await controlNumber('shadowOffsetX').press('ArrowUp');
        await controlNumber('shadowOffsetX').press('Tab');
        await controlNumber('shadowOffsetY').press('ArrowDown');
        await controlNumber('shadowOffsetY').press('Tab');
        assert.strictEqual(await controlNumber('shadowOffsetX').inputValue(), '12.5', 'Gölge X normal ok tuşuyla 0,5 artmalı');
        assert.strictEqual(await controlNumber('shadowOffsetY').inputValue(), '17.5', 'Gölge Y normal ok tuşuyla 0,5 azalmalı');
        const xInput = controlNumber('x');
        const originalX = await xInput.inputValue();
        await xInput.fill('1450');
        await xInput.press('Tab');
        await page.locator('#msUndoBtn').click();
        await page.waitForFunction(() => document.querySelector('[data-frame-key="x"][type="number"]')?.value !== '1450');
        assert.strictEqual(await controlNumber('x').inputValue(), originalX, 'Undo tek slot değişikliğini geri almalı');
        await page.locator('#msRedoBtn').click();
        await page.waitForFunction(() => document.querySelector('[data-frame-key="x"][type="number"]')?.value === '1450');
        assert.strictEqual(await controlNumber('x').inputValue(), '1450', 'Redo tek slot değişikliğini yinelemeli');

        await page.locator('#msPolygonMaskBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 5);
        const uiCanvas = page.locator('#mockupCanvasHost canvas').last();
        const canvasBox = await uiCanvas.boundingBox();
        for (const [x, y] of [[canvasBox.width * .25, canvasBox.height * .25], [canvasBox.width * .7, canvasBox.height * .28], [canvasBox.width * .5, canvasBox.height * .7]]) await uiCanvas.click({ position: { x, y } });
        await page.locator('#msPolygonCloseBtn').click();
        await page.getByText('Foreground poligonu kapatıldı.').waitFor();
        await page.locator('#msUndoBtn').click();
        await page.getByText(/3 nokta • Çiziliyor/).waitFor();
        await page.locator('#msRedoBtn').click();
        await page.getByText(/3 nokta • Kapalı/).waitFor();
        await page.locator('#msMaskInput').setInputFiles({ name: 'box_front_edge.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 6);

        await page.locator('[data-view="prompt"]').click();
        await page.locator('[data-prompt-key="product"]').fill('beyaz kozmetik kutusu');
        await page.locator('[data-prompt-key="scene"]').fill('modern banyo tezgâhı');
        await page.locator('[data-prompt-key="lighting"]').fill('yumuşak pencere');
        assert.match(await page.locator('#msPromptTr').inputValue(), /beyaz kozmetik kutusu/, 'Türkçe prompt ürün bilgisini içermeli');
        assert.match(await page.locator('#msPromptEn').inputValue(), /four-corner perspective/, 'İngilizce prompt perspektif bilgisini içermeli');
        await page.locator('[data-view="editor"]').click();

        await page.locator('#msEditorName').fill('Test White Box Hero');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        assert.strictEqual(db.templates[0].document.schemaVersion, 3, 'Yeni şablon belgesi schemaVersion 3 olmalı');
        assert.strictEqual(db.templates[0].slot_count, 3, 'Kaydedilen şablonda 3 slot olmalı');
        assert.strictEqual(db.templates[0].document.layers[0].type, 'scene_background', 'Arka sahne en altta olmalı');
        assert(db.templates[0].document.layers.slice(1, -2).every(layer => layer.type === 'product_slot'), 'Ürün slotları sahne ile maskelerin arasında olmalı');
        assert(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot').every(layer => layer.assetId === null), 'Geçici örnek ürün nihai slot bağı olarak kaydedilmemeli');
        assert.strictEqual(new Set(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot').map(layer => `${layer.frame.x}:${layer.frame.rotation}`)).size, 3, 'Slot dönüşümleri bağımsız kalmalı');
        assert.strictEqual(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot' && layer.frame.brightness === 35 && layer.frame.contrast === 20).length, 1, 'Görsel ayarları yalnızca değiştirilen slota kaydedilmeli');
        assert(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot').every(layer => layer.frame.blur === 3 && layer.frame.opacity === .9), 'Kopyalanan slot blur ve opaklık ayarlarını taşımalı');
        const perspectiveSlot = db.templates[0].document.layers.find(layer => layer.type === 'product_slot' && layer.frame.perspective?.enabled);
        assert(perspectiveSlot && perspectiveSlot.frame.perspective.corners.length === 4, 'Perspektif slotu dört köşeyle kaydedilmeli');
        assert.strictEqual(perspectiveSlot.frame.smartFit.padding, 8, 'Akıllı yerleştirme iç boşluğu kaydedilmeli');
        assert.strictEqual(perspectiveSlot.frame.shadow.angle, 135, 'Gölge açısı slotta kaydedilmeli');
        assert.strictEqual(perspectiveSlot.frame.shadow.distance, 40, 'Gölge mesafesi slotta kaydedilmeli');
        assert(Math.abs(perspectiveSlot.frame.shadow.offsetX + 28.3) < .2 && Math.abs(perspectiveSlot.frame.shadow.offsetY - 28.3) < .2, 'Açı ve mesafe X/Y ofsetine çevrilmeli');
        const polygonLayer = db.templates[0].document.layers.find(layer => layer.type === 'foreground_polygon');
        assert(polygonLayer && polygonLayer.geometry.closed && polygonLayer.geometry.points.length === 3, 'Kapalı foreground poligonu snapshot’a kaydedilmeli');
        assert.match(db.templates[0].document.promptSpec.generatedTr, /beyaz kozmetik kutusu/, 'Prompt ayarları snapshot’a kaydedilmeli');
        assert.strictEqual(db.templates[0].document.layers.at(-2).type, 'foreground_polygon', 'Poligon foreground ürünün önünde olmalı');
        assert.strictEqual(db.templates[0].document.layers.at(-1).type, 'foreground_mask', 'Foreground mask ürünün önünde olmalı');
        const legacyDocument = JSON.parse(JSON.stringify(db.templates[0].document));
        legacyDocument.schemaVersion = 2;
        delete legacyDocument.promptSpec;
        db.templates.push({ id: crypto.randomUUID(), name: 'Legacy V2 Template', current_version: 1, document: legacyDocument, layer_count: legacyDocument.layers.length, slot_count: 3, created_at: now(), updated_at: now() });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.getByText('Test White Box Hero', { exact: true }).waitFor();
        await page.locator('.ms-template-card').filter({ hasText: 'Test White Box Hero' }).getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 6);
        assert.strictEqual(await page.locator('.ms-layer').count(), 6, 'Şablon yeniden açılınca perspektif ve maske katmanları korunmalı');
        await page.locator('[data-view="prompt"]').click();
        assert.match(await page.locator('#msPromptTr').inputValue(), /beyaz kozmetik kutusu/, 'Prompt yeniden açılınca korunmalı');

        await page.locator('[data-view="templates"]').click();
        const legacyCard = page.locator('.ms-template-card').filter({ hasText: 'Legacy V2 Template' });
        await legacyCard.getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.locator('[data-view="prompt"]').click();
        assert.match(await page.locator('#msPromptEn').inputValue(), /3 product placement areas/, 'V2 şablon varsayılan prompt verisiyle açılmalı');
        await page.locator('[data-view="editor"]').click();
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v2 olarak kaydedildi/).waitFor();
        assert.strictEqual(db.templates.find(template => template.name === 'Legacy V2 Template').document.schemaVersion, 3, 'V2 şablon kaydedilince v3 formatına yükselmeli');

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'second_product.png', mimeType: 'image/png', buffer: png });
        await page.locator('#msNewSlotBtn').click();
        await page.locator('.ms-layer').filter({ hasText: 'Slot 1' }).waitFor();
        await page.locator('#msEditorName').fill('Test Second Template');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();

        await page.locator('[data-view="templates"]').click();
        const firstCard = page.locator('.ms-template-card').filter({ hasText: 'Test White Box Hero' });
        const secondCard = page.locator('.ms-template-card').filter({ hasText: 'Test Second Template' });
        const savedLegacyCard = page.locator('.ms-template-card').filter({ hasText: 'Legacy V2 Template' });
        if (await savedLegacyCard.getAttribute('class').then(value => value.includes('is-selected'))) await savedLegacyCard.click();
        if (!await firstCard.getAttribute('class').then(value => value.includes('is-selected'))) await firstCard.click();
        if (!await secondCard.getAttribute('class').then(value => value.includes('is-selected'))) await secondCard.click();

        await page.locator('[data-view="create"]').click();
        await page.locator('#msCreateProductInput').setInputFiles({ name: 'throwaway_product.png', mimeType: 'image/png', buffer: png });
        await page.locator('.ms-product-card').filter({ hasText: 'throwaway_product.png' }).waitFor();
        const throwaway = db.products.find(product => product.original_filename === 'throwaway_product.png');
        assert(throwaway && db.storage.has(throwaway.storage_path), 'Deneme ürünü Storage mockuna yüklenmeli');
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.ms-product-card').filter({ hasText: 'throwaway_product.png' }).locator('.ms-product-delete').click();
        await page.getByText('Kullanılmamış ürün Storage ve ürün kütüphanesinden silindi.').waitFor();
        assert(!db.assets.some(asset => asset.id === throwaway.id), 'Kullanılmamış ürün kaydı fiziksel silinmeli');
        assert(!db.storage.has(throwaway.storage_path), 'Kullanılmamış ürün Storage dosyası silinmeli');

        const usedProductCard = page.locator('.ms-product-card').filter({ hasText: 'second_product.png' });
        await usedProductCard.locator('.ms-product-select').click();
        const usedProduct = db.products.find(product => product.original_filename === 'second_product.png');
        await page.locator('#msOutputName').fill('Test Kalıcı Çıktı');
        await page.locator('#msGenerateBtn').click();
        await page.getByText('2 kalıcı çıktı oluşturuldu.').waitFor({ timeout: 30000 });
        assert.strictEqual(db.outputs.length, 2, 'İki ayrı çıktı kaydı oluşturulmalı');
        assert(db.outputs.every(output => output.template_snapshot.layers.every(layer => !String(layer.type).includes('helper'))), 'Nihai çıktı snapshotlarında yardımcı çizgi veya etiket bulunmamalı');
        assert(db.outputs.some(output => output.template_snapshot.layers.some(layer => layer.type === 'product_slot' && layer.frame.shadow.enabled && layer.frame.shadow.offsetX === 12.5 && layer.frame.shadow.offsetY === 17.5)), '0,5 adımlı gölge X/Y değerleri 2000×2000 çıktı snapshotına taşınmalı');
        page.once('dialog', dialog => dialog.accept());
        await usedProductCard.locator('.ms-product-delete').click();
        await page.getByText('Kullanılmış ürün aktif listeden kaldırıldı; eski çıktılar korundu.').waitFor();
        assert(usedProduct.deleted_at, 'Kullanılmış ürün yumuşak silinmeli');
        assert(db.storage.has(usedProduct.storage_path), 'Kullanılmış ürünün Storage dosyası korunmalı');
        assert.strictEqual(await page.locator('.ms-product-card').filter({ hasText: 'second_product.png' }).count(), 0, 'Kullanılmış ürün aktif listeden kalkmalı');

        for (let index = 3; index <= 10; index += 1) db.outputs.push({ ...JSON.parse(JSON.stringify(db.outputs[0])), id: crypto.randomUUID(), name: `Test Kalıcı Çıktı ${index}`, created_at: now() });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.locator('[data-view="outputs"]').click();
        assert.strictEqual(await page.locator('.ms-output-card').count(), 10, 'On çıktı yenileme sonrası kalmalı');
        await page.locator('.ms-output-open').first().click();
        await page.locator('#msOutputLightbox').waitFor({ state: 'visible' });
        await page.locator('#msOutputLightbox img').waitFor({ state: 'visible' });
        assert(await page.locator('#msOutputLightbox').getByText('2000×2000 PNG').isVisible(), 'Çıktı büyük önizlemesi açılmalı');
        await page.locator('[data-lightbox="close"]').click();
        await page.locator('#msSelectAllOutputs').click();
        assert.strictEqual(await page.locator('.ms-output-check input:checked').count(), 10, 'Tümünü seç ile 10 çıktı seçilmeli');
        await page.locator('#msDownloadMode').selectOption('zip');
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#msDownloadSelected').click();
        const zipDownload = await downloadPromise;
        assert.match(zipDownload.suggestedFilename(), /mockup-ciktilari-10\.zip$/, '10 çıktı tek ZIP olarak indirilmeli');
        const zipBytes = fs.readFileSync(await zipDownload.path());
        assert.strictEqual((zipBytes.toString('latin1').match(/PK\x03\x04/g) || []).length, 10, 'ZIP içinde 10 PNG dosya girdisi bulunmalı');
        await page.getByText('10 çıktı indirildi.').waitFor();

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        await page.locator('#msSceneInput').setInputFiles({ name: 'preset-test-scene.png', mimeType: 'image/png', buffer: png });
        await page.getByText(/kaydetmeden slot ekleyebilirsiniz/).waitFor();
        await page.locator('#msPresetSelect').selectOption('10000000-0000-4000-8000-000000000002');
        await page.locator('#msPresetMode').selectOption('replace');
        await page.locator('#msApplyPresetBtn').click();
        await page.getByText(/3×3 Düz Grid: 9 slot uygulandı/).waitFor();
        await page.locator('#msPresetSelect').selectOption('10000000-0000-4000-8000-000000000008');
        await page.locator('#msPresetMode').selectOption('append');
        await page.locator('#msApplyPresetBtn').click();
        await page.getByText(/Tek Büyük Hero Slot: 1 slot mevcut slotlara eklendi/).waitFor();
        assert.strictEqual(await page.locator('.ms-layer').filter({ hasText: /Slot \d/ }).count(), 10, '3×3 dizilime Hero slot eklenince 10 slot olmalı');
        page.once('dialog', dialog => dialog.accept('Test 3x3 + Hero'));
        await page.locator('#msSavePresetBtn').click();
        await page.getByText('Slot dizilimi kalıcı olarak kaydedildi.').waitFor();
        assert(db.presets.some(preset => preset.name === 'Test 3x3 + Hero' && preset.slots.length === 10), 'Özel slot dizilimi kalıcı kaydedilmeli');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openMockup();
        await page.locator('#msPresetSelect').selectOption(db.presets.find(preset => preset.name === 'Test 3x3 + Hero').id);
        await page.locator('#msApplyPresetBtn').click();
        await page.getByText(/Test 3x3 \+ Hero: 10 slot uygulandı/).waitFor();
        assert.strictEqual(await page.locator('.ms-layer').filter({ hasText: /Slot \d/ }).count(), 10, 'Sayfa yenilendikten sonra özel dizilim tekrar uygulanmalı');

        await page.locator('#tabAiNew').click();
        assert(await page.locator('#aiNewSection').isVisible(), 'Yeni Görsel Üret görünür olmalı');
        await page.locator('#tabAiHistory').click();
        assert(await page.locator('#aiHistorySection').isVisible(), 'Geçmiş Üretimler görünür olmalı');

        console.log('Mockup Studio UI flow: PASS');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
