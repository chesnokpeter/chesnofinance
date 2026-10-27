/** Pure finance domain. All money is stored as integer kopecks. */
export const DATA_VERSION = 1;
export const MAX_AMOUNT_CENTS = 99_999_999_999;
const MAX_RECORDS = 100_000;
const ICONS = new Set(['food', 'coffee', 'travel', 'work', 'wallet', 'list', 'calendar', 'note', 'arrowout', 'arrowin']);
const TYPES = new Set(['expense', 'income', 'transfer']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}: неверный формат.`);
  return value;
}
function array(value, label, {min = 0, max = MAX_RECORDS} = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}: недопустимое количество записей.`);
  for (let index = 0; index < value.length; index += 1) if (!own(value, index)) fail(`${label}: пропущена запись.`);
  return value;
}
function text(value, label, {max = 80, empty = false} = {}) {
  if (typeof value !== 'string') fail(`${label}: ожидается текст.`);
  const result = value.trim();
  if ((!empty && !result) || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) fail(`${label}: ${empty ? 'не больше' : 'от 1 до'} ${max} символов.`);
  return result;
}
function id(value, label = 'Идентификатор') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(value)) fail(`${label}: неверный формат.`);
  return value;
}
function cents(value, label, {positive = false} = {}) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_AMOUNT_CENTS || (positive && value <= 0)) fail(`${label}: укажите ${positive ? 'положительную ' : ''}сумму не больше 999 999 999,99 ₽.`);
  return Object.is(value, -0) ? 0 : value;
}
function sum(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail('Общая сумма слишком велика для точного расчёта.');
  return result;
}
function unique(seen, value, label) {
  if (seen.has(value)) fail(`${label}: повторяющийся идентификатор.`);
  seen.add(value);
}
function dateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('Дата: используйте формат ГГГГ-ММ-ДД.');
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('Указана несуществующая дата.');
  return value;
}
function monthString(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) fail('Месяц: используйте формат ГГГГ-ММ.');
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) fail(`${label}: неверная дата.`);
  dateString(value.slice(0, 10));
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCHours() !== Number(value.slice(11, 13)) || parsed.getUTCMinutes() !== Number(value.slice(14, 16)) || parsed.getUTCSeconds() !== Number(value.slice(17, 19))) fail(`${label}: неверная дата.`);
  return parsed.toISOString();
}
function categoryType(type) {
  if (type !== 'expense' && type !== 'income') fail('Выберите тип категории: расход или доход.');
  return type;
}
function icon(value = 'wallet') {
  if (typeof value !== 'string' || !ICONS.has(value)) fail('Неизвестный значок категории.');
  return value;
}
function findAccount(data, accountId) {
  const result = data.accounts.find(item => item.id === accountId);
  if (!result) fail('Счёт не найден.');
  return result;
}
function findCategory(data, type, categoryId) {
  const result = data.categories[categoryType(type)].find(item => item.id === categoryId);
  if (!result) fail('Категория не найдена.');
  return result;
}
function calculatedBalances(data) {
  const result = new Map(data.accounts.map(account => [account.id, account.openingCents]));
  for (const transaction of data.transactions) {
    const signed = transaction.type === 'income' ? transaction.amountCents : -transaction.amountCents;
    result.set(transaction.accountId, sum(result.get(transaction.accountId), signed));
    if (transaction.type === 'transfer') result.set(transaction.toAccountId, sum(result.get(transaction.toAccountId), transaction.amountCents));
  }
  return result;
}

export function newId(prefix = 'id') {
  const safePrefix = typeof prefix === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,20}$/u.test(prefix) ? prefix : 'id';
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${safePrefix}-${suffix}`;
}

export function localToday(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('Некорректная дата.');
  const year = String(date.getFullYear()).padStart(4, '0');
  return dateString(`${year}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
}

export function parseMoney(value, {allowNegative = false} = {}) {
  if (typeof value !== 'string') fail('Введите сумму цифрами.');
  const normalized = value.replace(/[\s\u00a0\u202f]/gu, '').replace('.', ',');
  const pattern = allowNegative ? /^-?\d{1,9}(?:,\d{0,2})?$/u : /^\d{1,9}(?:,\d{0,2})?$/u;
  if (!pattern.test(normalized)) fail('Введите сумму с точностью до двух знаков после запятой.');
  const negative = normalized.startsWith('-');
  const [whole, fractional = ''] = normalized.replace(/^-/, '').split(',');
  return cents((Number(whole) * 100 + Number(fractional.padEnd(2, '0'))) * (negative ? -1 : 1), 'Сумма');
}

