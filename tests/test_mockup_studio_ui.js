const { chromium } = require('playwright');
const crypto = require('crypto');
const assert = require('assert');
const fs = require('fs');

const baseUrl = process.env.MOCKUP_TEST_URL || 'http://localhost:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69d9WQAAAABJRU5ErkJggg==', 'base64');
const largePng = Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024 - png.length)]);
const now = () => new Date().toISOString();
const slotImportDocument = (slots) => JSON.stringify({ format: 'parabass-slots', version: 1, canvas: { width: 2000, height: 2000, coordinateSystem: 'normalized_0_1000' }, slots });
const importedSlot = (id, index = 0) => ({
    id, name: index ? `JSON Slot ${index + 1}` : 'Ön Hero',
    perspectiveCorners: { topLeft: [220 + index * 8, 180], topRight: [520 + index * 8, 210], bottomRight: [500 + index * 8, 520], bottomLeft: [200 + index * 8, 490] },
    foregroundPolygons: index ? [] : [{ label: 'front_box_edge', points: [[200, 490], [500, 520], [495, 570], [195, 540]] }],
    effects: { blur: 6, opacity: 0.82, brightness: 12 },
    shadow: { enabled: true, color: '#4B3828', opacity: 0.22, blur: 14, offsetX: 5, offsetY: 8 },
    depthOrder: index ? 9 - index : 1
});

