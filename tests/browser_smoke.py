#!/usr/bin/env python3
"""Exercise the real UI, IndexedDB, backup files and offline shell in Chromium.

Start `npm run dev`, then run `python3 tests/browser_smoke.py`.
Only a temporary browser profile and temporary backup files are used.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def money(text: str) -> int:
    number = re.sub(r"[^0-9,.-]", "", text.replace("−", "-"))
    return int(Decimal(number.replace(",", ".")) * 100)


def ready(page):
    expect(page.locator("#boot-status")).to_be_hidden(timeout=15000)
    expect(page.locator("#balance")).to_be_visible()


def snapshot(page):
    return page.evaluate("""async () => {
      const {openStore} = await import('./store.js');
      const store = await openStore();
      try { return await store.read(); } finally { store.close(); }
    }""")


def totals(page, total, expense=None, income=None):
    expect(page.locator("#balance")).to_have_text(re.compile(r"\d"))
    assert money(page.locator("#balance").inner_text()) == total
    if expense is not None:
        assert money(page.locator("#expense").inner_text()) == expense
    if income is not None:
        assert money(page.locator("#income").inner_text()) == income


def settings(page):
    page.locator("#settings-toggle").click()
    expect(page.locator("#settings-dialog")).to_be_visible()


def last_editor(page):
    return page.locator("dialog.mg-editor[open]").last


def submit_editor(page):
    editor = last_editor(page)
    heading_id = editor.get_attribute("aria-labelledby")
    editor.locator(".mg-submit").click()
    expect(page.locator(f'dialog[aria-labelledby="{heading_id}"]')).to_have_count(0)


def close_settings(page):
    page.locator("#mg-close").click()
    expect(page.locator("#settings-dialog")).to_be_hidden()


def edit_account(page, account_id, name, opening):
    page.locator(f'[data-mg-account="{account_id}"]').click()
    editor = last_editor(page)
    editor.get_by_label("Название счёта", exact=True).fill(name)
    editor.get_by_label("Начальный остаток счёта", exact=True).fill(opening)
    submit_editor(page)


def add_account(page, name, opening):
    page.locator("#mg-add-account").click()
    editor = last_editor(page)
    editor.get_by_label("Название счёта", exact=True).fill(name)
    editor.get_by_label("Начальный остаток счёта", exact=True).fill(opening)
    submit_editor(page)
    return next(item["id"] for item in snapshot(page)["accounts"] if item["name"] == name)


def choose_account(page, account_id, target=False):
    page.locator("#entry-to-account" if target else "#entry-account").click()
    page.locator(f'[data-pick-account="{account_id}"]').click()


def choose_category(page, category_id, sub_id):
    page.locator("#entry-category").click()
    page.locator(f'[data-pick-category="{category_id}"][data-pick-sub="{sub_id}"]').click()


def add_operation(page, amount, description, kind="expense", account_id="main", to=None,
                  category="food", sub="groceries", when=None):
    page.locator("#add").click()
    page.locator(f'[data-type="{kind}"]').click()
    page.locator("#amount").fill(amount)
    choose_account(page, account_id)
    if kind == "transfer":
        choose_account(page, to, target=True)
        expect(page.locator("#entry-category")).to_be_hidden()
    else:
        expect(page.locator("#save")).to_be_disabled()
        choose_category(page, category, sub)
    page.locator("#description").fill(description)
    if when:
        page.locator("#entry-date").fill(when)
    expect(page.locator("#save")).to_be_enabled()
    page.locator("#save").click()
    expect(page.locator("#entry")).to_be_hidden()
    return next(item["id"] for item in snapshot(page)["transactions"] if item["description"] == description)


def edit_operation(page, transaction_id, amount=None, description=None, when=None):
    page.locator(f'[data-transaction="{transaction_id}"]').click()
    if amount is not None:
        page.locator("#amount").fill(amount)
    if description is not None:
        page.locator("#description").fill(description)
    if when is not None:
        page.locator("#entry-date").fill(when)
    page.locator("#save").click()
    expect(page.locator("#entry")).to_be_hidden()



def failure_cases(browser_type, executable, base_url):
    """Protect saved data when another tab changes it or storage fails."""
    browser = browser_type.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    first = context.new_page()
    first.goto(base_url)
    ready(first)
    transaction_id = add_operation(first, "10", "Concurrent QA")
    second = context.new_page()
    second.goto(base_url)
    ready(second)
    first.locator(f'[data-transaction="{transaction_id}"]').click()
    first.locator("#amount").fill("20")
    edit_operation(second, transaction_id, amount="15")
    first.locator("#save").click()
    expect(first.locator("#entry-error")).to_contain_text("другой вкладке")
    assert snapshot(first)["transactions"][0]["amountCents"] == 1500
    expect(first.locator("#amount")).to_have_value("20")
    first.locator("#close-entry").click()
    first.locator(f'[data-transaction="{transaction_id}"]').click()
    edit_operation(second, transaction_id, amount="17")
    first.locator("#delete-operation").click()
    first.locator("#confirm-delete").click()
    expect(first.locator("#picker-error")).to_contain_text("изменилась")
    assert snapshot(first)["transactions"][0]["amountCents"] == 1700
    context.close()
    print("PASS stale edits/deletions preserve the other tab's committed change and the unsaved draft")

    context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = context.new_page()
    page.goto(base_url)
    ready(page)
    page.locator("#add").click()
    page.locator("#amount").fill("123,45")
    choose_category(page, "food", "groceries")
    page.locator("#description").fill("Не потерять при ошибке")
    page.evaluate("""() => {
      window.__chesnoOriginalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function() {
        throw new DOMException('Injected quota failure', 'QuotaExceededError');
      };
    }""")
    page.locator("#save").click()
    expect(page.locator("#entry-error")).to_contain_text("недостаточно места")
    expect(page.locator("#entry")).to_be_visible()
    expect(page.locator("#amount")).to_have_value("123,45")
    expect(page.locator("#description")).to_have_value("Не потерять при ошибке")
    expect(page.locator("#save")).to_be_enabled()
    assert snapshot(page)["transactions"] == []
    totals(page, 0)
    if page.locator("#toast").is_visible():
        assert "добавлена" not in page.locator("#toast").inner_text()
    page.evaluate("() => { IDBObjectStore.prototype.put = window.__chesnoOriginalPut; }")
    page.reload()
    ready(page)
    assert snapshot(page)["transactions"] == []
    totals(page, 0, 0, 0)
    context.close()
    print("PASS quota failure keeps the draft, reports failure and preserves saved balances after reload")

    context = browser.new_context()
    context.add_init_script("Object.defineProperty(window, 'indexedDB', {configurable: true, value: undefined});")
    page = context.new_page()
    page.goto(base_url)
    expect(page.locator("#retry-boot")).to_be_visible()
    expect(page.locator("#boot-message")).to_contain_text("IndexedDB")
    expect(page.locator("#add")).to_be_hidden()
    context.close()
    browser.close()
    print("PASS unavailable IndexedDB shows a retryable error instead of a memory-only app")


def run(base_url, executable):
    with tempfile.TemporaryDirectory(prefix="chesno-e2e-") as workspace, sync_playwright() as p:
        profile = str(Path(workspace) / "profile")
        launch = {"executable_path": executable, "headless": True, "args": ["--no-sandbox"],
                  "viewport": {"width": 390, "height": 844}, "timezone_id": "Europe/Moscow",
                  "reduced_motion": "reduce", "accept_downloads": True}
        context = p.chromium.launch_persistent_context(profile, **launch)
        errors = []
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base_url)
        ready(page)
        initial = snapshot(page)
        assert initial["transactions"] == []
        assert len(initial["accounts"]) == 1 and initial["accounts"][0]["openingCents"] == 0
        assert page.locator('input[type="search"],#search-toggle,#search-field').count() == 0
        totals(page, 0, 0, 0)
        print("PASS first launch: empty operations, zero balances, no search")

        settings(page)
        edit_account(page, "main", "Основной", "1000")
        cash = add_account(page, "Наличные", "100")
        unused = add_account(page, "Удалить QA", "0")
        page.locator(f'[data-mg-account="{unused}"]').click()
        last_editor(page).locator("[data-delete]").click()
        submit_editor(page)
        assert all(account["id"] != unused for account in snapshot(page)["accounts"])
        close_settings(page)
        totals(page, 110000)

        expense = add_operation(page, "123,45", "Продукты QA")
        add_operation(page, "500", "Зарплата QA", kind="income", category="work", sub="salary")
        transfer = add_operation(page, "200", "В кошелёк QA", kind="transfer", to=cash)
        totals(page, 147655, 12345, 50000)
        assert money(page.locator('[data-balance-account="main"] .balance-account-value').inner_text()) == 117655
        assert money(page.locator(f'[data-balance-account="{cash}"] .balance-account-value').inner_text()) == 30000
        page.locator(f'[data-balance-account="{cash}"]').click()
        totals(page, 147655, 0, 0)
        expect(page.locator(f'[data-transaction="{transfer}"]')).to_be_visible()
        page.locator(f'[data-balance-account="{cash}"]').click()
        edit_operation(page, expense, amount="100")
        totals(page, 150000, 10000, 50000)
        page.locator(f'[data-transaction="{expense}"]').click()
        page.locator("#delete-operation").click()
        page.locator("#confirm-delete").click()
        expect(page.locator("#entry")).to_be_hidden()
        totals(page, 160000, 0, 50000)
        print("PASS account CRUD, expense/income/edit/delete, transfer neutrality and account scope")

        settings(page)
        page.locator("#mg-add-category").click()
        last_editor(page).get_by_label("Название категории", exact=True).fill("Здоровье QA")
        submit_editor(page)
        # Creation opens the new category editor automatically.
        expect(last_editor(page).locator("[data-add-sub]")).to_be_visible()
        category = next(item for item in snapshot(page)["categories"]["expense"] if item["name"] == "Здоровье QA")
        category_id, pharmacy = category["id"], category["subs"][0]["id"]
        last_editor(page).locator(f'[data-edit-sub="{pharmacy}"]').click()
        last_editor(page).get_by_label("Название подкатегории", exact=True).fill("Аптека QA")
        submit_editor(page)
        last_editor(page).locator("[data-add-sub]").click()
        last_editor(page).get_by_label("Название подкатегории", exact=True).fill("Врач QA")
        submit_editor(page)
        doctor = next(sub["id"] for cat in snapshot(page)["categories"]["expense"] if cat["id"] == category_id for sub in cat["subs"] if sub["name"] == "Врач QA")
        last_editor(page).locator(f'[data-edit-sub="{doctor}"]').click()
        last_editor(page).locator("[data-delete]").click()
        submit_editor(page)
        submit_editor(page)  # save/close the category editor
        close_settings(page)
        malicious_note = '<img src=x onerror="window.chesnoInjected=true">'
        health = add_operation(page, "25,25", malicious_note, category=category_id, sub=pharmacy)
        totals(page, 157475, 2525, 50000)
        assert page.locator("#history img").count() == 0
        assert not page.evaluate("Boolean(window.chesnoInjected)")
        page.locator('[data-view="stats"]').click()
        totals(page, 157475)
        assert money(page.locator("#stats-total").inner_text()) == 2525
        page.locator(f'[data-category="{category_id}"]').click()
        expect(page.locator(".stat-detail:not([hidden])")).to_contain_text("Аптека QA")
        page.locator('[data-stat-type="income"]').click()
        assert money(page.locator("#stats-total").inner_text()) == 50000
        page.locator('[data-view="home"]').click()
        print("PASS custom category/subcategory CRUD, safe notes and category/income analytics")

        settings(page)
        backup_path = Path(workspace) / "backup.json"
        with page.expect_download() as info:
            page.locator("#mg-export-json").click()
        info.value.save_as(backup_path)
        backup = json.loads(backup_path.read_text())
        assert backup["format"] == "chesno-backup" and backup["version"] == 1
        assert len(backup["data"]["accounts"]) == 2 and len(backup["data"]["transactions"]) == 3
        with page.expect_download() as info:
            page.locator("#mg-export-csv").click()
        csv_path = Path(workspace) / "operations.csv"
        info.value.save_as(csv_path)
        csv_text = csv_path.read_text(encoding="utf-8-sig")
        assert "Перевод" in csv_text and "Зарплата QA" in csv_text and ";" in csv_text
        close_settings(page)
        add_operation(page, "5", "Запись после копии QA")
        totals(page, 156975)
        settings(page)
        page.locator("#mg-import-file").set_input_files(backup_path)
        expect(last_editor(page)).to_contain_text("Восстановить данные?")
        expect(last_editor(page)).to_contain_text("Счета")
        last_editor(page).locator(".mg-cancel").click()
        assert len(snapshot(page)["transactions"]) == 4
        page.locator("#mg-import-file").set_input_files(backup_path)
        submit_editor(page)
        imported = snapshot(page)
        assert imported["transactions"] == backup["data"]["transactions"]
        assert imported["accounts"] == backup["data"]["accounts"]
        before_invalid = snapshot(page)
        page.locator("#mg-import-file").set_input_files({"name": "bad.json", "mimeType": "application/json", "buffer": b"{invalid"})
        expect(page.locator("#mg-backup-error")).to_be_visible()
        assert snapshot(page) == before_invalid
        invalid = json.loads(backup_path.read_text())
        invalid["data"]["transactions"][0]["accountId"] = "nonexistent"
        page.locator("#mg-import-file").set_input_files({"name": "dangling.json", "mimeType": "application/json", "buffer": json.dumps(invalid).encode()})
        expect(page.locator("#mg-backup-error")).to_contain_text("счёт")
        assert snapshot(page) == before_invalid
        close_settings(page)
        totals(page, 157475)
        print("PASS JSON/CSV export, import preview/cancel/roundtrip, malformed imports leave data unchanged")

        page.reload()
        ready(page)
        totals(page, 157475)
        assert snapshot(page)["transactions"] == imported["transactions"]
        context.close()
        context = p.chromium.launch_persistent_context(profile, **launch)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base_url)
        ready(page)
        totals(page, 157475)
        assert len(snapshot(page)["transactions"]) == 3
        page.evaluate("navigator.serviceWorker.ready.then(() => true)")
        page.reload(wait_until="networkidle")
        ready(page)
        page.wait_for_function("navigator.serviceWorker.controller !== null")
        context.set_offline(True)
        page.reload(wait_until="domcontentloaded")
        ready(page)
        expect(page.locator("#network-status")).to_be_visible()
        totals(page, 157475)
        add_operation(page, "10", "Офлайн QA")
        totals(page, 156475, 3525, 50000)
        page.reload(wait_until="domcontentloaded")
        ready(page)
        totals(page, 156475)
        context.set_offline(False)
        print("PASS persistence across page/browser restart and offline reload/save/reload")

        # Date/month controls use real calendar values and do not affect current balances.
        current = date.fromisoformat(page.evaluate("(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()"))
        previous_month = current.replace(day=1).toordinal() - 1
        past = date.fromordinal(previous_month).replace(day=1).isoformat()
        past_id = add_operation(page, "1", "Прошлый месяц QA", when=past)
        totals(page, 156375, 100, 0)
        page.locator('[data-month-picker]').first.click()
        page.locator("#current-month").click()
        totals(page, 156375, 3525, 50000)
        assert page.locator(f'[data-transaction="{past_id}"]').count() == 0
        for width, height in [(375, 812), (390, 844), (430, 932), (320, 568)]:
            page.set_viewport_size({"width": width, "height": height})
            page.locator("#add").click()
            page.locator("#amount").fill("999999999,99")
            choose_category(page, "food", "groceries")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.locator('[data-key="back"]').scroll_into_view_if_needed()
            rect = page.locator("#save").bounding_box()
            assert rect and 0 <= rect["y"] < height - rect["height"], (width, height, rect)
            expect(page.locator("#save")).to_be_enabled()
            page.locator("#close-entry").click()
        assert not errors, errors
        context.close()
        print("PASS arbitrary dates/months and 320/375/390/430 px layouts; JavaScript errors: 0")
        failure_cases(p.chromium, executable, base_url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4173/")
    parser.add_argument("--chromium", default=os.environ.get("CHESNO_CHROMIUM") or shutil.which("chromium"))
    parser.add_argument("--failure-cases-only", action="store_true", help="Run only concurrency/storage-failure checks")
    args = parser.parse_args()
    if not args.chromium:
        raise SystemExit("Chromium not found. Pass --chromium or set CHESNO_CHROMIUM.")
    if args.failure_cases_only:
        with sync_playwright() as p:
            failure_cases(p.chromium, args.chromium, args.base_url.rstrip("/") + "/")
    else:
        run(args.base_url.rstrip("/") + "/", args.chromium)