export function formatMoney(value) {
  if (!Number.isSafeInteger(value)) fail('Некорректная сумма.');
  const digits = String(Math.abs(value)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/gu, '\u00a0');
  const fraction = value % 100 ? `,${digits.slice(-2)}` : '';
  return `${value < 0 ? '-' : ''}${whole}${fraction}`;
}

export function createInitialData() {
  return {
    version: DATA_VERSION,
    revision: 0,
    settings: {currency: 'RUB'},
    accounts: [{id: 'main', name: 'Основной', openingCents: 0}],
    categories: {
      expense: [
        {id: 'food', name: 'Еда', icon: 'food', subs: [{id: 'groceries', name: 'Продукты'}, {id: 'coffee', name: 'Кофе'}, {id: 'restaurants', name: 'Рестораны'}]},
        {id: 'transport', name: 'Транспорт', icon: 'travel', subs: [{id: 'taxi', name: 'Такси'}, {id: 'metro', name: 'Метро'}, {id: 'car', name: 'Авто'}]},
        {id: 'shopping', name: 'Покупки', icon: 'wallet', subs: [{id: 'clothes', name: 'Одежда'}, {id: 'home', name: 'Для дома'}, {id: 'tech', name: 'Техника'}]},
        {id: 'other-expense', name: 'Другое', icon: 'list', subs: [{id: 'general-expense', name: 'Общее'}]}
      ],
      income: [
        {id: 'work', name: 'Работа', icon: 'work', subs: [{id: 'salary', name: 'Зарплата'}, {id: 'freelance', name: 'Фриланс'}, {id: 'bonus', name: 'Премия'}]},
        {id: 'other-income', name: 'Другое', icon: 'wallet', subs: [{id: 'gift', name: 'Подарки'}, {id: 'refund', name: 'Возврат'}, {id: 'interest', name: 'Проценты'}]}
      ]
    },
    transactions: []
  };
}

