let initialization;

/** Register the offline shell without forcing updates over unsaved work. */
export function initPWA({ notify = () => {}, canUpdate = () => true } = {}) {
  if (initialization) return initialization;
  initialization = start({ notify, canUpdate });
  return initialization;
}

async function start({ notify, canUpdate }) {
  const networkStatus = document.getElementById('network-status');
  const installButton = document.getElementById('install-app');
  const updateBanner = document.getElementById('update-banner');
  const updateButton = document.getElementById('apply-update');
  const standalone = () => matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone);
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredInstall;
  let registration;
  let applying = false;
  let reloaded = false;

  const showNetworkState = () => {
    if (!networkStatus) return;
    networkStatus.textContent = navigator.onLine ? '' : 'Офлайн';
    networkStatus.hidden = navigator.onLine;
  };
  const showInstallState = () => {
    if (installButton) installButton.hidden = standalone();
  };
  showNetworkState();
  showInstallState();
  window.addEventListener('online', () => {
    showNetworkState();
    registration?.update().catch(() => {});
  });
  window.addEventListener('offline', showNetworkState);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstall = event;
    showInstallState();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    if (installButton) installButton.hidden = true;
  });
  installButton?.addEventListener('click', async () => {
    if (standalone()) return;
    if (deferredInstall) {
      const prompt = deferredInstall;
      deferredInstall = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted' && installButton) installButton.hidden = true;
      } catch {
        notify('Откройте меню браузера и выберите «Установить приложение».');
      }
      return;
    }
    notify(isIOS()
      ? 'В Safari: «Поделиться» → «На экран „Домой“».'
      : 'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».');
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    return { supported: false, registration: null };
  }

  const showUpdate = () => {
    if (updateBanner) updateBanner.hidden = !registration?.waiting;
    if (updateButton) updateButton.disabled = applying;
  };
  const reloadAfterUpdate = () => {
    if (!applying || reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadAfterUpdate);

  try {
    registration = await navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none'
    });
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
        if (worker.state === 'redundant' && !registration.active) {
          notify('Офлайн-режим пока не подготовлен. Откройте приложение с интернетом ещё раз.');
        }
      });
    });
    updateButton?.addEventListener('click', async () => {
      if (applying || !registration.waiting) return;
      try {
        if (!await canUpdate()) {
          notify('Сначала завершите текущую операцию.');
          return;
        }
      } catch {
        notify('Дождитесь сохранения данных перед обновлением.');
        return;
      }
      const worker = registration.waiting;
      if (!worker) return;
      applying = true;
      showUpdate();
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') reloadAfterUpdate();
        if (worker.state === 'redundant' && !reloaded) {
          applying = false;
          showUpdate();
          notify('Обновление не установилось. Попробуйте ещё раз.');
        }
      });
      worker.postMessage({ type: 'APPLY_UPDATE' });
    });
    // Check on subsequent launches even when the HTML came from the offline cache.
    registration.update().catch(() => {});
    return { supported: true, registration };
  } catch {
    notify('Офлайн-режим пока недоступен. Данные продолжают храниться на устройстве.');
    return { supported: true, registration: null };
  }
}
