import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  DATA_VERSION, MAX_AMOUNT_CENTS, createInitialData, validateData, newId, localToday,
  parseMoney, formatMoney, saveAccount, deleteAccount, saveCategory, deleteCategory,
  saveSubcategory, deleteSubcategory, saveTransaction, deleteTransaction,
  accountBalance, totalBalance, monthlyTransactions, monthlyTotal, monthlyStats,
  createBackup, parseBackup
} from '../design/model.js';

const DATE = '2026-10-27';
function expense(data, overrides = {}) {
  return saveTransaction(data, {type: 'expense', amountCents: 100, accountId: 'main', categoryId: 'food', subcategoryId: 'coffee', date: DATE, description: '', ...overrides});
}
function income(data, overrides = {}) {
  return saveTransaction(data, {type: 'income', amountCents: 100, accountId: 'main', categoryId: 'work', subcategoryId: 'salary', date: DATE, description: '', ...overrides});
}
function transfer(data, overrides = {}) {
  return saveTransaction(data, {type: 'transfer', amountCents: 100, accountId: 'main', toAccountId: 'cash', date: DATE, description: '', ...overrides});
}
function withCash(openingCents = 0) {
  const data = createInitialData();
  saveAccount(data, {id: 'cash', name: 'Наличные', openingCents});
  return data;
}
function unchangedOnError(data, operation, pattern) {
  const before = structuredClone(data);
  assert.throws(operation, pattern);
  assert.deepEqual(data, before, 'a rejected operation must not mutate stored data');
}

test('initial data contains real zero balances and independent editable defaults', () => {
  const data = createInitialData();
  assert.equal(data.version, DATA_VERSION);
  assert.equal(data.revision, 0);
  assert.deepEqual(data.settings, {currency: 'RUB'});
  assert.deepEqual(data.accounts, [{id: 'main', name: 'Основной', openingCents: 0}]);
  assert.deepEqual(data.transactions, []);
  assert.equal(totalBalance(data), 0);
  const copy = validateData(data);
  copy.accounts[0].name = 'Другое имя';
  copy.categories.expense[0].subs[0].name = 'Иная подкатегория';
  assert.equal(data.accounts[0].name, 'Основной');
  assert.equal(createInitialData().categories.expense[0].subs[0].name, 'Продукты');
  assert.equal(new Set(Array.from({length: 200}, () => newId('account'))).size, 200);
});

test('money parsing is exact in kopecks and rejects invalid decimal input', () => {
  for (const [input, expected] of [['0', 0], ['1', 100], ['0,01', 1], ['0.10', 10], ['12,3', 1230], ['12,', 1200], ['1 234,56', 123456], ['1\u00a0234,56', 123456], ['999999999,99', MAX_AMOUNT_CENTS]]) assert.equal(parseMoney(input), expected, input);
  assert.equal(parseMoney('-12,34', {allowNegative: true}), -1234);
  assert.equal(parseMoney('-0', {allowNegative: true}), 0);
  for (const input of ['', ' ', '-1', '+1', '1,234', '1.2.3', '1e6', 'NaN', 'Infinity', '1000000000', 'рубль', null, 12]) assert.throws(() => parseMoney(input), Error, String(input));
});

test('money display preserves every kopeck even near the safe integer boundary', () => {
  assert.equal(formatMoney(0), '0');
  assert.equal(formatMoney(1), '0,01');
  assert.equal(formatMoney(10), '0,10');
  assert.equal(formatMoney(100), '1');
  assert.equal(formatMoney(123456), '1\u00a0234,56');
  assert.equal(formatMoney(-123456), '-1\u00a0234,56');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER), '90\u00a0071\u00a0992\u00a0547\u00a0409,91');
  assert.throws(() => formatMoney(Number.MAX_SAFE_INTEGER + 1));
});