/** Validate and canonicalize a complete state without retaining input references. */
export function validateData(input) {
  object(input, 'Данные');
  if (input.version !== DATA_VERSION) fail('Эта версия данных не поддерживается.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('Неверная версия изменений данных.');
  object(input.settings, 'Настройки');
  if (input.settings.currency !== 'RUB') fail('Поддерживается валюта RUB.');
  const accountIds = new Set();
  const accounts = array(input.accounts, 'Счета', {min: 1, max: 1000}).map(value => {
    object(value, 'Счёт');
    const accountId = id(value.id, 'Счёт');
    unique(accountIds, accountId, 'Счёт');
    return {id: accountId, name: text(value.name, 'Название счёта'), openingCents: cents(value.openingCents, 'Начальный остаток')};
  });
  object(input.categories, 'Категории');
  const categoryIds = new Set(), subcategoryIds = new Set(), categoryMaps = {expense: new Map(), income: new Map()};
  const categories = {};
  for (const type of ['expense', 'income']) {
    categories[type] = array(input.categories[type], 'Категории', {min: 1, max: 1000}).map(value => {
      object(value, 'Категория');
      const categoryId = id(value.id, 'Категория');
      unique(categoryIds, categoryId, 'Категория');
      const subs = array(value.subs, 'Подкатегории', {min: 1, max: 1000}).map(sub => {
        object(sub, 'Подкатегория');
        const subId = id(sub.id, 'Подкатегория');
        unique(subcategoryIds, subId, 'Подкатегория');
        return {id: subId, name: text(sub.name, 'Название подкатегории', {max: 60})};
      });
      const result = {id: categoryId, name: text(value.name, 'Название категории', {max: 60}), icon: icon(value.icon), subs};
      categoryMaps[type].set(categoryId, result);
      return result;
    });
  }
  const transactionIds = new Set();
  const transactions = array(input.transactions, 'Операции').map(value => {
    object(value, 'Операция');
    const transactionId = id(value.id, 'Операция');
    unique(transactionIds, transactionId, 'Операция');
    if (!TYPES.has(value.type)) fail('Неизвестный тип операции.');
    const accountId = id(value.accountId, 'Счёт операции');
    if (!accountIds.has(accountId)) fail('Операция ссылается на отсутствующий счёт.');
    let toAccountId = null, categoryId = null, subcategoryId = null;
    if (value.type === 'transfer') {
      toAccountId = id(value.toAccountId, 'Счёт получателя');
      if (!accountIds.has(toAccountId)) fail('Счёт получателя не найден.');
      if (accountId === toAccountId) fail('Для перевода выберите два разных счёта.');
      if (value.categoryId != null || value.subcategoryId != null) fail('Переводу не нужна категория.');
    } else {
      if (value.toAccountId != null) fail('Счёт получателя используется только в переводах.');
      categoryId = id(value.categoryId, 'Категория операции');
      subcategoryId = id(value.subcategoryId, 'Подкатегория операции');
      const category = categoryMaps[value.type].get(categoryId);
      if (!category || !category.subs.some(sub => sub.id === subcategoryId)) fail('Выберите категорию и её подкатегорию.');
    }
    const createdAt = timestamp(value.createdAt, 'Дата создания');
    const updatedAt = timestamp(value.updatedAt, 'Дата изменения');
    if (updatedAt < createdAt) fail('Дата изменения раньше даты создания операции.');
    return {id: transactionId, type: value.type, amountCents: cents(value.amountCents, 'Сумма операции', {positive: true}), accountId, toAccountId, categoryId, subcategoryId, date: dateString(value.date), description: text(value.description ?? '', 'Описание', {max: 1000, empty: true}), createdAt, updatedAt};
  });
  const result = {version: DATA_VERSION, revision: input.revision, settings: {currency: 'RUB'}, accounts, categories, transactions};
  const balances = calculatedBalances(result);
  [...balances.values()].reduce(sum, 0);
  for (const type of ['expense', 'income', 'transfer']) transactions.filter(transaction => transaction.type === type).reduce((total, transaction) => sum(total, transaction.amountCents), 0);
  return result;
}

function mutate(data, action) {
  const draft = validateData(data);
  const result = action(draft);
  const checked = validateData(draft);
  Object.assign(data, checked);
  return result;
}

export function saveAccount(data, input) {
  object(input, 'Счёт');
  const accountId = input.id == null ? newId('account') : id(input.id, 'Счёт');
  mutate(data, draft => {
    const account = {id: accountId, name: text(input.name, 'Название счёта'), openingCents: cents(input.openingCents, 'Начальный остаток')};
    const existing = draft.accounts.findIndex(item => item.id === accountId);
    if (existing < 0) draft.accounts.push(account); else draft.accounts[existing] = account;
  });
  return findAccount(data, accountId);
}

export function deleteAccount(data, accountId) {
  mutate(data, draft => {
    findAccount(draft, accountId);
    if (draft.accounts.length === 1) fail('Нельзя удалить последний счёт.');
    if (draft.transactions.some(transaction => transaction.accountId === accountId || transaction.toAccountId === accountId)) fail('У счёта есть операции. Сначала удалите или перенесите их.');
    draft.accounts = draft.accounts.filter(account => account.id !== accountId);
  });
}

export function saveCategory(data, input) {
  object(input, 'Категория');
  const type = categoryType(input.type), categoryId = input.id == null ? newId('category') : id(input.id, 'Категория');
  mutate(data, draft => {
    const category = draft.categories[type].find(item => item.id === categoryId);
    const updated = {id: categoryId, name: text(input.name, 'Название категории', {max: 60}), icon: icon(input.icon ?? category?.icon), subs: category?.subs ?? [{id: newId('sub'), name: 'Общее'}]};
    if (category) draft.categories[type][draft.categories[type].indexOf(category)] = updated; else draft.categories[type].push(updated);
  });
  return findCategory(data, type, categoryId);
}

export function deleteCategory(data, type, categoryId) {
  categoryType(type);
  mutate(data, draft => {
    findCategory(draft, type, categoryId);
    if (draft.categories[type].length === 1) fail('Нельзя удалить последнюю категорию этого типа.');
    if (draft.transactions.some(transaction => transaction.type === type && transaction.categoryId === categoryId)) fail('В категории есть операции. Сначала измените их категорию.');
    draft.categories[type] = draft.categories[type].filter(category => category.id !== categoryId);
  });
}

export function saveSubcategory(data, type, categoryId, input) {
  object(input, 'Подкатегория');
  const subId = input.id == null ? newId('sub') : id(input.id, 'Подкатегория');
  mutate(data, draft => {
    const category = findCategory(draft, type, categoryId);
    const subcategory = {id: subId, name: text(input.name, 'Название подкатегории', {max: 60})};
    const index = category.subs.findIndex(sub => sub.id === subId);
    if (index < 0) category.subs.push(subcategory); else category.subs[index] = subcategory;
  });
  return findCategory(data, type, categoryId).subs.find(sub => sub.id === subId);
}

export function deleteSubcategory(data, type, categoryId, subId) {
  mutate(data, draft => {
    const category = findCategory(draft, type, categoryId);
    if (!category.subs.some(sub => sub.id === subId)) fail('Подкатегория не найдена.');
    if (category.subs.length === 1) fail('В категории должна остаться хотя бы одна подкатегория.');
    if (draft.transactions.some(transaction => transaction.type === type && transaction.categoryId === categoryId && transaction.subcategoryId === subId)) fail('У подкатегории есть операции. Сначала измените их подкатегорию.');
    category.subs = category.subs.filter(sub => sub.id !== subId);
  });
}

export function saveTransaction(data, input) {
  object(input, 'Операция');
  const transactionId = input.id == null ? newId('transaction') : id(input.id, 'Операция');
  const now = new Date().toISOString();
  mutate(data, draft => {
    const index = draft.transactions.findIndex(transaction => transaction.id === transactionId);
    const existing = index < 0 ? null : draft.transactions[index];
    const transaction = {id: transactionId, type: input.type, amountCents: input.amountCents, accountId: input.accountId, toAccountId: input.toAccountId ?? null, categoryId: input.categoryId ?? null, subcategoryId: input.subcategoryId ?? null, date: input.date, description: input.description ?? '', createdAt: existing?.createdAt ?? now, updatedAt: now < (existing?.createdAt ?? now) ? existing.createdAt : now};
    if (index < 0) draft.transactions.push(transaction); else draft.transactions[index] = transaction;
  });
  return data.transactions.find(transaction => transaction.id === transactionId);
}

export function deleteTransaction(data, transactionId) {
  mutate(data, draft => {
    if (!draft.transactions.some(transaction => transaction.id === transactionId)) fail('Операция не найдена.');
    draft.transactions = draft.transactions.filter(transaction => transaction.id !== transactionId);
  });
}

export function accountBalance(data, accountId) {
  findAccount(data, accountId);
  return calculatedBalances(data).get(accountId);
}
export function totalBalance(data) { return [...calculatedBalances(data).values()].reduce(sum, 0); }

export function monthlyTransactions(data, {month = localToday().slice(0, 7), accountId = null, type = null} = {}) {
  monthString(month);
  if (accountId != null) findAccount(data, accountId);
  if (type != null && !TYPES.has(type)) fail('Неизвестный тип операции.');
  return data.transactions.filter(transaction => transaction.date.startsWith(`${month}-`) && (accountId == null || transaction.accountId === accountId || (transaction.type === 'transfer' && transaction.toAccountId === accountId)) && (type == null || transaction.type === type));
}

export function monthlyTotal(data, {month = localToday().slice(0, 7), accountId = null, type = 'expense'} = {}) {
  categoryType(type);
  return monthlyTransactions(data, {month, accountId, type}).reduce((total, transaction) => sum(total, transaction.amountCents), 0);
}

export function monthlyStats(data, {month = localToday().slice(0, 7), accountId = null, type = 'expense'} = {}) {
  categoryType(type);
  const items = monthlyTransactions(data, {month, accountId, type});
  const date = new Date(`${month}-01T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0);
  const daily = Array(date.getUTCDate()).fill(0);
  const totals = new Map(), subTotals = new Map();
  let total = 0;
  for (const transaction of items) {
    total = sum(total, transaction.amountCents);
    daily[Number(transaction.date.slice(-2)) - 1] = sum(daily[Number(transaction.date.slice(-2)) - 1], transaction.amountCents);
    totals.set(transaction.categoryId, sum(totals.get(transaction.categoryId) ?? 0, transaction.amountCents));
    subTotals.set(transaction.subcategoryId, sum(subTotals.get(transaction.subcategoryId) ?? 0, transaction.amountCents));
  }
  const byCategory = data.categories[type].filter(category => totals.has(category.id)).map(category => ({id: category.id, name: category.name, icon: category.icon, total: totals.get(category.id), subs: category.subs.filter(sub => subTotals.has(sub.id)).map(sub => ({id: sub.id, name: sub.name, total: subTotals.get(sub.id)})).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'ru'))})).sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, 'ru'));
  return {total, count: items.length, byCategory, daily};
}

export function createBackup(data) {
  return {format: 'chesno-backup', version: DATA_VERSION, exportedAt: new Date().toISOString(), data: validateData(data)};
}
export function parseBackup(input) {
  let backup = input;
  if (typeof input === 'string') {
    try { backup = JSON.parse(input); } catch { fail('Не удалось прочитать резервную копию: файл должен содержать JSON.'); }
  }
  object(backup, 'Резервная копия');
  if (backup.format !== 'chesno-backup' || backup.version !== DATA_VERSION || !own(backup, 'data') || Object.keys(backup).some(key => !['format', 'version', 'exportedAt', 'data'].includes(key))) fail('Неподдерживаемый формат резервной копии.');
  timestamp(backup.exportedAt, 'Дата резервной копии');
  return validateData(backup.data);
}
