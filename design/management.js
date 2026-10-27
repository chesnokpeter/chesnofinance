import {
  accountBalance, createBackup, deleteAccount, deleteCategory, deleteSubcategory,
  formatMoney, localToday, parseBackup, parseMoney, saveAccount, saveCategory,
  saveSubcategory
} from './model.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const icon = name => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const ICONS = { wallet: 'Кошелёк', food: 'Еда', coffee: 'Кофе', travel: 'Транспорт', work: 'Работа', note: 'Запись' };
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Settings stay independent from the entry form; every mutation is committed by IndexedDB first. */
export function createManagement({ store, getData, onChange = () => {}, notify: notifyRoot = () => {} }) {
  let categoryType = 'expense';
  let busy = 0;
  let importing = false;
  let messageTimer;
  const children = new Set();
  const settings = document.createElement('dialog');
  settings.id = 'settings-dialog';
  settings.className = 'mg-dialog mg-settings';
  settings.setAttribute('aria-labelledby', 'mg-settings-title');
  settings.innerHTML = `
    <header class="mg-settings-header"><h1 id="mg-settings-title">Настройки</h1><button type="button" class="mg-action" id="mg-close">Готово</button></header>
    <div class="mg-settings-content">
      <section class="mg-section" aria-labelledby="mg-accounts-title">
        <div class="mg-section-heading"><h2 id="mg-accounts-title">Счета</h2><button class="mg-action" id="mg-add-account" type="button">Добавить</button></div>
        <div class="mg-group" id="mg-accounts"></div>
        <p class="mg-footnote">Начальный остаток можно изменить в настройках счёта. Доходы, расходы и переводы учитываются отдельно.</p>
      </section>
      <section class="mg-section" aria-labelledby="mg-categories-title">
        <div class="mg-section-heading"><h2 id="mg-categories-title">Категории</h2><button class="mg-action" id="mg-add-category" type="button">Добавить</button></div>
        <div class="mg-segmented" role="group" aria-label="Тип категорий"><button type="button" data-mg-type="expense" aria-pressed="true">Расходы</button><button type="button" data-mg-type="income" aria-pressed="false">Доходы</button></div>
        <div class="mg-group" id="mg-categories"></div>
      </section>
      <section class="mg-section" aria-labelledby="mg-backup-title">
        <h2 id="mg-backup-title">Импорт и экспорт</h2>
        <div class="mg-group">
          <button class="mg-row" id="mg-export-json" type="button">${icon('arrowout')}<span>Экспортировать резервную копию<small>Все счета, категории и операции · JSON</small></span>${icon('right')}</button>
          <button class="mg-row" id="mg-import-json" type="button">${icon('arrowin')}<span>Импортировать резервную копию<small>Восстановить данные из JSON-файла до 50 МБ</small></span>${icon('right')}</button>
          <button class="mg-row" id="mg-export-csv" type="button">${icon('list')}<span>Экспортировать операции<small>Таблица CSV для Excel и Numbers</small></span>${icon('right')}</button>
        </div>
        <input type="file" id="mg-import-file" accept=".json,application/json" hidden>
        <p class="mg-error" id="mg-backup-error" role="alert" hidden></p>
        <p class="mg-footnote">Данные хранятся на этом устройстве. Сохраните резервную копию перед сменой телефона или очисткой данных сайта. CSV содержит только операции; для полного восстановления используйте JSON.</p>
      </section>
      <section class="mg-section" aria-labelledby="mg-device-title">
        <h2 id="mg-device-title">На этом устройстве</h2>
        <div class="mg-group">
          <button class="mg-row" id="install-app" type="button">${icon('plus')}<span>Добавить на экран «Домой»</span>${icon('right')}</button>
          <button class="mg-row" id="mg-persist" type="button">${icon('wallet')}<span>Запросить защиту от очистки<small id="mg-persist-status">Дополнительная защита локального хранилища</small></span>${icon('right')}</button>
        </div>
        <p class="mg-footnote">На iPhone откройте приложение в Safari: «Поделиться» → «На экран „Домой“». После первого открытия с интернетом приложение работает офлайн.</p>
      </section>
      <p class="mg-footer">Чесно · данные остаются у вас</p>
    </div><p class="mg-message" id="mg-message" role="status" hidden></p>`;
  document.body.append(settings);
  const find = selector => settings.querySelector(selector);

  // A native modal is above the app toast in the top layer, so settings need their own status.
  function notify(message, isError = false) {
    if (!settings.open) { notifyRoot(message, isError); return; }
    const status = find('#mg-message');
    status.textContent = message;
    status.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { status.hidden = true; }, 4500);
  }

  function errorText(error) {
    return error instanceof Error && error.message ? error.message : 'Не удалось сохранить изменения. Попробуйте ещё раз.';
  }
  function showBackupError(message = '') {
    const element = find('#mg-backup-error');
    element.textContent = message;
    element.hidden = !message;
  }
  function render(data = getData()) {
    if (!data) return;
    find('#mg-accounts').innerHTML = data.accounts.map(account => `
      <button class="mg-row" type="button" data-mg-account="${escape(account.id)}">
        ${icon('wallet')}<span>${escape(account.name)}<small>Начальный: ${formatMoney(account.openingCents)} ₽</small></span>
        <strong>${formatMoney(accountBalance(data, account.id))} ₽</strong>${icon('right')}
      </button>`).join('');
    settings.querySelectorAll('[data-mg-account]').forEach(button => {
      button.onclick = () => editAccount(button.dataset.mgAccount);
    });
    settings.querySelectorAll('[data-mg-type]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.mgType === categoryType));
    });
    find('#mg-categories').innerHTML = data.categories[categoryType].map(category => `
      <button class="mg-row" type="button" data-mg-category="${escape(category.id)}">
        ${icon(category.icon)}<span>${escape(category.name)}<small>${category.subs.length} ${subcategoryWord(category.subs.length)}</small></span>${icon('right')}
      </button>`).join('');
    settings.querySelectorAll('[data-mg-category]').forEach(button => {
      button.onclick = () => editCategory(categoryType, button.dataset.mgCategory);
    });
  }
  function subcategoryWord(count) {
    const two = count % 100, last = count % 10;
    return last === 1 && two !== 11 ? 'подкатегория' : last >= 2 && last <= 4 && (two < 12 || two > 14) ? 'подкатегории' : 'подкатегорий';
  }
  async function commit(mutator) {
    const data = await store.update(mutator);
    onChange(data);
    render(data);
    return data;
  }
  function makeEditor({ title, body, submitLabel = 'Сохранить', onSubmit, afterSave }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'mg-dialog mg-editor';
    const headingId = `mg-heading-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', headingId);
    dialog.innerHTML = `<form class="mg-form">
      <header class="mg-editor-header"><button class="mg-action mg-cancel" type="button">Отмена</button><h2 id="${headingId}">${escape(title)}</h2><button class="mg-action mg-submit" type="submit">${escape(submitLabel)}</button></header>
      <div class="mg-form-body">${body}<p class="mg-error" role="alert" hidden></p></div>
    </form>`;
    document.body.append(dialog);
    children.add(dialog);
    let saving = false;
    const form = dialog.querySelector('form');
    const error = dialog.querySelector('.mg-error');
    dialog.querySelector('.mg-cancel').onclick = () => { if (!saving) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      children.delete(dialog);
      dialog.remove();
      if (settings.open && !children.size && !settings.contains(document.activeElement)) find('#mg-close').focus();
    });
    form.onsubmit = async event => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      const values = new FormData(form);
      saving = true;
      busy++;
      error.hidden = true;
      const controls = [...form.querySelectorAll('button,input,select')];
      const disabledBefore = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      dialog.setAttribute('aria-busy', 'true');
      try {
        await onSubmit(values, dialog);
        dialog.close();
        afterSave?.();
      } catch (failure) {
        error.textContent = errorText(failure);
        error.hidden = false;
        error.scrollIntoView({ block: 'nearest' });
      } finally {
        saving = false;
        busy--;
        dialog.removeAttribute('aria-busy');
        controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
      }
    };
    dialog.showModal();
    return dialog;
  }
  function confirmAction({ title, description, actionLabel, onConfirm, extra = '', afterSave }) {
    return makeEditor({
      title,
      body: `<p class="mg-confirm-copy">${escape(description)}</p>${extra}`,
      submitLabel: actionLabel,
      onSubmit: onConfirm,
      afterSave
    });
  }
  function editAccount(id = null) {
    const account = id ? getData().accounts.find(item => item.id === id) : null;
    if (id && !account) return;
    const dialog = makeEditor({
      title: account ? 'Счёт' : 'Новый счёт',
      body: `<div class="mg-input-group">
        <label class="mg-input-row"><span>Название</span><input name="name" aria-label="Название счёта" maxlength="80" required autocomplete="off" value="${escape(account?.name || '')}" placeholder="Например, Основной"></label>
        <label class="mg-input-row"><span>Начальный остаток, ₽</span><input name="opening" aria-label="Начальный остаток счёта" maxlength="20" required value="${escape(formatMoney(account?.openingCents || 0))}"></label>
      </div><p class="mg-footnote">Это остаток до первой операции. Текущий баланс рассчитывается с учётом всех доходов, расходов и переводов. Для долга можно указать отрицательную сумму.</p>
      ${account ? '<button class="mg-danger" type="button" data-delete>Удалить счёт</button>' : ''}`,
      onSubmit: async values => {
        await commit(data => saveAccount(data, { ...(id ? { id } : {}), name: String(values.get('name')), openingCents: parseMoney(String(values.get('opening')), { allowNegative: true }) }));
        notify(account ? 'Счёт сохранён' : 'Счёт добавлен');
      }
    });
    dialog.querySelector('[data-delete]')?.addEventListener('click', () => confirmAction({
      title: 'Удалить счёт?',
      description: `«${account.name}» будет удалён. Счёт с операциями удалить нельзя: сначала перенесите или удалите связанные операции.`,
      actionLabel: 'Удалить',
      onConfirm: async () => { await commit(data => deleteAccount(data, id)); dialog.close(); notify('Счёт удалён'); }
    }));
  }
  function editCategory(type, id = null) {
    const category = id ? getData().categories[type].find(item => item.id === id) : null;
    if (id && !category) return;
    let createdId;
    const dialog = makeEditor({
      title: category ? 'Категория' : 'Новая категория',
      body: `<div class="mg-input-group">
        <label class="mg-input-row"><span>Название</span><input name="name" aria-label="Название категории" required maxlength="80" autocomplete="off" value="${escape(category?.name || '')}" placeholder="Например, Здоровье"></label>
        <label class="mg-input-row"><span>Значок</span><select name="icon" aria-label="Значок категории">${Object.entries(ICONS).map(([value, name]) => `<option value="${value}" ${(category?.icon || 'wallet') === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      </div>
      ${category ? '<div class="mg-subheading"><h3>Подкатегории</h3><button type="button" class="mg-action" data-add-sub>Добавить</button></div><div class="mg-group" data-sub-list></div><button class="mg-danger" type="button" data-delete>Удалить категорию</button>' : '<p class="mg-footnote">После создания добавьте свои подкатегории. Для начала появится подкатегория «Общее».</p>'}`,
      onSubmit: async values => {
        await commit(data => { const saved = saveCategory(data, { ...(id ? { id } : {}), type, name: String(values.get('name')), icon: String(values.get('icon')) }); createdId = saved.id; });
        notify(category ? 'Категория сохранена' : 'Категория добавлена');
      },
      afterSave: !category ? () => editCategory(type, createdId) : undefined
    });
    const renderSubs = () => {
      if (!dialog.open || !id) return;
      const latest = getData().categories[type].find(item => item.id === id);
      if (!latest) return;
      const list = dialog.querySelector('[data-sub-list]');
      list.innerHTML = latest.subs.map(sub => `<button class="mg-row" type="button" data-edit-sub="${escape(sub.id)}"><span>${escape(sub.name)}</span>${icon('right')}</button>`).join('');
      list.querySelectorAll('[data-edit-sub]').forEach(button => {
        button.onclick = () => editSubcategory(type, id, button.dataset.editSub, renderSubs);
      });
    };
    dialog.querySelector('[data-add-sub]')?.addEventListener('click', () => editSubcategory(type, id, null, renderSubs));
    dialog.querySelector('[data-delete]')?.addEventListener('click', () => confirmAction({
      title: 'Удалить категорию?',
      description: `Категория «${category.name}» и её подкатегории будут удалены. Категорию с операциями удалить нельзя.`,
      actionLabel: 'Удалить',
      onConfirm: async () => { await commit(data => deleteCategory(data, type, id)); dialog.close(); notify('Категория удалена'); }
    }));
    renderSubs();
  }
  function editSubcategory(type, categoryId, id, refresh) {
    const category = getData().categories[type].find(item => item.id === categoryId);
    const sub = id ? category?.subs.find(item => item.id === id) : null;
    if (!category || (id && !sub)) return;
    const dialog = makeEditor({
      title: sub ? 'Подкатегория' : 'Новая подкатегория',
      body: `<p class="mg-footnote mg-parent-name">${escape(category.name)}</p><div class="mg-input-group"><label class="mg-input-row"><span>Название</span><input name="name" aria-label="Название подкатегории" required maxlength="60" autocomplete="off" value="${escape(sub?.name || '')}" placeholder="Например, Аптека"></label></div>${sub ? '<button class="mg-danger" type="button" data-delete>Удалить подкатегорию</button>' : ''}`,
      onSubmit: async values => { await commit(data => saveSubcategory(data, type, categoryId, { ...(id ? { id } : {}), name: String(values.get('name')) })); notify(sub ? 'Подкатегория сохранена' : 'Подкатегория добавлена'); },
      afterSave: refresh
    });
    dialog.querySelector('[data-delete]')?.addEventListener('click', () => confirmAction({
      title: 'Удалить подкатегорию?',
      description: `«${sub.name}» будет удалена. Подкатегорию с операциями и последнюю подкатегорию удалить нельзя.`,
      actionLabel: 'Удалить',
      onConfirm: async () => { await commit(data => deleteSubcategory(data, type, categoryId, id)); dialog.close(); refresh(); notify('Подкатегория удалена'); }
    }));
  }
  function downloadFile(content, mime, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function exportJSON() {
    try {
      const backup = createBackup(await store.read());
      const blob = new Blob([`${JSON.stringify(backup)}\n`], { type: 'application/json;charset=utf-8' });
      if (blob.size > MAX_BACKUP_BYTES) throw new Error('Максимальный размер резервной копии — 50 МБ. Операции можно отдельно выгрузить в CSV.');
      downloadFile(blob, 'application/json;charset=utf-8', `chesno-backup-${localToday()}.json`);
      showBackupError();
      notify('Резервная копия готова. Сохраните файл.');
    } catch (failure) { showBackupError(errorText(failure)); }
  }
  async function exportCSV() {
    try {
      const data = await store.read();
      const cell = value => {
        let text = String(value ?? '');
        // Spreadsheet applications must treat notes and names as text, never formulas.
        if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""')}"`;
      };
      const rows = [['Дата', 'Тип', 'Счёт', 'Счёт получателя', 'Категория', 'Подкатегория', 'Сумма, RUB', 'Описание']];
      for (const transaction of data.transactions) {
        const category = data.categories[transaction.type]?.find(item => item.id === transaction.categoryId);
        const sub = category?.subs.find(item => item.id === transaction.subcategoryId);
        rows.push([transaction.date, { expense: 'Расход', income: 'Доход', transfer: 'Перевод' }[transaction.type], data.accounts.find(item => item.id === transaction.accountId)?.name || '', data.accounts.find(item => item.id === transaction.toAccountId)?.name || '', category?.name || '', sub?.name || '', (transaction.amountCents / 100).toFixed(2).replace('.', ','), transaction.description]);
      }
      downloadFile(`\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}\r\n`, 'text/csv;charset=utf-8', `chesno-operations-${localToday()}.csv`);
      showBackupError();
      notify('Таблица операций готова');
    } catch (failure) { showBackupError(errorText(failure)); }
  }
  async function importJSON(file) {
    if (importing) return;
    importing = true;
    busy++;
    const importButton = find('#mg-import-json');
    importButton.disabled = true;
    importButton.setAttribute('aria-busy', 'true');
    showBackupError();
    try {
      if (!file || file.size === 0) throw new Error('Выберите непустой JSON-файл резервной копии.');
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Файл слишком большой. Максимальный размер — 50 МБ.');
      const imported = parseBackup(await file.text());
      const categoryCount = imported.categories.expense.length + imported.categories.income.length;
      const subCount = [...imported.categories.expense, ...imported.categories.income].reduce((sum, category) => sum + category.subs.length, 0);
      const confirm = confirmAction({
        title: 'Восстановить данные?',
        description: 'Данные из файла заменят все текущие счета, категории и операции на этом устройстве. Сохраните текущую резервную копию, если она вам нужна.',
        actionLabel: 'Восстановить',
        extra: `<p class="mg-import-name">Файл: <strong>${escape(file.name)}</strong></p><dl class="mg-import-summary"><div><dt>Счета</dt><dd>${imported.accounts.length}</dd></div><div><dt>Категории</dt><dd>${categoryCount}</dd></div><div><dt>Подкатегории</dt><dd>${subCount}</dd></div><div><dt>Операции</dt><dd>${imported.transactions.length}</dd></div></dl><button type="button" class="mg-secondary" data-export-current>Сохранить текущую копию</button>`,
        onConfirm: async () => {
          const data = await store.replace(imported);
          onChange(data);
          render(data);
          showBackupError();
          notify('Данные восстановлены');
        }
      });
      confirm.querySelector('[data-export-current]').onclick = exportJSON;
    } catch (failure) { showBackupError(errorText(failure)); }
    finally {
      importing = false;
      busy--;
      importButton.disabled = false;
      importButton.removeAttribute('aria-busy');
    }
  }
  async function requestPersistence() {
    const button = find('#mg-persist');
    const status = find('#mg-persist-status');
    if (!navigator.storage?.persist) {
      status.textContent = 'Браузер управляет очисткой. Сохраняйте резервные копии.';
      notify('Этот браузер не поддерживает запрос защиты хранилища.');
      return;
    }
    button.disabled = true;
    try {
      const granted = await navigator.storage.persist();
      status.textContent = granted ? 'Защита от автоматической очистки включена' : 'Защита не предоставлена. Сохраняйте резервные копии.';
      notify(granted ? 'Защита хранилища включена. Резервные копии всё равно нужны.' : 'Браузер не предоставил защиту от очистки.');
    } catch { notify('Не удалось запросить защиту. Сохраняйте резервные копии.'); }
    finally { button.disabled = false; }
  }
  find('#mg-close').onclick = () => { if (!busy) settings.close(); };
  settings.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  find('#mg-add-account').onclick = () => editAccount();
  find('#mg-add-category').onclick = () => editCategory(categoryType);
  settings.querySelectorAll('[data-mg-type]').forEach(button => {
    button.onclick = () => { categoryType = button.dataset.mgType; render(); };
  });
  find('#mg-export-json').onclick = exportJSON;
  find('#mg-export-csv').onclick = exportCSV;
  find('#mg-import-json').onclick = () => find('#mg-import-file').click();
  find('#mg-import-file').onchange = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void importJSON(file);
  };
  find('#mg-persist').onclick = requestPersistence;
  const unsubscribe = store.subscribe(data => { if (settings.open) render(data); });
  return {
    open() {
      render();
      showBackupError();
      if (!settings.open) settings.showModal();
      if (navigator.storage?.persisted) navigator.storage.persisted().then(granted => {
        if (granted) find('#mg-persist-status').textContent = 'Защита от автоматической очистки включена';
      }).catch(() => {});
    },
    close() {
      if (busy) return;
      [...children].reverse().forEach(dialog => dialog.close());
      if (settings.open) settings.close();
    },
    isOpen: () => settings.open || children.size > 0,
    isBusy: () => busy > 0,
    notify,
    destroy() {
      clearTimeout(messageTimer);
      unsubscribe?.();
      [...children].reverse().forEach(dialog => dialog.close());
      settings.remove();
    }
  };
}