test('expense and income edits recalculate balances without double counting', () => {
  const data = withCash();
  saveAccount(data, {id: 'main', name: 'Карта', openingCents: 10000});
  income(data, {amountCents: 12345});
  const purchase = expense(data, {amountCents: 230, description: '  Кофе  '});
  assert.equal(purchase.description, 'Кофе');
  assert.equal(accountBalance(data, 'main'), 22115);
  assert.equal(totalBalance(data), 22115);
  const createdAt = purchase.createdAt;
  expense(data, {id: purchase.id, amountCents: 1000, accountId: 'cash'});
  assert.equal(data.transactions.length, 2);
  assert.equal(accountBalance(data, 'main'), 22345);
  assert.equal(accountBalance(data, 'cash'), -1000);
  assert.equal(totalBalance(data), 21345);
  assert.equal(data.transactions.find(item => item.id === purchase.id).createdAt, createdAt);
  assert.ok(data.transactions.find(item => item.id === purchase.id).updatedAt >= createdAt);
  deleteTransaction(data, purchase.id);
  assert.equal(totalBalance(data), 22345);
  assert.equal(accountBalance(data, 'cash'), 0);
  assert.equal(monthlyTotal(data, {month: '2026-10', type: 'income'}), 12345);
  assert.equal(monthlyTotal(data, {month: '2026-10', type: 'expense'}), 0);
});

test('transfers affect both accounts, leave global balance unchanged and stay out of income/expenses', () => {
  const data = withCash();
  saveAccount(data, {id: 'main', name: 'Карта', openingCents: 100000});
  const item = transfer(data, {amountCents: 12345});
  assert.equal(accountBalance(data, 'main'), 87655);
  assert.equal(accountBalance(data, 'cash'), 12345);
  assert.equal(totalBalance(data), 100000);
  for (const accountId of [null, 'main', 'cash']) {
    assert.equal(monthlyTransactions(data, {month: '2026-10', accountId}).length, 1);
    assert.equal(monthlyTotal(data, {month: '2026-10', accountId, type: 'expense'}), 0);
    assert.equal(monthlyTotal(data, {month: '2026-10', accountId, type: 'income'}), 0);
    assert.equal(monthlyStats(data, {month: '2026-10', accountId, type: 'expense'}).count, 0);
  }
  transfer(data, {id: item.id, amountCents: 5000});
  assert.equal(accountBalance(data, 'main'), 95000);
  assert.equal(accountBalance(data, 'cash'), 5000);
  deleteTransaction(data, item.id);
  assert.equal(accountBalance(data, 'main'), 100000);
  assert.equal(accountBalance(data, 'cash'), 0);
});

test('changing a transfer to an expense reverses the old transfer completely', () => {
  const data = withCash();
  const item = transfer(data, {amountCents: 5000});
  expense(data, {id: item.id, amountCents: 1000});
  assert.equal(accountBalance(data, 'cash'), 0);
  assert.equal(accountBalance(data, 'main'), -1000);
  assert.equal(totalBalance(data), -1000);
  assert.equal(monthlyTotal(data, {month: '2026-10', type: 'expense'}), 1000);
  assert.equal(data.transactions[0].toAccountId, null);
});

test('account updates preserve references and deleting used or last accounts is atomic', () => {
  const data = withCash(500);
  const item = expense(data, {accountId: 'cash'});
  saveAccount(data, {id: 'cash', name: 'Кошелёк', openingCents: 1000});
  assert.equal(accountBalance(data, 'cash'), 900);
  unchangedOnError(data, () => deleteAccount(data, 'cash'), /есть операции/u);
  deleteTransaction(data, item.id);
  deleteAccount(data, 'cash');
  assert.equal(data.accounts.length, 1);
  unchangedOnError(data, () => deleteAccount(data, 'main'), /последний/u);
  unchangedOnError(data, () => saveAccount(data, {id: 'main', name: ' ', openingCents: 0}), /Название/u);
  unchangedOnError(data, () => deleteAccount(data, 'missing'), /не найден/u);
});

test('a transfer destination cannot be deleted while the transfer exists', () => {
  const data = withCash();
  transfer(data);
  unchangedOnError(data, () => deleteAccount(data, 'cash'), /есть операции/u);
});

