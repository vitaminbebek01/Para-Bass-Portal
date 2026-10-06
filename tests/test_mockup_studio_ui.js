const { chromium } = require('playwright');
const crypto = require('crypto');
const assert = require('assert');

const baseUrl = process.env.MOCKUP_TEST_URL || 'http://localhost:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69d9WQAAAABJRU5ErkJggg==', 'base64');

const db = { templates: [], versions: [], products: [], outputs: [], assets: [], storage: new Set() };
const now = () => new Date().toISOString();

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.searchParams.has('asset')) {
        if (!db.storage.has(url.searchParams.get('asset'))) return json(route, { error: 'Dosya bulunamadı.' }, 404);
        return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    }
    if (method === 'GET') {
        const resource = url.searchParams.get('resource') || 'templates';
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
    return json(route, { error: 'Unhandled mock request' }, 400);
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

    const openMockup = async () => {
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.locator('[data-view="editor"]').click();
    };

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await openMockup();

        const productInput = page.locator('#msEditorProductInput');
        await productInput.setInputFiles({ name: 'product_box_clean.png', mimeType: 'image/png', buffer: png });
        await page.locator('.ms-layer').waitFor();
        let slotCount = await page.locator('.ms-layer').count();
        while (slotCount < 3) {
            await page.locator('#msNewSlotBtn').click();
            slotCount += 1;
            await page.waitForFunction((count) => document.querySelectorAll('.ms-layer').length === count, slotCount);
        }
        assert.strictEqual(await page.locator('.ms-layer').count(), 3, '3 ürün slotu oluşmalı');
        await page.locator('.ms-layer').nth(1).click({ modifiers: ['Control'] });
        await page.locator('.ms-layer').nth(2).click({ modifiers: ['Control'] });
        await page.locator('#msAddSlotBtn').click();
        await page.getByText('Ürün 3 slota yerleştirildi.').waitFor();

        const frames = [
            { x: '400', rotation: '-12' },
            { x: '1000', rotation: '0' },
            { x: '1600', rotation: '18' }
        ];
        for (let index = 0; index < frames.length; index += 1) {
            await page.locator('.ms-layer').nth(index).click();
            await page.locator('[data-frame-key="x"]').fill(frames[index].x);
            await page.locator('[data-frame-key="x"]').press('Tab');
            await page.locator('[data-frame-key="rotation"]').fill(frames[index].rotation);
            await page.locator('[data-frame-key="rotation"]').press('Tab');
        }

        await page.locator('.ms-layer').nth(0).click();
        await page.locator('[data-frame-key="brightness"]').fill('35');
        await page.locator('[data-frame-key="brightness"]').press('Tab');
        await page.locator('[data-frame-key="contrast"]').fill('20');
        await page.locator('[data-frame-key="contrast"]').press('Tab');
        await page.locator('.ms-layer').nth(1).click();
        assert.strictEqual(await page.locator('[data-frame-key="brightness"]').inputValue(), '0', 'İkinci slotun parlaklığı bağımsız kalmalı');
        assert.strictEqual(await page.locator('[data-frame-key="contrast"]').inputValue(), '0', 'İkinci slotun kontrastı bağımsız kalmalı');

        const xInput = page.locator('[data-frame-key="x"]');
        const originalX = await xInput.inputValue();
        await xInput.fill('1450');
        await xInput.press('Tab');
        await page.locator('#msUndoBtn').click();
        await page.waitForFunction(() => document.querySelector('[data-frame-key="x"]')?.value !== '1450');
        assert.strictEqual(await page.locator('[data-frame-key="x"]').inputValue(), originalX, 'Undo tek slot değişikliğini geri almalı');
        await page.locator('#msRedoBtn').click();
        await page.waitForFunction(() => document.querySelector('[data-frame-key="x"]')?.value === '1450');
        assert.strictEqual(await page.locator('[data-frame-key="x"]').inputValue(), '1450', 'Redo tek slot değişikliğini yinelemeli');

        await page.locator('#msSceneInput').setInputFiles({ name: 'open_box_scene.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 4);
        await page.locator('#msMaskInput').setInputFiles({ name: 'box_front_edge.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 5);

        await page.locator('#msEditorName').fill('Test White Box Hero');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();
        assert.strictEqual(db.templates[0].slot_count, 3, 'Kaydedilen şablonda 3 slot olmalı');
        assert.strictEqual(db.templates[0].document.layers[0].type, 'scene_background', 'Arka sahne en altta olmalı');
        assert(db.templates[0].document.layers.slice(1, -1).every(layer => layer.type === 'product_slot'), 'Ürün slotları sahne ile maskenin arasında olmalı');
        assert.strictEqual(new Set(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot').map(layer => layer.assetId)).size, 1, 'Aynı ürün üç slota bağlanmalı');
        assert.strictEqual(new Set(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot').map(layer => `${layer.frame.x}:${layer.frame.rotation}`)).size, 3, 'Slot dönüşümleri bağımsız kalmalı');
        assert.strictEqual(db.templates[0].document.layers.filter(layer => layer.type === 'product_slot' && layer.frame.brightness === 35 && layer.frame.contrast === 20).length, 1, 'Görsel ayarları yalnızca değiştirilen slota kaydedilmeli');
        assert.strictEqual(db.templates[0].document.layers.at(-1).type, 'foreground_mask', 'Foreground mask ürünün önünde olmalı');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.getByText('Test White Box Hero', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Aç/Düzenle' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ms-layer').length === 5);
        assert.strictEqual(await page.locator('.ms-layer').count(), 5, 'Şablon yeniden açılınca açık kutu katmanları korunmalı');

        await page.locator('[data-view="templates"]').click();
        await page.locator('#msNewTemplateBtn').click();
        await page.locator('#msEditorProductInput').setInputFiles({ name: 'second_product.png', mimeType: 'image/png', buffer: png });
        await page.locator('.ms-layer').waitFor();
        await page.locator('#msEditorName').fill('Test Second Template');
        await page.locator('#msEditorName').press('Tab');
        await page.locator('#msSaveBtn').click();
        await page.getByText(/Şablon v1 olarak kaydedildi/).waitFor();

        await page.locator('[data-view="templates"]').click();
        const firstCard = page.locator('.ms-template-card').filter({ hasText: 'Test White Box Hero' });
        const secondCard = page.locator('.ms-template-card').filter({ hasText: 'Test Second Template' });
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
        page.once('dialog', dialog => dialog.accept());
        await usedProductCard.locator('.ms-product-delete').click();
        await page.getByText('Kullanılmış ürün aktif listeden kaldırıldı; eski çıktılar korundu.').waitFor();
        assert(usedProduct.deleted_at, 'Kullanılmış ürün yumuşak silinmeli');
        assert(db.storage.has(usedProduct.storage_path), 'Kullanılmış ürünün Storage dosyası korunmalı');
        assert.strictEqual(await page.locator('.ms-product-card').filter({ hasText: 'second_product.png' }).count(), 0, 'Kullanılmış ürün aktif listeden kalkmalı');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#menuStudio').click();
        await page.locator('#tabMockupStudio').click();
        await page.locator('[data-view="outputs"]').click();
        assert.strictEqual(await page.getByText(/Test Kalıcı Çıktı – Test/).count(), 2, 'İki çıktı yenileme sonrası kalmalı');

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
