import { createInitialData, validateData } from './model.js';

const DATABASE_NAME = 'chesno-finance';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'documents';
const STATE_KEY = 'main';
const CHANNEL_NAME = `${DATABASE_NAME}:changes`;

function storageError(error, fallback) {
  if (error?.name === 'StorageError') return error;
  const messages = {
    QuotaExceededError: 'На устройстве недостаточно места. Освободите место и попробуйте сохранить ещё раз.',
    SecurityError: 'Браузер запретил доступ к локальному хранилищу. Разрешите хранение данных для этого сайта.',
    InvalidStateError: 'Хранилище закрыто. Перезагрузите приложение, чтобы продолжить.',
    VersionError: 'На устройстве уже есть более новая версия хранилища. Обновите приложение.',
    AbortError: 'Не удалось завершить сохранение. Изменения не записаны. Попробуйте ещё раз.',
    UnknownError: 'Локальное хранилище недоступно. Проверьте свободное место и перезапустите приложение.'
  };
  const result = new Error(messages[error?.name] || fallback, { cause: error });
  result.name = 'StorageError';
  result.code = error?.name || 'StorageError';
  return result;
}

function reportStorageError(error) {
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent('chesno:storage-error', { detail: { message: error.message } }));
  }
}

function validateStoredData(value) {
  if (value === undefined) {
    throw storageError(null, 'Локальные данные не найдены. Перезапустите приложение.');
  }
  try {
    return validateData(value);
  } catch (error) {
    throw storageError(error, 'Не удалось прочитать локальные данные. Сохранённая база не изменена; восстановите резервную копию или обновите приложение.');
  }
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(storageError(null, 'В этом браузере недоступно локальное хранилище IndexedDB. Откройте приложение в Safari или другом поддерживаемом браузере.'));
  }
  return new Promise((resolve, reject) => {
    let request;
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(storageError(null, 'Локальное хранилище не отвечает. Закройте другие вкладки приложения и попробуйте снова.'));
    }, 15000);
    const fail = (error, fallback) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(storageError(error, fallback));
    };
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      fail(error, 'Не удалось открыть локальное хранилище.');
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE)) database.createObjectStore(OBJECT_STORE);
    };
    request.onblocked = () => fail(null, 'Обновлению хранилища мешает другая вкладка. Закройте остальные вкладки Чесно и перезагрузите приложение.');
    request.onerror = () => fail(request.error, 'Не удалось открыть локальное хранилище.');
    request.onsuccess = () => {
      if (finished) {
        request.result.close();
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve(request.result);
    };
  });
}

function writeTransaction(database) {
  try {
    return database.transaction(OBJECT_STORE, 'readwrite', { durability: 'strict' });
  } catch (error) {
    if (error?.name !== 'TypeError') throw error;
    // Older WebKit versions support readwrite transactions without the durability option.
    return database.transaction(OBJECT_STORE, 'readwrite');
  }
}

/**
 * Open the local database. Every write reads the current document inside its
 * transaction, so two tabs cannot overwrite one another with stale snapshots.
 * Returned write promises resolve only after IndexedDB confirms the commit.
 */
