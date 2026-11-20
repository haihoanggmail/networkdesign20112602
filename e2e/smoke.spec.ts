import { expect, Page, test } from '@playwright/test';

interface CspViolationEntry {
  blockedURI: string;
  violatedDirective: string;
}

async function setupWorkspaceAndGuards(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', err => {
    pageErrors.push(err.message || String(err));
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Vite HMR WebSocket is disabled in this environment; ignore only HMR socket noise
      if (!/WebSocket|vite/i.test(text)) {
        consoleErrors.push(text);
      }
    }
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('hachihi_quick_tour_done_v1', '1');
      localStorage.setItem('hachihi_last_seen_version', '3.1.1');
    } catch {
      // ignore storage errors
    }
    const w = window as unknown as { __cspViolations?: CspViolationEntry[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', ev => {
      w.__cspViolations?.push({
        blockedURI: ev.blockedURI || '',
        violatedDirective: ev.violatedDirective || ''
      });
    });
  });

  await page.goto('/');

  const welcomeCloseBtn = page.getByRole('button', { name: 'Đóng quản lý dự án' });
  try {
    await welcomeCloseBtn.waitFor({ state: 'visible', timeout: 8000 });
    await welcomeCloseBtn.click();
    await welcomeCloseBtn.waitFor({ state: 'hidden', timeout: 4000 });
  } catch {
    // Welcome modal already closed or skipped
  }

  const assertZeroRuntimeAndCspErrors = async () => {
    const cspViolations = await page.evaluate(() => {
      const w = window as unknown as { __cspViolations?: CspViolationEntry[] };
      return w.__cspViolations || [];
    });
    expect(cspViolations, 'Expected zero CSP violations').toEqual([]);
    expect(pageErrors, 'Expected zero uncaught page errors').toEqual([]);
    expect(consoleErrors, 'Expected zero fatal console errors').toEqual([]);
  };

  return { assertZeroRuntimeAndCspErrors };
}

async function openCommandPaletteAndRun(page: Page, query: string, optionMatcher: RegExp) {
  await page.getByRole('button', { name: 'Tìm kiếm và mở bảng lệnh' }).click();
  const palette = page.getByRole('dialog', { name: 'Bảng lệnh nhanh Ctrl+K' });
  await expect(palette).toBeVisible();
  const searchInput = palette.getByLabel('Tìm kiếm lệnh hoặc thiết bị');
  await searchInput.fill(query);
  await palette.getByRole('button', { name: optionMatcher }).first().click();
}