test('categories and subcategories can be added, renamed and removed with references protected', () => {
  const data = createInitialData();
  const category = saveCategory(data, {type: 'expense', name: 'Здоровье', icon: 'wallet'});
  assert.equal(category.subs.length, 1);
  assert.equal(category.subs[0].name, 'Общее');
  const sub = saveSubcategory(data, 'expense', category.id, {name: 'Аптека'});
  saveSubcategory(data, 'expense', category.id, {id: sub.id, name: 'Лекарства'});
  saveCategory(data, {id: category.id, type: 'expense', name: 'Медицина', icon: 'list'});
  assert.equal(data.categories.expense.find(item => item.id === category.id).subs.find(item => item.id === sub.id).name, 'Лекарства');
  const item = expense(data, {categoryId: category.id, subcategoryId: sub.id});
  unchangedOnError(data, () => deleteCategory(data, 'expense', category.id), /есть операции/u);
  unchangedOnError(data, () => deleteSubcategory(data, 'expense', category.id, sub.id), /есть операции/u);
  deleteTransaction(data, item.id);
  deleteSubcategory(data, 'expense', category.id, sub.id);
  unchangedOnError(data, () => deleteSubcategory(data, 'expense', category.id, category.subs[0].id), /хотя бы одна/u);
  deleteCategory(data, 'expense', category.id);
  assert.ok(!data.categories.expense.some(item => item.id === category.id));
  for (const existing of [...data.categories.income].slice(1)) deleteCategory(data, 'income', existing.id);
  unchangedOnError(data, () => deleteCategory(data, 'income', data.categories.income[0].id), /последнюю/u);
});

test('invalid transaction changes never partially mutate the original state', () => {
  const data = withCash();
  const invalid = [
    {amountCents: 0}, {amountCents: -1}, {amountCents: 1.1}, {amountCents: NaN}, {amountCents: Infinity}, {amountCents: MAX_AMOUNT_CENTS + 1},
    {accountId: 'missing'}, {categoryId: 'missing'}, {subcategoryId: 'taxi'}, {type: 'income', categoryId: 'food'},
    {type: 'transfer', toAccountId: 'main'}, {type: 'transfer', toAccountId: 'missing'}, {toAccountId: 'cash'},
    {date: '2026-02-29'}, {date: '2026-04-31'}, {date: '2026-13-01'}, {date: '27.10.2026'}, {description: 'x'.repeat(1001)}
  ];
  for (const changes of invalid) unchangedOnError(data, () => expense(data, changes));
  expense(data, {date: '2024-02-29'});
  assert.equal(data.transactions.length, 1);
  unchangedOnError(data, () => deleteTransaction(data, 'missing'), /не найдена/u);
});

test('calendar-month summaries use selected account and exclude other months and transfers', () => {
  const data = withCash();
  expense(data, {amountCents: 10, date: '2024-02-01'});
  expense(data, {amountCents: 20, date: '2024-02-29', subcategoryId: 'groceries'});
  expense(data, {amountCents: 5, date: '2024-02-29', accountId: 'cash', categoryId: 'transport', subcategoryId: 'metro'});
  expense(data, {amountCents: 99, date: '2024-03-01'});
  income(data, {amountCents: 700, date: '2024-02-01'});
  transfer(data, {amountCents: 1000, date: '2024-02-10'});
  const stats = monthlyStats(data, {month: '2024-02', type: 'expense'});
  assert.equal(stats.total, 35);
  assert.equal(stats.count, 3);
  assert.equal(stats.daily.length, 29);
  assert.equal(stats.daily[0], 10);
  assert.equal(stats.daily[28], 25);
  assert.deepEqual(stats.byCategory.map(item => [item.name, item.total]), [['Еда', 30], ['Транспорт', 5]]);
  assert.deepEqual(stats.byCategory[0].subs.map(item => [item.name, item.total]), [['Продукты', 20], ['Кофе', 10]]);
  assert.equal(monthlyStats(data, {month: '2024-02', accountId: 'cash', type: 'expense'}).total, 5);
  assert.equal(monthlyStats(data, {month: '2024-02', type: 'income'}).total, 700);
  assert.equal(monthlyStats(data, {month: '2024-04', type: 'expense'}).daily.length, 30);
  assert.equal(monthlyStats(data, {month: '2024-04', type: 'expense'}).total, 0);
  const before = totalBalance(data);
  monthlyTransactions(data, {month: '2020-01', accountId: 'cash'});
  assert.equal(totalBalance(data), before, 'month selection never changes current balances');
  assert.throws(() => monthlyTransactions(data, {month: '2024-13'}));
  assert.throws(() => monthlyTotal(data, {month: '2024-02', type: 'transfer'}));
});