export async function openStore() {
  const database = await openDatabase();
  const listeners = new Set();
  let closed = false;
  let lastEmittedRevision = -1;
  let channel;
  let refreshing = false;
  let refreshAgain = false;

  function ensureOpen() {
    if (closed) throw storageError({ name: 'InvalidStateError' }, 'Хранилище закрыто.');
  }

  function emit(data) {
    if (closed || data.revision < lastEmittedRevision) return;
    lastEmittedRevision = data.revision;
    for (const listener of [...listeners]) {
      try {
        listener(structuredClone(data));
      } catch {
        // A broken view listener must not change the outcome of a committed write.
      }
    }
  }

  function notifyCommitted(data) {
    emit(data);
    try {
      channel?.postMessage({ revision: data.revision });
    } catch {
      // Focus/pageshow refresh below also works without BroadcastChannel.
    }
  }

  function read() {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let readError;
      try {
        ensureOpen();
        transaction = database.transaction(OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(OBJECT_STORE).get(STATE_KEY);
        request.onsuccess = () => {
          try {
            result = validateStoredData(request.result);
          } catch (error) {
            readError = error;
            transaction.abort();
          }
        };
      } catch (error) {
        reject(storageError(error, 'Не удалось прочитать локальные данные.'));
        return;
      }
      transaction.oncomplete = () => resolve(structuredClone(result));
      transaction.onabort = () => reject(readError || storageError(transaction.error, 'Не удалось прочитать локальные данные.'));
      transaction.onerror = () => { /* onabort preserves the actual transaction outcome. */ };
    });
  }

  function mutate(mutator, initialize = false) {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let mutationError;
      let changed = false;
      try {
        ensureOpen();
        transaction = writeTransaction(database);
        const documentStore = transaction.objectStore(OBJECT_STORE);
        const request = documentStore.get(STATE_KEY);
        request.onsuccess = () => {
          try {
            if (initialize) {
              if (request.result !== undefined) {
                result = validateStoredData(request.result);
                return;
              }
              result = validateData(createInitialData());
            } else {
              const current = validateStoredData(request.result);
              if (!Number.isSafeInteger(current.revision + 1)) {
                throw storageError(null, 'Достигнут предел версии данных. Экспортируйте резервную копию.');
              }
              result = structuredClone(current);
              const returned = mutator(result);
              if (returned && typeof returned.then === 'function') {
                Promise.resolve(returned).catch(() => {});
                throw new TypeError('Изменение данных должно выполняться синхронно.');
              }
              result.revision = current.revision + 1;
              result = validateData(result);
            }
            documentStore.put(result, STATE_KEY);
            changed = true;
          } catch (error) {
            mutationError = error instanceof DOMException
              ? storageError(error, 'Не удалось сохранить изменения. Сохранённые данные не изменены.')
              : error;
            transaction.abort();
          }
        };
      } catch (error) {
        reject(storageError(error, 'Не удалось начать сохранение данных.'));
        return;
      }
      transaction.oncomplete = () => {
        if (changed) notifyCommitted(result);
        resolve(structuredClone(result));
      };
      transaction.onabort = () => reject(mutationError || storageError(transaction.error, 'Не удалось сохранить изменения. Сохранённые данные не изменены.'));
      transaction.onerror = () => { /* Wait for abort; never report success for an uncommitted write. */ };
    });
  }

  function update(mutator) {
    if (typeof mutator !== 'function') return Promise.reject(new TypeError('Не передано изменение данных.'));
    return mutate(mutator);
  }

  function replace(data) {
    let replacement;
    try {
      replacement = validateData(structuredClone(data));
    } catch (error) {
      return Promise.reject(error);
    }
    return mutate(draft => {
      // Revalidate in the same readwrite transaction as the atomic replacement.
      validateData(replacement);
      for (const key of Object.keys(draft)) delete draft[key];
      for (const [key, value] of Object.entries(structuredClone(replacement))) {
        Object.defineProperty(draft, key, { value, enumerable: true, writable: true, configurable: true });
      }
    });
  }

  async function refresh() {
    if (closed || listeners.size === 0) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const data = await read();
        if (data.revision > lastEmittedRevision) emit(data);
      } while (refreshAgain && !closed);
    } catch (error) {
      if (!closed) reportStorageError(error);
    } finally {
      refreshing = false;
    }
  }

  function onVisibility() {
    if (globalThis.document?.visibilityState === 'visible') void refresh();
  }

  function close() {
    if (closed) return;
    closed = true;
    listeners.clear();
    channel?.close();
    database.close();
    globalThis.removeEventListener?.('focus', refresh);
    globalThis.removeEventListener?.('pageshow', refresh);
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
  }

  database.onversionchange = () => {
    close();
    reportStorageError(storageError(null, 'Хранилище обновлено в другой вкладке. Перезагрузите приложение, чтобы продолжить.'));
  };

  try {
    await mutate(null, true);
  } catch (error) {
    close();
    throw error;
  }

  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = event => {
        if (Number.isSafeInteger(event.data?.revision) && event.data.revision > lastEmittedRevision) void refresh();
      };
    }
  } catch {
    // Some private contexts disable BroadcastChannel while still permitting IDB.
  }
  globalThis.addEventListener?.('focus', refresh);
  globalThis.addEventListener?.('pageshow', refresh);
  globalThis.document?.addEventListener('visibilitychange', onVisibility);

  return Object.freeze({
    read,
    update,
    replace,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Не передан обработчик обновления данных.');
      ensureOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close
  });
}