test.describe('HACHIHI Network & Electrical Designer E2E Suite (CA-06 & CA-14)', () => {
  test('01. Tải không gian làm việc, logo SVG Sáng/Tối, Giới thiệu HACHIHI & kiểm tra CSP sạch', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);

    const aboutTrigger = page.getByRole('button', { name: 'Giới thiệu HACHIHI' });
    await expect(aboutTrigger).toBeVisible();
    await expect(aboutTrigger.locator('svg').first()).toBeVisible();

    const width = page.viewportSize()?.width ?? 1440;
    const aboutBox = await aboutTrigger.boundingBox();
    expect(aboutBox).not.toBeNull();
    if (aboutBox) {
      expect(aboutBox.x).toBeGreaterThan(width / 2);
    }

    const themeBtn = page.getByRole('button', { name: /Chuyển sang chế độ/i });
    const themeBox = await themeBtn.boundingBox();
    if (aboutBox && themeBox) {
      expect(aboutBox.x).toBeGreaterThan(themeBox.x);
    }
    await themeBtn.click();
    await expect(page.getByRole('button', { name: 'Chuyển sang chế độ Sáng' })).toBeVisible();
    await page.getByRole('button', { name: 'Chuyển sang chế độ Sáng' }).click();

    await aboutTrigger.click();
    const aboutDialog = page.getByRole('dialog', { name: /Giới thiệu HACHIHI/i });
    await expect(aboutDialog).toBeVisible();
    await expect(aboutDialog.locator('svg').first()).toBeVisible();
    await expect(aboutDialog.getByText(/hachihi\.vn/).first()).toBeVisible();
    const contactTabBtn = aboutDialog.getByRole('button', { name: 'Liên hệ' });
    if (await contactTabBtn.isVisible()) {
      await contactTabBtn.click();
    }
    await expect(aboutDialog.getByText(/093 384 2126/)).toBeVisible();
    await page.getByRole('button', { name: 'Đóng cửa sổ Giới thiệu' }).click();
    await expect(aboutDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('02. Nạp mẫu LAN Star từ Thư viện mẫu & lưu bền vững qua tải lại trang', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      const fileBtn = page.getByRole('button', { name: 'Mở menu Tệp và Tạo mới' });
      await fileBtn.click();
      const fileMenu = page.getByRole('menu', { name: 'Menu Tệp và Tạo mới' });
      await expect(fileMenu).toBeVisible();
      await fileMenu.getByText('Chọn mẫu có sẵn').click();
    } else {
      await openCommandPaletteAndRun(page, 'thư viện mẫu', /Thư viện mẫu/i);
    }

    const tplDialog = page.getByRole('dialog', { name: /Thư Viện Mẫu/i });
    await expect(tplDialog).toBeVisible();
    const lanStarCard = tplDialog.getByText('Mạng LAN Cơ bản (Star 2-Tầng PoE)');
    await expect(lanStarCard).toBeVisible();
    await lanStarCard.click();
    await expect(tplDialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Giới thiệu HACHIHI' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở Trung tâm dự án' })).toContainText(/LAN/i);

    await assertZeroRuntimeAndCspErrors();
  });

  test('03. Mở Nhập/Xuất Cây Excel, xem trước Cây/Tầng/Bảng và tạo sơ đồ mới', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      await page.getByRole('button', { name: 'Mở menu Tệp và Tạo mới' }).click();
      await page.getByRole('menu', { name: 'Menu Tệp và Tạo mới' }).getByText('Nhập / Xuất Cây Excel').click();
    } else {
      await openCommandPaletteAndRun(page, 'excel', /Cây Excel|Excel/i);
    }

    const excelTreeDialog = page.getByRole('dialog', { name: /Tạo Sơ Đồ Router Đa Tầng Từ Excel/i });
    await expect(excelTreeDialog).toBeVisible();
    await excelTreeDialog.getByRole('button', { name: 'Xem thử mẫu' }).click();
    await expect(excelTreeDialog.getByText('Router-A1').first()).toBeVisible();
    await excelTreeDialog.getByRole('button', { name: /Xem trước sơ đồ/i }).click();
    await expect(excelTreeDialog.getByText(/Bản xem trước bố cục/i)).toBeVisible();
    await excelTreeDialog.getByRole('button', { name: /Cây dọc/i }).click();
    await excelTreeDialog.getByRole('button', { name: /Theo tầng/i }).click();
    await excelTreeDialog.getByRole('button', { name: /Bảng dữ liệu/i }).click();
    await expect(excelTreeDialog.getByText('Router-D1')).toBeVisible();
    await excelTreeDialog.getByRole('button', { name: /Tạo Sơ Đồ Từ Excel/i }).click();
    await expect(excelTreeDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('04. Thước căn lề kéo đường gióng 2D, thêm Bảng chú giải (L) & điều hướng responsive', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width < 768) {
      await expect(page.getByRole('navigation', { name: 'Thanh điều hướng nhanh' })).toBeVisible();
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      const drawer = page.getByRole('dialog', { name: 'Tính năng & Hồ sơ dự án' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Trung tâm dự án' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Thư viện mẫu' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      const topRuler = page.getByTestId('canvas-top-ruler');
      const leftRuler = page.getByTestId('canvas-left-ruler');
      await expect(topRuler).toBeVisible();
      await expect(leftRuler).toBeVisible();
      const topRulerBox = await topRuler.boundingBox();
      const leftRulerBox = await leftRuler.boundingBox();
      if (topRulerBox && leftRulerBox) {
        await page.mouse.move(topRulerBox.x + 120, topRulerBox.y + 8);
        await page.mouse.down();
        await page.mouse.move(topRulerBox.x + 120, topRulerBox.y + 180, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('[data-testid^="canvas-guide-line-h-"]')).toHaveCount(1);

        await page.mouse.move(leftRulerBox.x + 8, leftRulerBox.y + 120);
        await page.mouse.down();
        await page.mouse.move(leftRulerBox.x + 200, leftRulerBox.y + 120, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator('[data-testid^="canvas-guide-line-v-"]')).toHaveCount(1);
      }

      await page.keyboard.press('l');
      const legendResizeHandle = page.locator('[data-testid^="legend-resize-se-"]').first();
      await expect(legendResizeHandle).toBeVisible();
      const legendBox = await legendResizeHandle.boundingBox();
      if (legendBox) {
        await page.mouse.move(legendBox.x + legendBox.width / 2, legendBox.y + legendBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(legendBox.x + 120, legendBox.y + 70, { steps: 4 });
        await page.mouse.up();
      }
    }

    await assertZeroRuntimeAndCspErrors();
  });

  test('05. Quản lý lớp hiển thị & Phân lớp tự động theo ngữ nghĩa tiếng Việt', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width < 768) {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await page.getByRole('button', { name: 'Lớp hiển thị' }).click();
    } else {
      await page.getByRole('button', { name: 'Quản lý lớp hiển thị & khóa' }).click();
    }

    const autoLayerBtn = page.getByTestId('auto-layer-now-btn');
    await expect(autoLayerBtn).toBeVisible();
    await autoLayerBtn.click();
    await expect(page.getByText('Mạng (Network)').first()).toBeVisible();
    await expect(page.getByText('IoT & Cảm biến').first()).toBeVisible();
    await expect(page.getByText('Nguồn & Điện').first()).toBeVisible();
    await page.keyboard.press('Escape');

    await assertZeroRuntimeAndCspErrors();
  });

  test('06. Mở Kiểm tra kỹ thuật (Audit) và xác minh báo cáo lỗi / cảnh báo', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      await page.getByRole('button', { name: /Kiểm tra/i }).first().click();
    } else {
      await openCommandPaletteAndRun(page, 'kiem tra ky thuat', /Kiểm tra kỹ thuật/i);
    }

    const auditDialog = page.getByRole('dialog', { name: /Kiểm Tra Kỹ Thuật/i });
    await expect(auditDialog).toBeVisible();
    await expect(auditDialog.getByText(/Lỗi|Cảnh báo|Tổng/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Đóng bảng kiểm tra kỹ thuật' }).click();
    await expect(auditDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('07. Mở Bảng vật tư (BOM), duyệt đa góc nhìn, chốt mốc BOM & đối chiếu chênh lệch', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      await page.getByRole('button', { name: 'Mở Bảng vật tư (BOM)' }).click();
    } else {
      await openCommandPaletteAndRun(page, 'vat tu bom', /Bảng vật tư|BOM/i);
    }

    const bomDialog = page.getByRole('dialog', { name: /Thống kê Vật tư/i });
    await expect(bomDialog).toBeVisible();
    await expect(bomDialog.getByRole('tab', { name: /Thiết bị & SKU/i })).toBeVisible();
    await bomDialog.getByRole('tab', { name: /Dây cáp & Cắt cuộn/i }).click();
    await bomDialog.getByRole('tab', { name: /Đa góc nhìn/i }).click();
    await expect(bomDialog.getByText(/Theo Tầng/i).first()).toBeVisible();

    await bomDialog.getByRole('tab', { name: /So sánh BOM/i }).click();
    const lockBomBtn = bomDialog.getByRole('button', { name: /Chốt mốc BOM hiện tại/i });
    await expect(lockBomBtn).toBeVisible();
    await lockBomBtn.click();
    await expect(bomDialog.getByText(/Chênh lệch Dự toán/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(bomDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('08. Hộp thoại Xuất hồ sơ bản vẽ khóa đúng phạm vi 2D / 3D cho SVG, DXF & HTML Viewer', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      await page.getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    } else {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await page.getByRole('dialog', { name: 'Tính năng & Hồ sơ dự án' }).getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    }

    const exportDialog = page.getByRole('dialog', { name: /Xuất/i });
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.getByTestId('export-scope-2d')).toHaveAttribute('aria-pressed', 'true');
    await exportDialog.getByTestId('export-scope-3d').click();
    await expect(exportDialog.getByRole('button', { name: /Vector SVG Chuẩn CAD/i })).toBeDisabled();
    await expect(exportDialog.getByRole('button', { name: /AutoCAD DXF Đa Lớp/i })).toBeDisabled();
    await expect(exportDialog.getByRole('button', { name: /Trình Xem HTML Độc Lập/i })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('09. Bảng lệnh nhanh (Ctrl+K) tìm kiếm tiếng Việt không dấu & mở Trình tạo tòa nhà', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);

    await openCommandPaletteAndRun(page, 'toa nha', /Cấu hình tòa nhà nhiều tầng/i);
    const bldDialog = page.getByRole('dialog', { name: /Trình Tạo Tòa Nhà Nhiều Tầng Thông Minh/i });
    await expect(bldDialog).toBeVisible();
    await page.getByRole('button', { name: 'Đóng hộp thoại tạo tòa nhà' }).click();
    await expect(bldDialog).toBeHidden();

    await assertZeroRuntimeAndCspErrors();
  });

  test('10. Chuyển đổi 2D / 3D, kiểm tra XYZ Gizmo, Khóa kéo 3D & Bảng điều khiển chất lượng 3D', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    if (width < 768) {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      const mobile3DBtn = page.getByRole('button', { name: /Chuyển đổi 2D \/ 3D/i });
      await expect(mobile3DBtn).toBeVisible();
      await mobile3DBtn.click();
      await expect(page.getByText('Đang tải mô hình không gian 3D...')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible({ timeout: 25_000 });
      await page.getByRole('button', { name: /Về 2D CAD/i }).click();
      await expect(page.getByTestId('3d-xyz-gizmo')).toHaveCount(0);
    } else {
      const toggle3DBtn = page.getByTestId('toggle-3d-btn');
      const dragLock3DBtn = page.getByTestId('toggle-3d-drag-lock-btn');
      await expect(toggle3DBtn).toBeVisible();
      await expect(dragLock3DBtn).toHaveCount(0);
      await expect(page.getByTestId('toggle-3d-label-2d')).toHaveClass(/opacity-100/);
      await expect(page.getByTestId('toggle-3d-label-3d')).toHaveClass(/opacity-45/);

      await toggle3DBtn.click();
      await expect(page.getByText('Đang tải mô hình không gian 3D...')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('3d-floor-hud-panel')).toBeVisible();
      await expect(page.getByTestId('3d-floor-select')).toBeVisible();
      await expect(page.getByTestId('toggle-3d-label-3d')).toHaveClass(/opacity-100/);
      await expect(page.getByTestId('toggle-3d-label-2d')).toHaveClass(/opacity-45/);

      await expect(page.getByRole('button', { name: 'Phòng (R)' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Chữ (T)' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Đo (M)' })).toBeDisabled();

      const shadowToggle = page.locator('#shadow-toggle-button');
      if (await shadowToggle.isVisible()) {
        await shadowToggle.click();
      }

      await expect(dragLock3DBtn).toBeVisible();
      await expect(dragLock3DBtn).toHaveAttribute('aria-pressed', 'false');
      await dragLock3DBtn.click();
      await expect(dragLock3DBtn).toHaveAttribute('aria-pressed', 'true');

      await toggle3DBtn.click();
      await expect(dragLock3DBtn).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Phòng (R)' })).toBeEnabled();
    }

    await assertZeroRuntimeAndCspErrors();
  });

  test('11. Phục hồi WebGL khi mất ngữ cảnh 3D & kiểm thử Undo/Redo liên tiếp không mất dữ liệu', async ({ page }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    // 1. Rapid Undo/Redo stress check in 2D using keyboard shortcuts (Add Rack or Legend then undo/redo rapidly)
    if (width >= 768) {
      await page.keyboard.press('l');
      const legendHandles = page.locator('[data-testid^="legend-resize-se-"]');
      await expect(legendHandles.first()).toBeVisible();
      const countWithLegend = await legendHandles.count();

      // Rapid Undo -> Redo -> Undo -> Redo
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+y');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+y');
      await expect(legendHandles).toHaveCount(countWithLegend);

      // 2. Switch to 3D, simulate WebGL context lost, verify recovery overlay & restore
      const toggle3DBtn = page.getByTestId('toggle-3d-btn');
      await toggle3DBtn.click();
      await expect(page.getByText('Đang tải mô hình không gian 3D...')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible({ timeout: 25_000 });

      await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const mainCanvas = canvases.find(c => c.clientWidth > 120 && c.clientHeight > 120) || canvases[0];
        if (!mainCanvas) throw new Error('3D canvas not found');
        mainCanvas.dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
      });

      const retryBtn = page.getByTestId('retry-webgl-3d-btn');
      await expect(retryBtn).toBeVisible();
      await retryBtn.click();
      await expect(retryBtn).toBeHidden({ timeout: 15_000 });
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible({ timeout: 20_000 });

      await toggle3DBtn.click();
      await expect(page.getByTestId('3d-xyz-gizmo')).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await page.getByRole('button', { name: /Chuyển đổi 2D \/ 3D/i }).click();
      await expect(page.getByText('Đang tải mô hình không gian 3D...')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible({ timeout: 25_000 });
      await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        canvas?.dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
      });
      const retryBtn = page.getByTestId('retry-webgl-3d-btn');
      await expect(retryBtn).toBeVisible();
      await retryBtn.click();
      await expect(retryBtn).toBeHidden({ timeout: 15_000 });
      await page.getByRole('button', { name: /Về 2D CAD/i }).click();
    }

    await assertZeroRuntimeAndCspErrors();
  });

  test('12. Xuất HTML độc lập đa tầng có thanh chọn tầng (#selFloor2d), chuyển chế độ & xem toàn nhà không lỗi', async ({ page, context }) => {
    const { assertZeroRuntimeAndCspErrors } = await setupWorkspaceAndGuards(page);
    const width = page.viewportSize()?.width ?? 1440;

    // Load 3-floor Sample Office project so multi-floor export has 3 floors
    if (width >= 768) {
      await page.getByRole('button', { name: 'Mở menu Tệp và Tạo mới' }).click();
      await page.getByRole('menu', { name: 'Menu Tệp và Tạo mới' }).getByText('Chọn mẫu có sẵn').click();
    } else {
      await openCommandPaletteAndRun(page, 'thư viện mẫu', /Thư viện mẫu/i);
    }

    const tplDialog = page.getByRole('dialog', { name: /Thư Viện Mẫu/i });
    await expect(tplDialog).toBeVisible();
    await tplDialog.getByText('Văn phòng 3 Tầng Hoàn chỉnh').click();
    await expect(tplDialog).toBeHidden();

    // Open Export modal and download standalone HTML
    if (width >= 768) {
      await page.getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    } else {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await page.getByRole('dialog', { name: 'Tính năng & Hồ sơ dự án' }).getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    }

    const exportDialog = page.getByRole('dialog', { name: /Xuất/i });
    await expect(exportDialog).toBeVisible();

    // Verify floorScope selector & live SVG preview respond dynamically
    const floorScopeSelect = exportDialog.getByTestId('export-floor-scope');
    await expect(floorScopeSelect).toBeVisible();
    await expect(floorScopeSelect).toHaveValue('all');
    const previewImg = exportDialog.getByTestId('export-preview-img');
    await expect(previewImg).toBeVisible();
    const allFloorsPreviewSrc = await previewImg.getAttribute('src');
    expect(allFloorsPreviewSrc).toContain('data:image/svg+xml');

    const floorScopeValues = await floorScopeSelect.locator('option').evaluateAll(opts =>
      opts.map(o => (o as HTMLOptionElement).value)
    );
    expect(floorScopeValues.length).toBeGreaterThanOrEqual(4); // all + 3 floors
    await floorScopeSelect.selectOption(floorScopeValues.find(v => v !== 'all')!);
    const singleFloorPreviewSrc = await previewImg.getAttribute('src');
    expect(singleFloorPreviewSrc).toContain('data:image/svg+xml');
    expect(singleFloorPreviewSrc).not.toEqual(allFloorsPreviewSrc);
    await floorScopeSelect.selectOption('all');

    const downloadPromise = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: /Trình Xem HTML Độc Lập/i }).click();
    const download = await downloadPromise;
    const htmlPath = await download.path();
    expect(htmlPath).toBeTruthy();

    const fs = await import('node:fs');
    const exportedHtml = fs.readFileSync(htmlPath!, 'utf8');
    expect(exportedHtml).toContain('id="selFloor2d"');
    expect(exportedHtml).not.toContain('id="floorNavBar"');
    expect(exportedHtml).toContain('window.HachihiProjectData');
    expect(exportedHtml).toContain('__ALL__');

    // Open the exported standalone HTML file in a real Playwright page and verify interactive floor/mode switching
    const viewerPage = await context.newPage();
    const viewerErrors: string[] = [];
    viewerPage.on('pageerror', err => viewerErrors.push(err.message || String(err)));
    await viewerPage.setContent(exportedHtml, { waitUntil: 'domcontentloaded' });

    const projectDataFloorsCount = await viewerPage.evaluate(() => {
      const w = window as unknown as { HachihiProjectData?: { floors?: unknown[] } };
      return Array.isArray(w.HachihiProjectData?.floors) ? w.HachihiProjectData!.floors.length : 0;
    });
    expect(projectDataFloorsCount).toBeGreaterThanOrEqual(3);

    const diagTab = viewerPage.locator('#tabDiag');
    await expect(diagTab).toBeVisible();
    await diagTab.click();

    await expect(viewerPage.locator('#floorNavBar')).toHaveCount(0);

    const floorSel = viewerPage.locator('#selFloor2d');
    const modeSel = viewerPage.locator('#selMode2d');
    await expect(floorSel).toBeVisible();
    await expect(modeSel).toBeVisible();

    const optionValues = await floorSel.locator('option').evaluateAll(opts =>
      opts.map(o => (o as HTMLOptionElement).value)
    );
    expect(optionValues).toContain('__ALL__');
    expect(optionValues.length).toBeGreaterThanOrEqual(4); // __ALL__ + 3 floors

    // Select an individual floor via dropdown and verify stage updates cleanly
    const singleFloorId = optionValues.find(v => v !== '__ALL__')!;
    await floorSel.selectOption(singleFloorId);
    await expect(floorSel).toHaveValue(singleFloorId);
    await expect(viewerPage.locator('#stage svg').first()).toBeVisible();

    // Switch back to all-building view via dropdown, then test topology/floorplan toggle
    await floorSel.selectOption('__ALL__');
    await expect(floorSel).toHaveValue('__ALL__');
    await expect(viewerPage.locator('#stage svg').first()).toBeVisible();

    await modeSel.selectOption('floorplan');
    await expect(viewerPage.locator('#stage svg').first()).toBeVisible();

    // Switch to 3D tab inside standalone HTML viewer and verify 3D WebGL canvas + error diagnostics & recovery
    const tab3D = viewerPage.locator('#tab3D');
    await expect(tab3D).toBeVisible();
    await tab3D.click();

    const canvas3d = viewerPage.locator('#canvas3dHost canvas');
    const fallbackEl = viewerPage.locator('#webglFallback');
    await expect(viewerPage.locator('#view3D')).toBeVisible();

    // Wait for either active 3D WebGL canvas or explicit diagnostic fallback (if headless GPU unavailable)
    await expect(canvas3d.or(fallbackEl)).toBeVisible({ timeout: 20_000 });
    if (await canvas3d.isVisible()) {
      const box = await canvas3d.boundingBox();
      expect(box && box.width > 100 && box.height > 100).toBeTruthy();

      // Simulate webglcontextlost on standalone viewer 3D canvas -> diagnostic UI must appear
      await viewerPage.evaluate(() => {
        const c = document.querySelector('#canvas3dHost canvas');
        if (!c) throw new Error('Standalone 3D canvas missing');
        c.dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
      });
      await expect(fallbackEl).toBeVisible();
      await expect(viewerPage.locator('#webglErrorStep')).toHaveText('context-lost');
      await expect(viewerPage.locator('#webglErrorCode')).toHaveText('WEBGL_CONTEXT_LOST');

      // Retry 3D must dispose & recreate clean canvas without errors
      await viewerPage.locator('#btnRetry3D').click();
      await expect(fallbackEl).toBeHidden({ timeout: 15_000 });
      await expect(viewerPage.locator('#canvas3dHost canvas')).toBeVisible({ timeout: 15_000 });

      // Simulate context loss again and test Fallback to 2D button
      await viewerPage.evaluate(() => {
        const c = document.querySelector('#canvas3dHost canvas');
        c?.dispatchEvent(new Event('webglcontextlost', { bubbles: true, cancelable: true }));
      });
      await expect(fallbackEl).toBeVisible();
      await viewerPage.locator('#btnFallback2D').click();
      await expect(viewerPage.locator('#viewDiag')).toBeVisible();
      await expect(viewerPage.locator('#stage svg').first()).toBeVisible();
    } else {
      // Headless environment without WebGL: diagnostic card + Fallback 2D must still work cleanly
      await expect(viewerPage.locator('#webglErrorStep')).not.toHaveText('—');
      await expect(viewerPage.locator('#webglErrorCode')).not.toHaveText('—');
      await viewerPage.locator('#btnFallback2D').click();
      await expect(viewerPage.locator('#viewDiag')).toBeVisible();
    }

    expect(viewerErrors, 'Expected zero JS errors inside exported standalone HTML viewer').toEqual([]);
    await viewerPage.close();

    await page.keyboard.press('Escape');
    await assertZeroRuntimeAndCspErrors();
  });

  test('13. 8 cải tiến UX Đợt 4: Màn hình bắt đầu nhanh, Phân nhóm thư viện, Chế độ Cơ bản/Kỹ sư, Trạng thái lưu & 4 tab Xuất hồ sơ', async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message || String(err)));
    page.on('console', msg => {
      if (msg.type() === 'error' && !/WebSocket|vite/i.test(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      try {
        localStorage.setItem('hachihi_quick_tour_done_v1', '1');
        localStorage.setItem('hachihi_last_seen_version', '3.1.1');
      } catch {
        // ignore
      }
    });

    await page.goto('/');

    // 1. Welcome Quick Start cards (waits for IndexedDB hydration to open welcome hub)
    const quickStart = page.getByTestId('welcome-quick-start');
    const welcomeCloseBtn = page.getByRole('button', { name: 'Đóng quản lý dự án' });
    try {
      await welcomeCloseBtn.waitFor({ state: 'visible', timeout: 8000 });
      await expect(quickStart).toBeVisible();
      await expect(quickStart.getByRole('button', { name: /Tạo dự án mới/i })).toBeVisible();
      await expect(quickStart.getByRole('button', { name: /Mở dự án gần đây/i })).toBeVisible();
      await expect(quickStart.getByRole('button', { name: /Chọn mẫu có sẵn/i })).toBeVisible();
      await expect(quickStart.getByRole('button', { name: /Nhập dự án Excel/i })).toBeVisible();
      await welcomeCloseBtn.click();
      await welcomeCloseBtn.waitFor({ state: 'hidden', timeout: 4000 });
    } catch {
      // Welcome modal skipped if existing projects prevented welcome prompt
    }

    const width = page.viewportSize()?.width ?? 1440;

    if (width >= 768) {
      // 2. StatusBar save indicator & clickable audit button
      await expect(page.getByTestId('statusbar-save-status')).toBeVisible();

      // 3. Basic vs Advanced Mode toggle on QuickAccessBar
      const basicBtn = page.getByTestId('experience-mode-basic');
      const advancedBtn = page.getByTestId('experience-mode-advanced');
      await expect(basicBtn).toBeVisible();
      await expect(advancedBtn).toBeVisible();
      await expect(advancedBtn).toHaveAttribute('aria-pressed', 'true');

      await basicBtn.click();
      await expect(basicBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: /Định tuyến cáp/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Nâng cao/i })).toHaveCount(0);

      await advancedBtn.click();
      await expect(advancedBtn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: /Định tuyến cáp/i })).toBeVisible();
    }

    if (width >= 1280) {
      // 4. Device Library quick category chips (Router/Switch/Firewall/Server/Camera/AP/UPS)
      const switchFilter = page.getByTestId('library-cat-filter-switch');
      await expect(switchFilter).toBeVisible();
      await switchFilter.click();
      await expect(switchFilter).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('library-cat-filter-all').click();
    }

    // 5. Categorized Export Modal (4 tabs + Live Preview)
    if (width >= 768) {
      await page.getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    } else {
      await page.getByRole('button', { name: 'Kiểm tra, Xuất và Dự án' }).click();
      await page.getByRole('dialog', { name: 'Tính năng & Hồ sơ dự án' }).getByRole('button', { name: 'Xuất hồ sơ bản vẽ' }).click();
    }

    const exportDialog = page.getByRole('dialog', { name: /Xuất/i });
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.getByTestId('export-tab-drawings')).toHaveAttribute('aria-selected', 'true');
    await expect(exportDialog.getByTestId('export-preview-card')).toBeVisible();

    await exportDialog.getByTestId('export-tab-bom').click();
    await expect(exportDialog.getByText(/Xuất Excel Kỹ Thuật/i)).toBeVisible();

    await exportDialog.getByTestId('export-tab-report').click();
    await expect(exportDialog.getByText(/Báo Cáo & Bản Vẽ PDF Kỹ Thuật/i)).toBeVisible();

    await exportDialog.getByTestId('export-tab-handover').click();
    await expect(exportDialog.getByRole('button', { name: /Tải gói bàn giao hồ sơ ZIP tổng hợp/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    expect(pageErrors, 'Expected zero uncaught page errors').toEqual([]);
    expect(consoleErrors, 'Expected zero fatal console errors').toEqual([]);
  });
});