test('state validation rejects duplicate IDs, missing references, unsupported schema and invalid timestamps', () => {
  const fixture = withCash();
  expense(fixture);
  const corruptions = [
    data => {data.version = 2;},
    data => {data.revision = -1;},
    data => {data.settings.currency = 'USD';},
    data => {data.accounts = [];},
    data => {data.accounts.push({...data.accounts[0]});},
    data => {data.accounts = new Array(1);},
    data => {data.categories.expense = [];},
    data => {data.categories.expense[0].subs = [];},
    data => {data.categories.expense[1].subs[0].id = data.categories.expense[0].subs[0].id;},
    data => {data.transactions.push({...data.transactions[0]});},
    data => {data.transactions[0].accountId = 'missing';},
    data => {data.transactions[0].categoryId = 'work';},
    data => {data.transactions[0].subcategoryId = 'taxi';},
    data => {data.transactions[0].amountCents = '100';},
    data => {data.transactions[0].amountCents = Number.MAX_SAFE_INTEGER;},
    data => {data.transactions[0].createdAt = '2026-02-31T12:00:00.000Z';},
    data => {data.transactions[0].updatedAt = '2020-01-01T00:00:00.000Z';},
    data => {data.transactions[0].date = '2026-00-10';},
    data => {data.transactions[0].type = 'unknown';}
  ];
  for (const corrupt of corruptions) {
    const data = structuredClone(fixture);
    corrupt(data);
    assert.throws(() => validateData(data));
  }
  const original = structuredClone(fixture);
  fixture.extra = 'ignored';
  fixture.accounts[0].extra = 'ignored';
  assert.deepEqual(validateData(fixture), original, 'only canonical known fields are retained');
});

test('backup roundtrip validates before replacement and shares no references', () => {
  const data = withCash(222);
  expense(data, {amountCents: 101, description: '<img src=x onerror=alert(1)>'});
  transfer(data, {amountCents: 50});
  const backup = createBackup(data);
  assert.equal(backup.format, 'chesno-backup');
  assert.equal(backup.version, DATA_VERSION);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), data);
  assert.deepEqual(parseBackup(backup), data);
  backup.data.accounts[0].name = 'Поменялось';
  assert.equal(data.accounts[0].name, 'Основной');
  for (const invalid of [null, [], data, '{', {...createBackup(data), version: 2}, {...createBackup(data), format: 'another-app'}, {...createBackup(data), unexpected: true}, {...createBackup(data), exportedAt: 'not-a-date'}]) assert.throws(() => parseBackup(invalid));
  const invalidData = createBackup(data);
  invalidData.data.transactions[0].subcategoryId = 'missing';
  assert.throws(() => parseBackup(invalidData), /подкатегорию/u);
});

test('localToday follows the device local date rather than UTC', () => {
  const moduleURL = new URL('../design/model.js', import.meta.url).href;
  const script = `import {localToday} from ${JSON.stringify(moduleURL)}; process.stdout.write(localToday(new Date('2026-10-26T22:30:00.000Z')));`;
  const moscow = execFileSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, TZ: 'Europe/Moscow'}, encoding: 'utf8'});
  const losAngeles = execFileSync(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, TZ: 'America/Los_Angeles'}, encoding: 'utf8'});
  assert.equal(moscow, '2026-10-27');
  assert.equal(losAngeles, '2026-10-26');
  assert.throws(() => localToday(new Date('invalid')));
});

test('unsafe aggregate sums are rejected instead of rounding financial totals', () => {
  const data = createInitialData();
  data.accounts[0].openingCents = Number.MAX_SAFE_INTEGER;
  data.accounts.push({id: 'cash', name: 'Наличные', openingCents: 1});
  assert.throws(() => totalBalance(data), /точного/u);
  assert.throws(() => validateData(data), /Начальный остаток/u);
});