const presetFrame = (x, y, width, height, rotation = 0) => ({ x, y, width, height, rotation });
const gridPreset = (id, name, cols, rows) => ({ id, name, is_system: true, created_at: now(), slots: Array.from({ length: cols * rows }, (_, index) => ({ order: index, frame: presetFrame(300 + (index % cols) * (1400 / Math.max(1, cols - 1)), 300 + Math.floor(index / cols) * (1400 / Math.max(1, rows - 1)), cols === 3 ? 430 : 620, cols === 3 ? 430 : 620) })) });
const db = { templates: [], versions: [], products: [], outputs: [], assets: [], storage: new Set(), storageBodies: new Map(), fixtureBodies: new Map(), signed: new Map(), directUploads: [], maxApiPayload: 0, presets: [] };
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
        const path = url.searchParams.get('asset');
        if (!db.storage.has(path)) return json(route, { error: 'Dosya bulunamadı.' }, 404);
        return route.fulfill({ status: 200, contentType: 'image/png', body: db.storageBodies.get(path) || png });
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
        if (body.action === 'delete_outputs') {
            body.ids.forEach(id => { const output = db.outputs.find(item => item.id === id); if (output) output.deleted_at = now(); });
            return json(route, { success: true, deleted_ids: body.ids, soft_deleted: true });
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
    const rawBody = request.postDataBuffer() || Buffer.alloc(0);
    const transferred = rawBody.length;
    const boundary = /boundary=([^;]+)/i.exec(request.headers()['content-type'] || '')?.[1];
    let storedBody = rawBody;
    if (boundary) {
        const contentStart = rawBody.indexOf(Buffer.from('\r\n\r\n'));
        const contentEnd = rawBody.lastIndexOf(Buffer.from(`\r\n--${boundary}`));
        if (contentStart >= 0 && contentEnd > contentStart) storedBody = rawBody.subarray(contentStart + 4, contentEnd);
    }
    const pngStart=storedBody.indexOf(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    const pngEnd=storedBody.indexOf(Buffer.from([0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]),pngStart+8);
    if(pngStart>=0&&pngEnd>pngStart)storedBody=storedBody.subarray(pngStart,pngEnd+8);
    pending.uploaded = true;
    pending.bytes = storedBody;
    db.storageBodies.set(pending.path, db.fixtureBodies.get(pending.body.filename) || (pending.body.asset_type === 'output' ? storedBody : png));
    db.directUploads.push({ type: pending.body.asset_type, declaredSize: pending.body.size_bytes, transferred });
    return json(route, { Key: pending.path }, 200);
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.MOCKUP_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    });
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('[browser page error]', error.message));
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
    const lightingNumber = (key) => page.locator(`[data-lighting-key="${key}"][type="number"]`).last();
    const makeSolidPng = async (color) => Buffer.from(await page.evaluate((fill) => {
        const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle=fill;context.fillRect(0,0,64,64);return canvas.toDataURL('image/png').split(',')[1];
    }, color), 'base64');
    const readPngPixel = async (buffer, logicalX, logicalY) => page.evaluate(async ({ base64, logicalX, logicalY }) => {
        const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const x=Math.max(0,Math.min(canvas.width-1,Math.round(logicalX/2000*(canvas.width-1)))),y=Math.max(0,Math.min(canvas.height-1,Math.round(logicalY/2000*(canvas.height-1))));return Array.from(context.getImageData(x,y,1,1).data);
    }, { base64: buffer.toString('base64'), logicalX, logicalY });

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
        await page.waitForFunction(() => document.querySelector('#mockupStatus')?.textContent);
        assert.match(await page.locator('#mockupStatus').textContent(), /Şeffaf kenarlar algılandı/, 'Akıllı yerleştirme çalışmalı');
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
        await page.locator('#msClearOutputSelection').click();
        await page.locator('.ms-output-check input').nth(0).check();
        await page.locator('.ms-output-check input').nth(1).check();
        await page.locator('.ms-output-check input').nth(2).check();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#msDeleteSelected').click();
        await page.getByText('3 çıktı yumuşak silindi. Şablonlar ve ürünler korundu.').waitFor();
        assert.strictEqual(await page.locator('.ms-output-card').count(), 7, 'Toplu silinen 3 çıktı listeden hemen kalkmalı');
        assert.strictEqual(db.outputs.filter(output => !output.deleted_at).length, 7, 'Yalnız seçilen çıktı kayıtları yumuşak silinmeli');
        assert.strictEqual(db.templates.length, 3, 'Toplu çıktı silme şablonları etkilememeli');

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
        const multiSlots = page.locator('.ms-layer').filter({ hasText: /Slot \d/ });
        await multiSlots.nth(0).click();
        for (let index = 1; index < 6; index += 1) await multiSlots.nth(index).click({ modifiers: ['Control'] });
        await page.getByText('Seçili 6 Slot').waitFor();
        const bulkBlur = page.locator('[data-bulk-key="blur"][type="number"]');
        await bulkBlur.fill('4'); await bulkBlur.press('Tab');
        await page.locator('#msBulkShadowToggle').check();
        await page.locator('[data-align="distributeX"]').click();
        await page.locator('#msToggleGrid').click();
        await page.locator('#msBulkSnap').click();
        const groupCanvas = page.locator('#mockupCanvasHost canvas').last();
        const groupBox = await groupCanvas.boundingBox();
        await page.mouse.move(groupBox.x + groupBox.width * .5, groupBox.y + groupBox.height * .56);
        await page.mouse.down(); await page.mouse.move(groupBox.x + groupBox.width * .53, groupBox.y + groupBox.height * .58, { steps: 5 }); await page.mouse.up();
        await page.waitForTimeout(200);
        await page.locator('#msToggleGuides').click();
        assert.match(await page.locator('#msToggleGuides').textContent(), /Kapalı/, 'Düzenleme çizgileri kapanabilmeli');
        await page.locator('#msToggleGuides').click();
        assert.match(await page.locator('#msToggleGuides').textContent(), /Açık/, 'Düzenleme çizgileri tekrar açılabilmeli');
        await page.locator('#msToggleDrawer').click();
        assert(await page.locator('.ms-layout').evaluate(element => element.classList.contains('is-drawer-closed')), 'Varlıklar ve katmanlar drawer olarak kapanabilmeli');
        assert(await page.locator('.ms-canvas-panel').isVisible(), 'Drawer kapalıyken tuval görünür kalmalı');
        await page.locator('#msToggleDrawer').click();
        await page.locator('#msEditorName').fill('Test Multi Edit Template');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        const multiSaved = db.templates.find(template => template.name === 'Test Multi Edit Template');
        assert.strictEqual(multiSaved.document.layers.filter(layer => layer.type === 'product_slot' && layer.frame.blur === 4 && layer.frame.shadow.enabled).length, 6, 'Toplu blur ve gölge seçili slotların tamamına kaydedilmeli');

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        const redScenePng = await makeSolidPng('#dc1e1e');
        const blueProductPng = await makeSolidPng('#1450e6');
        db.fixtureBodies.set('json-import-scene.png', redScenePng);
        db.fixtureBodies.set('json-blue-product.png', blueProductPng);
        await page.locator('#msSceneInput').setInputFiles({ name: 'json-import-scene.png', mimeType: 'image/png', buffer: redScenePng });
        await page.getByText(/kaydetmeden slot ekleyebilirsiniz/).waitFor();
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'json-blue-product.png', mimeType: 'image/png', buffer: blueProductPng });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        const initialJsonLayerCount = await page.locator('.ms-layer').count();
        const invalidClipJson = importedSlot('bad_clip');
        invalidClipJson.clipPolygon = [[100, 100], [200, 200]];
        await page.locator('#msJsonImportBtn').click();
        await page.locator('#msJsonInput').fill(slotImportDocument([invalidClipJson]));
        await page.locator('#msJsonValidateBtn').click();
        assert(await page.locator('#msJsonCreateBtn').isDisabled(), 'Geçersiz JSON için oluşturma kapalı kalmalı');
        assert.match(await page.locator('#msJsonValidation').textContent(), /clipPolygon: en az 3 noktalı/, 'Geçersiz kırpma poligonu Türkçe doğrulama hatası göstermeli');
        assert.strictEqual(await page.locator('.ms-layer').count(), initialJsonLayerCount, 'Geçersiz clipPolygon mevcut şablonu değiştirmemeli');
        invalidClipJson.clipPolygon = [[100, 100], [200, 200], [1201, 300]];
        await page.locator('#msJsonInput').fill(slotImportDocument([invalidClipJson]));
        await page.locator('#msJsonValidateBtn').click();
        assert.match(await page.locator('#msJsonValidation').textContent(), /0–1000 aralığında/, 'Canvas dışındaki aşırı clipPolygon koordinatı reddedilmeli');
        assert.strictEqual(await page.locator('.ms-layer').count(), initialJsonLayerCount, 'Aşırı clipPolygon koordinatı mevcut şablonu değiştirmemeli');
        await page.locator('#msJsonCancelBtn').click();

        const singleJson = JSON.parse(slotImportDocument([importedSlot('slot_01')]));
        singleJson.sceneLighting = { temperature: 15, tint: 3, exposure: 0.5, contrast: 1.1, saturation: 1.2, highlights: -10, shadows: 8 };
        Object.assign(singleJson.slots[0], {
            perspectiveCorners: { topLeft: [100, 100], topRight: [900, 100], bottomRight: [900, 900], bottomLeft: [100, 900] },
            clipPolygon: [[300, 300], [700, 300], [700, 700], [300, 700]],
            foregroundPolygons: [{ label: 'front_box_edge', points: [[300, 500], [700, 500], [700, 600], [300, 600]] }],
            effects: { blur: 0, opacity: 1, brightness: 0, temperature: 4200 },
            relighting: { temperature: 18, exposure: -0.1 },
            shadow: { enabled: true, color: '#000000', opacity: 0.8, blur: 14, offsetX: 100, offsetY: 0 }
        });
        await page.locator('#msJsonImportBtn').click();
        await page.locator('#msJsonInput').fill(JSON.stringify(singleJson));
        await page.locator('#msJsonValidateBtn').click();
        assert.match(await page.locator('#msJsonValidation').textContent(), /1 slot bulundu/);
        assert.match(await page.locator('#msJsonValidation').textContent(), /1 geçerli/);
        assert.match(await page.locator('#msJsonValidation').textContent(), /0 geçersiz/);
        assert.match(await page.locator('#msJsonValidation').textContent(), /desteklenmeyen alan/, 'Desteklenmeyen alan uyarı olarak gösterilmeli');
        await page.locator('#msJsonCreateBtn').click();
        await page.getByText(/1 slot JSON’dan oluşturuldu; 1 foreground poligonu eklendi/).waitFor();
        assert.strictEqual(await page.locator('.ms-layer').count(), 3, 'Tek slot ve foreground poligonu mevcut katmanlara eklenmeli');
        if ((await page.locator('#msToggleGrid').textContent()).includes('Açık')) await page.locator('#msToggleGrid').click();
        if ((await page.locator('#msToggleGuides').textContent()).includes('Açık')) await page.locator('#msToggleGuides').click();
        await page.waitForTimeout(250);
        const previewImage = await page.locator('#mockupCanvasHost').screenshot();
        const previewInside = await readPngPixel(previewImage, 1000, 800);
        const previewOutside = await readPngPixel(previewImage, 500, 800);
        const previewShadowOutside = await readPngPixel(previewImage, 1460, 800);
        const previewForeground = await readPngPixel(previewImage, 1000, 1100);
        assert(previewInside[2] > previewInside[0], 'Ürün önizlemede clipPolygon içinde görünmeli');
        assert(previewOutside[0] > previewOutside[2], 'Ürün önizlemede clipPolygon dışına taşmamalı');
        assert(previewShadowOutside[0] > previewShadowOutside[2], 'Ürün gölgesi önizlemede clipPolygon dışına taşmamalı');
        assert(previewForeground[0] > previewForeground[2], 'Foreground poligonu clipPolygon’dan bağımsız olarak ürünün önünde görünmeli');
        await page.locator('#msToggleGuides').click();
        await page.locator('#msUndoBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 1);
        assert.strictEqual(await page.locator('.ms-layer').count(), 1, 'Tek Undo tüm JSON içe aktarmayı kaldırmalı');
        await page.locator('#msRedoBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 3);
        await page.locator('#msEditorName').fill('Test JSON Import Template');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        const importedV1 = db.versions.find(version => version.template_name === 'Test JSON Import Template' && version.version_number === 1).snapshot;
        const importedV1Slot = importedV1.layers.find(layer => layer.type === 'product_slot');
        assert.strictEqual(importedV1Slot.id, 'slot_01', 'Çakışmayan JSON slot ID korunmalı');
        assert.deepStrictEqual(importedV1Slot.frame.perspective.corners[0], { x: 200, y: 200 }, 'Normalize perspektif koordinatları 2000×2000 tuvale çevrilmeli');
        assert.deepStrictEqual(importedV1Slot.frame.perspective.corners[2], { x: 1800, y: 1800 }, 'Dört perspektif köşesi doğru sırada aktarılmalı');
        assert.deepStrictEqual(importedV1Slot.clipPolygon.points[0], { x: 600, y: 600 }, 'Normalize clipPolygon koordinatları piksel koordinatlarına çevrilmeli');
        assert.deepStrictEqual(importedV1Slot.clipPolygon.points[2], { x: 1400, y: 1400 }, 'clipPolygon doğru slota ve doğru sırayla aktarılmalı');
        assert(importedV1Slot.clipPolygon.closed, 'İçe aktarılan clipPolygon kapalı olmalı');
        assert.strictEqual(importedV1Slot.frame.blur, 0, 'Blur aktarılmalı');
        assert.strictEqual(importedV1Slot.frame.opacity, 1, 'Opaklık aktarılmalı');
        assert.strictEqual(importedV1Slot.frame.temperature, undefined, 'Desteklenmeyen efekt slot verisine aktarılmamalı');
        assert.deepStrictEqual(importedV1Slot.frame.relighting, { temperature: 18, tint: 3, exposure: -0.1, contrast: 1.1, saturation: 1.2, highlights: -10, shadows: 8 }, 'Slot relighting yalnız verdiği alanlarla sceneLighting temelini override etmeli');
        assert.strictEqual(importedV1Slot.frame.shadow.color, '#000000', 'Gölge rengi aktarılmalı');
        assert.strictEqual(importedV1Slot.frame.shadow.offsetX, 100, 'Gölge X ofseti aktarılmalı');
        const importedPolygon = importedV1.layers.find(layer => layer.type === 'foreground_polygon');
        assert(importedPolygon && importedPolygon.geometry.closed, 'Foreground poligonu mevcut kapalı poligon yapısına aktarılmalı');
        assert.deepStrictEqual(importedPolygon.geometry.points[0], { x: 600, y: 1000 }, 'Foreground poligon normalize koordinatları tuvale çevrilmeli');
        assert.strictEqual(importedPolygon.type, 'foreground_polygon', 'Foreground poligonu clipPolygon ile birleştirilmemeli');

        const lightingProductPng = Buffer.from(await page.evaluate(() => {
            const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const context=canvas.getContext('2d');
            context.fillStyle='rgb(45,65,115)';context.fillRect(0,0,32,64);
            context.fillStyle='rgb(205,220,235)';context.fillRect(32,0,32,64);
            context.clearRect(0,0,20,20);
            return canvas.toDataURL('image/png').split(',')[1];
        }), 'base64');
        db.fixtureBodies.set('lighting-test-product.png', lightingProductPng);
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'lighting-test-product.png', mimeType: 'image/png', buffer: lightingProductPng });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        if ((await page.locator('#msToggleGuides').textContent()).includes('Açık')) await page.locator('#msToggleGuides').click();
        await page.waitForTimeout(300);
        const lightingPreviewImage = await page.locator('#mockupCanvasHost').screenshot();
        const lightingPreviewDark = await readPngPixel(lightingPreviewImage, 800, 800);
        const lightingPreviewLight = await readPngPixel(lightingPreviewImage, 1200, 800);
        const lightingPreviewAlpha = await readPngPixel(lightingPreviewImage, 650, 650);
        await page.locator('#msToggleGuides').click();

        await page.locator('[data-view="templates"]').click();
        while (await page.locator('.ms-template-card.is-selected').count()) await page.locator('.ms-template-card.is-selected').first().click();
        await page.locator('.ms-template-card').filter({ hasText: 'Test JSON Import Template' }).click();
        await page.locator('[data-view="create"]').click();
        await page.waitForFunction(() => document.querySelectorAll('#msCreateVersion option').length > 0);
        await page.locator('.ms-product-card').filter({ hasText: 'json-blue-product.png' }).locator('.ms-product-select').click();
        await page.locator('#msOutputName').fill('Clip Render Test');
        await page.locator('#msGenerateBtn').click();
        await page.getByText('1 kalıcı çıktı oluşturuldu.').waitFor({ timeout: 30000 });
        const clipOutput = db.outputs.find(output => output.name === 'Clip Render Test');
        const outputBytes = db.storageBodies.get(clipOutput.export_path);
        assert(outputBytes && outputBytes.length, '2000×2000 clipPolygon çıktısı Storage mockuna yazılmalı');
        const outputInside = await readPngPixel(outputBytes, 1000, 800);
        const outputOutside = await readPngPixel(outputBytes, 500, 800);
        const outputShadowOutside = await readPngPixel(outputBytes, 1460, 800);
        const outputForeground = await readPngPixel(outputBytes, 1000, 1100);
        assert(outputInside[2] > outputInside[0], 'Ürün 2000×2000 çıktıda clipPolygon içinde görünmeli');
        assert(outputOutside[0] > outputOutside[2], 'Ürün 2000×2000 çıktıda clipPolygon dışına taşmamalı');
        assert(outputShadowOutside[0] > outputShadowOutside[2], 'Ürün gölgesi 2000×2000 çıktıda clipPolygon dışına taşmamalı');
        assert(outputForeground[0] > outputForeground[2], 'Foreground poligonu çıktıda clipPolygon’dan bağımsız ve ürünün önünde kalmalı');
        assert(clipOutput.template_snapshot.layers.every(layer => !String(layer.type).includes('helper')), 'Clip yardımcı çizgileri nihai çıktıya girmemeli');

        await page.locator('.ms-product-card').filter({ hasText: 'lighting-test-product.png' }).locator('.ms-product-select').click();
        await page.locator('#msOutputName').fill('Lighting Render Test');
        await page.locator('#msGenerateBtn').click();
        for(let attempt=0;attempt<100&&!db.outputs.some(output=>output.name==='Lighting Render Test');attempt+=1)await page.waitForTimeout(100);
        const lightingOutput = db.outputs.find(output => output.name === 'Lighting Render Test');
        assert(lightingOutput,'Işık ayarlı kalıcı çıktı oluşturulmalı');
        const lightingOutputBytes = db.storageBodies.get(lightingOutput.export_path);
        const lightingOutputDark = await readPngPixel(lightingOutputBytes, 800, 800);
        const lightingOutputLight = await readPngPixel(lightingOutputBytes, 1200, 800);
        const lightingOutputAlpha = await readPngPixel(lightingOutputBytes, 650, 650);
        const channelDistance=(left,right)=>Math.max(...left.slice(0,3).map((value,index)=>Math.abs(value-right[index])));
        assert(channelDistance(lightingPreviewDark,lightingOutputDark)<18, 'Önizleme ve 2000×2000 çıktı koyu pikselde aynı ışık filtresini kullanmalı');
        assert(channelDistance(lightingPreviewLight,lightingOutputLight)<18, 'Önizleme ve 2000×2000 çıktı açık pikselde aynı ışık filtresini kullanmalı');
        assert(channelDistance(lightingPreviewAlpha,lightingOutputAlpha)<8, 'Şeffaf ürün pikselinin alfa sonucu önizleme ve çıktıda aynı kalmalı');

        await page.locator('[data-view="templates"]').click();
        await page.locator('.ms-template-card').filter({ hasText: 'Test JSON Import Template' }).getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 3);

        await page.locator('.ms-layer').filter({ hasText: 'Ön Hero' }).click();
        assert(await page.locator('#msPerspectiveToggle').isChecked(), 'İçe aktarılan slot perspektif aracıyla düzenlenebilir olmalı');
        assert(await page.locator('.ms-lighting-panel').isVisible(), 'Renk ve Işık Uyarlaması paneli seçili slotta görünmeli');
        db.fixtureBodies.set('lighting-manual-product.png', lightingProductPng);
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'lighting-manual-product.png', mimeType: 'image/png', buffer: lightingProductPng });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        if ((await page.locator('#msToggleGuides').textContent()).includes('Açık')) await page.locator('#msToggleGuides').click();
        const captureLightingPixels=async()=>{await page.waitForTimeout(220);const image=await page.locator('#mockupCanvasHost').screenshot();return {dark:await readPngPixel(image,800,800),light:await readPngPixel(image,1200,800),alpha:await readPngPixel(image,650,650)};};
        const rgbSum=(pixel)=>pixel[0]+pixel[1]+pixel[2];
        const colorSpread=(pixel)=>Math.max(...pixel.slice(0,3))-Math.min(...pixel.slice(0,3));
        const setLighting=async(key,value)=>{await lightingNumber(key).fill(String(value));await lightingNumber(key).press('Tab');};
        await page.locator('#msLightingReset').click();
        const neutralPixels=await captureLightingPixels();
        await setLighting('temperature',100);const warmPixels=await captureLightingPixels();
        assert(warmPixels.dark[0]-warmPixels.dark[2]>neutralPixels.dark[0]-neutralPixels.dark[2], 'Pozitif sıcaklık pikseli daha sıcak yapmalı');
        await setLighting('temperature',-100);const coolPixels=await captureLightingPixels();
        assert(coolPixels.dark[2]-coolPixels.dark[0]>neutralPixels.dark[2]-neutralPixels.dark[0], 'Negatif sıcaklık pikseli daha soğuk yapmalı');
        await page.locator('#msUndoBtn').click();
        await page.waitForFunction(() => Number(document.querySelector('[data-lighting-key="temperature"][type="number"]')?.value) === 100);
        assert.strictEqual(Number(await lightingNumber('temperature').inputValue()),100,'Manuel ışık ayarı Undo ile geri alınmalı');
        await page.locator('#msRedoBtn').click();
        await page.waitForFunction(() => Number(document.querySelector('[data-lighting-key="temperature"][type="number"]')?.value) === -100);
        assert.strictEqual(Number(await lightingNumber('temperature').inputValue()),-100,'Manuel ışık ayarı Redo ile yinelenmeli');
        await page.locator('#msLightingReset').click();await setLighting('tint',100);const tintPixels=await captureLightingPixels();
        assert(tintPixels.dark[0]+tintPixels.dark[2]-2*tintPixels.dark[1]>neutralPixels.dark[0]+neutralPixels.dark[2]-2*neutralPixels.dark[1], 'Tint gerçek RGB sonucunu değiştirmeli');
        await page.locator('#msLightingReset').click();await setLighting('exposure',1);const exposurePixels=await captureLightingPixels();
        assert(rgbSum(exposurePixels.dark)>rgbSum(neutralPixels.dark),'Pozlama gerçek render sonucunu değiştirmeli');
        await page.locator('#msLightingReset').click();await setLighting('contrast',1.5);const contrastPixels=await captureLightingPixels();
        assert(rgbSum(contrastPixels.dark)<rgbSum(neutralPixels.dark)&&rgbSum(contrastPixels.light)>=rgbSum(neutralPixels.light),'Kontrast koyu ve açık tonları ayırmalı');
        await page.locator('#msLightingReset').click();await setLighting('saturation',2);const saturationPixels=await captureLightingPixels();
        assert(colorSpread(saturationPixels.dark)>colorSpread(neutralPixels.dark),'Doygunluk gerçek render sonucunu değiştirmeli');
        await page.locator('#msLightingReset').click();await setLighting('highlights',100);const highlightPixels=await captureLightingPixels();
        assert(rgbSum(highlightPixels.light)-rgbSum(neutralPixels.light)>rgbSum(highlightPixels.dark)-rgbSum(neutralPixels.dark),'Highlights açık tonları daha güçlü etkilemeli');
        await page.locator('#msLightingReset').click();await setLighting('shadows',100);const shadowPixels=await captureLightingPixels();
        assert(rgbSum(shadowPixels.dark)-rgbSum(neutralPixels.dark)>rgbSum(shadowPixels.light)-rgbSum(neutralPixels.light),'Shadows koyu tonları daha güçlü etkilemeli');
        assert(channelDistance(shadowPixels.alpha,neutralPixels.alpha)<8,'Işık filtreleri şeffaf PNG alfa alanını bozmamalı');
        await page.locator('#msToggleGuides').click();
        assert.match(await page.locator('.ms-clip-tools').textContent(), /4 nokta • Kapalı/, 'Kaydedilip açılan clipPolygon editörde korunmalı');
        await page.locator('#msClipUndoPointBtn').click();
        await page.getByText(/3 nokta • Çiziliyor/).waitFor();
        await page.locator('#msUndoBtn').click();
        await page.getByText(/4 nokta • Kapalı/).waitFor();
        await page.locator('#msRedoBtn').click();
        await page.getByText(/3 nokta • Çiziliyor/).waitFor();
        await page.locator('#msUndoBtn').click();
        await page.getByText(/4 nokta • Kapalı/).waitFor();
        await controlNumber('blur').fill('7'); await controlNumber('blur').press('Tab');
        assert.strictEqual(await controlNumber('blur').inputValue(), '7', 'İçe aktarılan slot mevcut ayar panelinden değiştirilebilmeli');
        await setLighting('temperature',37);await setLighting('tint',4);
        await page.locator('#msResetPerspectiveBtn').click();
        await page.locator('#msDuplicateLayer').click();
        await page.getByText(/Slot 2 çoğaltıldı/).waitFor();
        assert.strictEqual(Number(await lightingNumber('temperature').inputValue()),37,'Slot çoğaltılınca ışık değerleri kopyalanmalı');
        assert.strictEqual(Number(await lightingNumber('tint').inputValue()),4,'Çoğaltılan slot bağımsız ışık değerlerini taşımalı');
        assert.match(await page.locator('.ms-clip-tools').textContent(), /4 nokta • Kapalı/, 'Slot çoğaltılınca clipPolygon kopyalanmalı');
        await page.locator('#msClipUndoPointBtn').click();
        await page.getByText(/3 nokta • Çiziliyor/).waitFor();

        await page.locator('#msJsonImportBtn').click();
        await page.locator('#msJsonInput').fill(slotImportDocument([importedSlot('slot_01')]));
        await page.locator('#msJsonValidateBtn').click();
        await page.locator('#msJsonCreateBtn').click();
        await page.getByText(/1 slot JSON’dan oluşturuldu/).waitFor();
        await page.locator('.ms-layer[data-id="slot_01"]').click();
        await page.locator('.ms-layer').filter({ hasText: 'Slot 2' }).click({ modifiers: ['Control'] });
        assert.match(await page.locator('#msInspector').textContent(), /Seçili 2 Slot/,'Çoklu slot ışık uygulaması için iki slot seçilebilmeli');
        await lightingNumber('temperature').fill('22');
        await lightingNumber('tint').fill('-6');
        await page.locator('#msLightingApply').click();
        await page.getByText(/2 seçili slota uygulandı/).waitFor();
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v2 olarak kaydedildi/).waitFor();
        const duplicateSaved = db.templates.find(template => template.name === 'Test JSON Import Template');
        const duplicateIds = duplicateSaved.document.layers.filter(layer => layer.type === 'product_slot').map(layer => layer.id);
        assert.strictEqual(new Set(duplicateIds).size, duplicateIds.length, 'Mevcut ID ile çakışan slot için benzersiz ID üretilmeli');
        const editedImportedSlot = duplicateSaved.document.layers.find(layer => layer.id === 'slot_01');
        assert.strictEqual(editedImportedSlot.frame.blur, 7, 'İçe aktarılan slotun ayar paneli değişikliği snapshotta korunmalı');
        assert.deepStrictEqual(editedImportedSlot.frame.perspective.corners[0], { x: 200, y: 200 }, 'İçe aktarılan slot mevcut perspektif aracıyla düzenlenebilmeli');
        const copiedClipSlot = duplicateSaved.document.layers.find(layer => layer.type === 'product_slot' && layer.name === 'Slot 2');
        const legacyJsonSlot = duplicateSaved.document.layers.find(layer => layer.type === 'product_slot' && layer.id !== 'slot_01' && layer.id !== copiedClipSlot.id);
        assert.strictEqual(editedImportedSlot.clipPolygon.points.length, 4, 'Kopyadaki düzenleme kaynak clipPolygon referansını değiştirmemeli');
        assert.strictEqual(copiedClipSlot.clipPolygon.points.length, 3, 'Çoğaltılmış slotun clipPolygon verisi bağımsız düzenlenebilmeli');
        assert.strictEqual(editedImportedSlot.frame.relighting.temperature,22,'Toplu ışık ayarı ilk seçili slota uygulanmalı');
        assert.strictEqual(copiedClipSlot.frame.relighting.temperature,22,'Toplu ışık ayarı ikinci seçili slota uygulanmalı');
        assert.strictEqual(editedImportedSlot.frame.relighting.tint,-6,'Toplu tint ayarı seçili slotlarda korunmalı');
        assert.strictEqual(legacyJsonSlot.clipPolygon, undefined, 'clipPolygon içermeyen eski JSON davranışı korunmalı');
        assert.strictEqual(legacyJsonSlot.groupId, undefined, 'groupId içermeyen eski JSON ve slotlar değişmeden çalışmalı');
        assert.deepStrictEqual(legacyJsonSlot.frame.relighting, { temperature: 0, tint: 0, exposure: 0, contrast: 1, saturation: 1, highlights: 0, shadows: 0 }, 'Işık alanı olmayan eski JSON nötr değerlerle açılmalı');

        await page.locator('[data-view="templates"]').click();
        await page.locator('.ms-template-card').filter({ hasText: 'Test JSON Import Template' }).getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 6);
        await page.locator('.ms-layer[data-id="slot_01"]').click();
        assert.strictEqual(Number(await lightingNumber('temperature').inputValue()),22,'Şablon yeniden açıldığında ışık değerleri korunmalı');

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        for (const count of [1, 3, 7, 12]) {
            const variableSlots = Array.from({ length: count }, (_, index) => {
                const slot = importedSlot(`variable_${count}_${index + 1}`, index);
                slot.foregroundPolygons = [];
                return slot;
            });
            const variableDocument=JSON.parse(slotImportDocument(variableSlots));
            if(count===7)variableDocument.slots[2].relighting={temperature:'çok sıcak',exposure:0.5};
            await page.locator('#msJsonImportBtn').click();
            await page.locator('#msJsonInput').fill(JSON.stringify(variableDocument));
            await page.locator('#msJsonValidateBtn').click();
            assert.match(await page.locator('#msJsonValidation').textContent(), new RegExp(`${count} slot bulundu`), `${count} slotlu JSON doğrulanmalı`);
            if(count===7){assert.match(await page.locator('#msJsonValidation').textContent(), /slots\[2\]\.relighting\.temperature/, 'Geçersiz slot ışık alanı açıkça belirtilmeli');assert(!(await page.locator('#msJsonCreateBtn').isDisabled()),'Geçersiz tek ışık alanı diğer slotların içe aktarımını engellememeli');}
            await page.locator('#msJsonCreateBtn').click();
            await page.getByText(new RegExp(`${count} slot JSON’dan oluşturuldu`)).waitFor();
            assert.strictEqual(await page.locator('.ms-layer').count(), count, `JSON slots.length=${count} ise tam ${count} slot oluşturulmalı`);
            await page.locator('#msUndoBtn').click();
            await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 0);
        }
        const nineSlots = Array.from({ length: 9 }, (_, index) => {
            const slot = importedSlot(`json_slot_${index + 1}`, index);
            slot.foregroundPolygons = [];
            slot.depthOrder = 9 - index;
            return slot;
        });
        await page.locator('#msJsonImportBtn').click();
        await page.locator('#msJsonInput').fill(slotImportDocument(nineSlots));
        await page.locator('#msJsonValidateBtn').click();
        assert.match(await page.locator('#msJsonValidation').textContent(), /9 slot bulundu/);
        await page.locator('#msJsonCreateBtn').click();
        await page.getByText(/9 slot JSON’dan oluşturuldu/).waitFor();
        assert.strictEqual(await page.locator('.ms-layer').filter({ hasText: /JSON Slot|Ön Hero/ }).count(), 9, 'Dokuz slotlu JSON dokuz mevcut slot katmanı oluşturmalı');
        await page.locator('#msEditorName').fill('Test JSON Nine Slots');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        const nineSaved = db.templates.find(template => template.name === 'Test JSON Nine Slots');
        assert.strictEqual(nineSaved.slot_count, 9, 'Dokuz içe aktarılan slot şablon snapshotına kaydedilmeli');
        assert.strictEqual(nineSaved.document.layers.filter(layer => layer.type === 'product_slot')[0].name, 'JSON Slot 9', 'depthOrder katman sırasına aktarılmalı');
        await page.locator('[data-view="templates"]').click();
        await page.locator('.ms-template-card').filter({ hasText: 'Test JSON Nine Slots' }).getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 9);
        assert.strictEqual(await page.locator('.ms-layer').count(), 9, 'Şablon yeniden açılınca JSON slotları korunmalı');

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        const groupProductA = await makeSolidPng('#e04030');
        const groupProductB = await makeSolidPng('#2050d0');
        db.fixtureBodies.set('group-product-a.png', groupProductA);
        db.fixtureBodies.set('group-product-b.png', groupProductB);
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'group-product-a.png', mimeType: 'image/png', buffer: groupProductA });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'group-product-b.png', mimeType: 'image/png', buffer: groupProductB });
        await page.getByText(/tüm slotlarda önizlemeye alındı/).waitFor();
        const groupedSlots=Array.from({length:4},(_,index)=>{const slot=importedSlot(`smart_group_${index+1}`,index);slot.foregroundPolygons=[];slot.groupId=index<3?'package_group':'other_group';slot.effects.blur=index+1;slot.relighting={temperature:index*5};return slot;});
        await page.locator('#msJsonImportBtn').click();
        await page.locator('#msJsonInput').fill(slotImportDocument(groupedSlots));
        await page.locator('#msJsonValidateBtn').click();
        assert.match(await page.locator('#msJsonValidation').textContent(),/4 slot bulundu/,'Smart Slot Group slot sayısını sabitlememeli');
        await page.locator('#msJsonCreateBtn').click();
        await page.getByText(/4 slot JSON’dan oluşturuldu/).waitFor();
        await page.locator('.ms-asset-select').filter({hasText:'group-product-a.png'}).click();
        await page.locator('.ms-layer[data-id="smart_group_1"]').click();
        assert(await page.locator('#msApplyGroupProduct').isVisible(),'Gruplu slotta Ürünü Gruba Uygula görünmeli');
        assert(await page.locator('#msChangeGroupProduct').isVisible(),'Gruplu slotta Grup Ürününü Değiştir görünmeli');
        assert(await page.locator('#msDetachFromGroup').isVisible(),'Gruplu slotta gruptan ayırma kontrolü görünmeli');
        await page.locator('#msApplyGroupProduct').click();
        await page.getByText(/Ürün gruba uygulandı: 3 slot/).waitFor();
        for(const id of ['smart_group_1','smart_group_2','smart_group_3']){await page.locator(`.ms-layer[data-id="${id}"]`).click();assert.match(await page.locator('.ms-selected-product-preview').textContent(),/group-product-a\.png/,`${id} aynı grup ürününü göstermeli`);}
        await page.locator('.ms-layer[data-id="smart_group_4"]').click();
        assert.match(await page.locator('.ms-selected-product-preview').textContent(),/group-product-b\.png/,'Başka grup ürünü değişmemeli');
        await page.locator('.ms-asset-select').filter({hasText:'group-product-b.png'}).click();
        await page.locator('.ms-layer[data-id="smart_group_1"]').click();
        await page.locator('#msChangeGroupProduct').click();
        await page.getByText(/Grup ürünü değiştirildi: 3 slot/).waitFor();
        await page.locator('.ms-layer[data-id="smart_group_2"]').click();
        await page.locator('#msDetachFromGroup').click();
        await page.getByText(/grubundan ayrıldı/).waitFor();
        assert.strictEqual(await page.locator('#msApplyGroupProduct').count(),0,'Ayrılan slotta grup kontrolleri gizlenmeli');
        await page.locator('#msUndoBtn').click();
        await page.waitForFunction(()=>Boolean(document.querySelector('#msApplyGroupProduct')));
        await page.locator('#msRedoBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#msApplyGroupProduct'));
        await page.locator('.ms-asset-select').filter({hasText:'group-product-a.png'}).click();
        await page.locator('.ms-layer[data-id="smart_group_1"]').click();
        await page.locator('#msChangeGroupProduct').click();
        await page.getByText(/Grup ürünü değiştirildi: 2 slot/).waitFor();
        await page.locator('.ms-layer[data-id="smart_group_2"]').click();
        assert.match(await page.locator('.ms-selected-product-preview').textContent(),/group-product-b\.png/,'Gruptan ayrılan slot sonraki grup değişikliğinden etkilenmemeli');
        await page.locator('#msEditorName').fill('Test Smart Slot Group');await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        const groupSaved=db.templates.find(template=>template.name==='Test Smart Slot Group');
        const savedGroupSlots=groupSaved.document.layers.filter(layer=>layer.type==='product_slot');
        assert.strictEqual(savedGroupSlots.filter(layer=>layer.groupId==='package_group').length,2,'Yalnız grupta kalan slotların groupId değeri saklanmalı');
        assert.strictEqual(savedGroupSlots.find(layer=>layer.id==='smart_group_2').groupId,undefined,'Ayrılan slot şablonda gruptan bağımsız kaydedilmeli');
        assert(savedGroupSlots.every(layer=>layer.assetId===null),'Grup örnek ürünü nihai ürün bağını değiştirmemeli');
        assert.strictEqual(savedGroupSlots.find(layer=>layer.id==='smart_group_3').frame.blur,3,'Grup ürünü uygulanırken slot blur değeri korunmalı');
        assert.strictEqual(savedGroupSlots.find(layer=>layer.id==='smart_group_3').frame.relighting.temperature,10,'Grup ürünü uygulanırken slot ışık değeri korunmalı');
        await page.locator('[data-view="templates"]').click();
        await page.locator('.ms-template-card').filter({hasText:'Test Smart Slot Group'}).getByRole('button',{name:'Aç/Düzenle'}).click();
        await page.waitForFunction(()=>document.querySelectorAll('.ms-layer').length===4);
        await page.locator('.ms-layer[data-id="smart_group_1"]').click();
        assert(await page.locator('#msApplyGroupProduct').isVisible(),'Şablon yeniden açıldığında groupId ve grup kontrolleri korunmalı');

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
