import { getSales, getSale, createSale, updateSale, deleteSale, getProducts } from '../api.js';
import { createDataTable } from '../components/table.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { buildForm } from '../components/form.js';
import { detailsGrid, readOnlyNotice } from '../components/cards.js';
import { icon } from '../components/icons.js';
import { showToast } from '../components/toast.js';
import { escapeHtml, formatDate, formatCurrency, isWholeNumber, isNonNegativeNumber, todayISO } from '../utils.js';

export function mount(container, ctx) {
  let cancelled = false;
  let rows = [];
  let productsList = [];
  let table = null;

  const pageEl = document.createElement('div');
  pageEl.innerHTML = `
    <div class="stack-md" style="gap:24px;">
      <div class="page-head" id="sales-head"></div>
      <div id="sales-host"></div>
    </div>`;
  container.appendChild(pageEl);

  const host = pageEl.querySelector('#sales-host');
  const head = pageEl.querySelector('#sales-head');

  function renderHead() {
    head.innerHTML = `
      <div>
        <h1>Sales</h1>
        <p>Sales records captured by the team.</p>
      </div>
      <div class="page-actions">
        ${ctx.hasPermission('sales.create') ? `
          <button type="button" class="btn btn-primary" id="sale-add">
            ${icon('plus', 16)} Add New
          </button>` : readOnlyNotice()}
      </div>`;
    head.querySelector('#sale-add')?.addEventListener('click', () => openSaleModal());
  }

  function columns() {
    return [
      { key: 'id', label: 'Sale ID', className: 'nowrap cell-mono', render: (row) => escapeHtml(row.id), sortValue: (row) => row.id },
      { key: 'date', label: 'Date', className: 'nowrap', render: (row) => formatDate(row.date), sortValue: (row) => row.date },
      { key: 'user', label: 'Salesperson', className: 'nowrap', render: (row) => `<span class="cell-strong">${escapeHtml(row.user)}</span>`, exportValue: (row) => row.user },
      { key: 'items', label: 'Items', className: 'nowrap', render: (row) => String(row.items), sortValue: (row) => Number(row.items) },
      {
        key: 'total',
        label: 'Total',
        className: 'nowrap',
        render: (row) => `<span class="cell-strong">${formatCurrency(row.total)}</span>`,
        sortValue: (row) => Number(row.total),
        exportValue: (row) => row.total,
      },
    ];
  }

  function tableConfig() {
    return {
      columns: columns(),
      initialRows: rows,
      searchKeys: ['id', 'user'],
      filters: [
        {
          key: 'user',
          label: 'Salesperson',
          options: () => [...new Set(rows.map((row) => row.user))].filter(Boolean).sort().map((u) => ({ value: u, label: u })),
        },
      ],
      dateKey: 'date',
      pageSize: 8,
      initialSort: { key: 'date', dir: 'desc' },
      exportFilename: 'sales-report',
      toolbar: [
        {
          id: 'generate-report',
          label: 'Generate Report',
          icon: 'download',
          variant: 'secondary',
          when: () => ctx.hasPermission('reports.generate'),
          onClick: () => {
            const count = table.exportCSV('sales-report');
            showToast(`Report generated — ${count} records exported to CSV.`, 'success');
          },
        },
      ],
      rowActions: (row) => [
        { id: 'view', label: 'View details', icon: 'eye', onClick: () => openSaleDetails(row) },
        ...(ctx.hasPermission('sales.update') || ctx.hasPermission('sales.edit') ? [{ id: 'edit', label: 'Edit sale', icon: 'edit', onClick: () => openSaleModal(row) }] : []),
        ...(ctx.hasPermission('sales.delete') ? [{ id: 'delete', label: 'Delete sale', icon: 'trash', danger: true, onClick: () => handleDeleteSale(row) }] : []),
      ],
      emptyState: {
        icon: 'sales',
        title: 'No sales recorded',
        message: 'Sales will appear here once recorded.',
      },
    };
  }

  async function handleDeleteSale(row) {
    const confirmed = await confirmDialog({
      title: 'Delete sale',
      message: `Are you sure you want to delete sale ${row.id}? This will restore the product stock.`,
      confirmLabel: 'Delete sale',
      danger: true,
    });

    if (!confirmed) return;

    try {
      await deleteSale(row.id);
      showToast(`Sale ${row.id} deleted.`, 'success');
      await reload();
    } catch (error) {
      showToast(error.message || 'Failed to delete sale.', 'error');
    }
  }

  async function openSaleDetails(row) {
    let detailsContent = detailsGrid([
      { label: 'Sale ID', value: `<span class="mono">${escapeHtml(row.id)}</span>` },
      { label: 'Date', value: formatDate(row.date) },
      { label: 'Salesperson', value: escapeHtml(row.user) },
      { label: 'Items count', value: String(row.items) },
      { label: 'Total amount', value: formatCurrency(row.total) },
      { label: 'Status', value: `<span class="badge badge-success badge-dot">${escapeHtml(row.status || 'completed')}</span>` },
    ]);

    try {
      const fullSale = await getSale(row.id);
      const items = fullSale?.itemList || fullSale?.items || [];
      if (Array.isArray(items) && items.length > 0) {
        detailsContent += `
          <div style="margin-top:20px;">
            <h4 style="font-size:13px; font-weight:600; margin-bottom:8px; color:var(--text-muted, #64748b);">Sold Items Breakdown</h4>
            <div style="overflow-x:auto;">
              <table class="data-table" style="width:100%; font-size:13px; border-collapse:collapse;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border, #e2e8f0); text-align:left;">
                    <th style="padding:6px 8px;">Product</th>
                    <th style="padding:6px 8px;">SKU</th>
                    <th style="padding:6px 8px; text-align:right;">Qty</th>
                    <th style="padding:6px 8px; text-align:right;">Price</th>
                    <th style="padding:6px 8px; text-align:right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${items
                    .map(
                      (it) => `
                    <tr style="border-bottom:1px solid var(--border, #f1f5f9);">
                      <td style="padding:6px 8px; font-weight:500;">${escapeHtml(it.productName || it.product_name || 'Product')}</td>
                      <td style="padding:6px 8px; font-family:monospace; font-size:12px;">${escapeHtml(it.sku || '—')}</td>
                      <td style="padding:6px 8px; text-align:right;">${it.quantity}</td>
                      <td style="padding:6px 8px; text-align:right;">${formatCurrency(it.unitPrice || it.unit_price)}</td>
                      <td style="padding:6px 8px; text-align:right; font-weight:600;">${formatCurrency(it.total)}</td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      }
    } catch {}

    const detailActions = [];
    if (ctx.hasPermission('sales.update') || ctx.hasPermission('sales.edit')) {
      detailActions.push({ label: 'Edit sale', variant: 'primary', onClick: (close) => { close(); openSaleModal(row); } });
    }
    if (ctx.hasPermission('sales.delete')) {
      detailActions.push({ label: 'Delete sale', variant: 'danger', onClick: (close) => { close(); handleDeleteSale(row); } });
    }

    openModal({
      title: `Sale Details`,
      subtitle: `Reference: ${row.id} · ${formatDate(row.date)}`,
      size: 'md',
      content: detailsContent,
      actions: detailActions,
    });
  }

  function openSaleModal(existing = null) {
    const currentUserName = ctx.user?.name || 'Sales Manager';
    const salespeople = [...new Set([currentUserName, ...rows.map((row) => row.user)])].filter(Boolean).sort();

    if (existing) {
      // Editing existing sale
      const fields = [
        { name: 'user', label: 'Salesperson', type: 'select', required: true, options: salespeople.map((u) => ({ value: u, label: u })) },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'items', label: 'Items sold', type: 'number', required: true, step: '1', min: 0 },
        { name: 'total', label: 'Total (₹)', type: 'number', required: true, step: '0.01', min: 0 },
      ];
      const values = {
        user: existing.user,
        date: String(existing.date).slice(0, 10),
        items: existing.items,
        total: existing.total,
      };

      const form = buildForm(fields, values, { idPrefix: 'sale-form' });

      const modal = openModal({
        title: 'Edit sale',
        subtitle: `Editing ${existing.id}`,
        content: form.element,
        actions: [
          { label: 'Cancel', variant: 'secondary' },
          { label: 'Save changes', variant: 'primary', onClick: (close) => handleEditSubmit(close) },
        ],
      });

      async function handleEditSubmit(close) {
        const vals = form.getValues();
        const errors = {};
        if (!vals.user) errors.user = 'Choose a salesperson.';
        if (!isWholeNumber(vals.items)) errors.items = 'Items must be a whole number of 0 or more.';
        if (!isNonNegativeNumber(vals.total)) errors.total = 'Total must be a number of 0 or more.';
        form.clearErrors();
        const result = form.validateRequired(errors);
        if (!result.valid) {
          result.focusFirst();
          return;
        }
        const btn = modal.element.querySelector('.modal-foot .btn-primary');
        btn.disabled = true;
        try {
          const payload = {
            user: vals.user,
            date: vals.date,
            items: Number(vals.items),
            total: Number(vals.total),
          };
          const updated = await updateSale(existing.id, payload);
          showToast(`Sale ${updated.id} updated.`, 'success');
          close();
          await reload();
        } catch (error) {
          form.clearErrors();
          form.showBanner(error.message || 'Something went wrong.');
          result.focusFirst();
          btn.disabled = false;
        }
      }
      return;
    }

    // Creating new sale with product selection and automatic total calculation
    if (productsList.length === 0) {
      showToast('No products available. Please add products first.', 'error');
      return;
    }

    const defaultProduct = productsList.find((p) => Number(p.quantity) > 0) || productsList[0];
    const initialPrice = defaultProduct ? Number(defaultProduct.price) : 0;
    const initialQty = defaultProduct && Number(defaultProduct.quantity) > 0 ? 1 : 0;
    const initialTotal = (initialQty * initialPrice).toFixed(2);

    const productOptions = productsList.map((p) => ({
      value: p.id,
      label: `${p.name} (${p.sku}) — ₹${Number(p.price).toFixed(2)} [${p.quantity} in stock]`,
    }));

    const fields = [
      {
        name: 'user',
        label: 'Salesperson',
        type: 'select',
        required: true,
        options: salespeople.map((u) => ({ value: u, label: u })),
      },
      {
        name: 'date',
        label: 'Sale Date',
        type: 'date',
        required: true,
      },
      {
        name: 'productId',
        label: 'Select Product',
        type: 'select',
        required: true,
        span: 2,
        options: productOptions,
      },
      {
        name: 'unitPrice',
        label: 'Unit Price (₹)',
        type: 'number',
        readonly: true,
        step: '0.01',
      },
      {
        name: 'quantity',
        label: 'Quantity Sold',
        type: 'number',
        required: true,
        step: '1',
        min: 1,
        hint: defaultProduct ? `Available stock: ${defaultProduct.quantity} units` : '',
      },
      {
        name: 'total',
        label: 'Total Amount (₹)',
        type: 'number',
        readonly: true,
        step: '0.01',
        span: 2,
        hint: 'Calculated automatically (Quantity × Unit Price)',
      },
    ];

    const values = {
      user: currentUserName,
      date: todayISO(),
      productId: defaultProduct ? defaultProduct.id : '',
      unitPrice: initialPrice,
      quantity: initialQty,
      total: initialTotal,
    };

    const form = buildForm(fields, values, { idPrefix: 'sale-add-form' });

    const productSelect = form.element.querySelector('[name="productId"]');
    const unitPriceInput = form.element.querySelector('[name="unitPrice"]');
    const quantityInput = form.element.querySelector('[name="quantity"]');
    const totalInput = form.element.querySelector('[name="total"]');
    const quantityWrap = quantityInput?.closest('.form-field');
    const hintEl = quantityWrap?.querySelector('.field-hint');

    function getSelectedProduct() {
      return productsList.find((p) => p.id === productSelect?.value);
    }

    function calculateTotal() {
      const prod = getSelectedProduct();
      const priceVal = prod ? Number(prod.price) : 0;
      const qtyVal = Number(quantityInput?.value) || 0;

      if (unitPriceInput) unitPriceInput.value = priceVal.toFixed(2);
      if (totalInput) totalInput.value = (qtyVal * priceVal).toFixed(2);

      if (hintEl && prod) {
        if (qtyVal > prod.quantity) {
          hintEl.textContent = `⚠️ Warning: Only ${prod.quantity} units available in stock!`;
          hintEl.style.color = 'var(--danger, #dc2626)';
        } else {
          hintEl.textContent = `Available stock: ${prod.quantity} units`;
          hintEl.style.color = '';
        }
      }
    }

    productSelect?.addEventListener('change', calculateTotal);
    quantityInput?.addEventListener('input', calculateTotal);

    const modal = openModal({
      title: 'Add New sale',
      subtitle: 'Record a product sale with automatic stock reduction',
      content: form.element,
      actions: [
        { label: 'Cancel', variant: 'secondary' },
        { label: 'Complete Sale', variant: 'primary', onClick: (close) => handleCreateSubmit(close) },
      ],
    });

    async function handleCreateSubmit(close) {
      const vals = form.getValues();
      const errors = {};
      const prod = getSelectedProduct();

      if (!vals.user) errors.user = 'Choose a salesperson.';
      if (!vals.productId) errors.productId = 'Please select a product.';
      if (!isWholeNumber(vals.quantity) || Number(vals.quantity) <= 0) {
        errors.quantity = 'Quantity must be a positive whole number (at least 1).';
      } else if (prod && Number(vals.quantity) > Number(prod.quantity)) {
        errors.quantity = `Insufficient stock! Only ${prod.quantity} units available.`;
      }

      form.clearErrors();
      const result = form.validateRequired(errors);
      if (!result.valid) {
        result.focusFirst();
        return;
      }

      const btn = modal.element.querySelector('.modal-foot .btn-primary');
      btn.disabled = true;

      try {
        const payload = {
          user: vals.user,
          date: vals.date,
          items: [
            {
              productId: prod.id,
              quantity: Number(vals.quantity),
              unitPrice: Number(prod.price),
            },
          ],
          total: Number(vals.total),
        };

        const created = await createSale(payload);
        showToast(`Sale recorded successfully! Product stock updated.`, 'success');
        close();
        await reload();
      } catch (error) {
        form.clearErrors();
        form.showBanner(error.message || 'Something went wrong.');
        result.focusFirst();
        btn.disabled = false;
      }
    }
  }

  async function reload() {
    if (cancelled) return;
    try {
      [rows, productsList] = await Promise.all([getSales(), getProducts()]);
      table?.setRows?.(rows);
    } catch (error) {
      showToast(error.message || 'Failed to load sales.', 'error');
    }
  }

  renderHead();
  loadInitial();

  async function loadInitial() {
    host.innerHTML = `<div class="card"><div class="skeleton" style="height:14px; width:30%; margin-bottom:16px;"></div>${`<div class="skeleton" style="height:44px;"></div><div style="height:10px"></div>`.repeat(6)}</div>`;
    try {
      [rows, productsList] = await Promise.all([getSales(), getProducts()]);
      if (cancelled) return;
      host.innerHTML = '';
      table = createDataTable(host, tableConfig());
    } catch (error) {
      if (cancelled) return;
      host.innerHTML = `
        <div class="card">
          <div class="state-box error">
            <div class="state-icon">${icon('alertCircle', 22)}</div>
            <h3>Unable to load sales</h3>
            <p>${escapeHtml(error.message || 'Please try again.')}</p>
            <button type="button" class="btn btn-secondary" id="sales-retry">${icon('refresh', 15)} Retry</button>
          </div>
        </div>`;
      host.querySelector('#sales-retry')?.addEventListener('click', loadInitial);
    }
  }

  return () => {
    cancelled = true;
    table?.destroy?.();
    table = null;
  };
}
