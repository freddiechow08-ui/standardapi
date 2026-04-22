"""
download_hkipd_pdfs.py  (v7 — cleaned up)

Bulk-download patent PDFs from HKIPD's public e-search portal.

Pipeline for each patent:
  1. Navigate to search page (dismiss disclaimer modal if it appears).
  2. Enter the public number (with 'HK' prefix stripped) and submit.
  3. Click through to the detail page.
  4. Click "Published Documents" tab, then each "Specification" link.
  5. Harvest DOC_0_xxx IDs from page source, XHR interceptor, and perf logs.
  6. Download each PDF via /pt/fileActions/file?docId=DOC_0_xxx using
     cookies synced from the Selenium session into a requests.Session.

Key selectors (verified on the live site):
  - Search input:    #publicNumber
  - Search button:   #submitBtn
  - Result link:     url-result-cell a[href]
  - Disclaimer btn:  app-disclaimer-modal .disclaimer-btn button.btn-primary

Changes from v6:
  - Disclaimer timeout bumped 3 -> 8s (was racing slow page loads).
  - search_patent() re-checks for the modal mid-flow, not just on navigate.
  - failed.csv is now append-only with timestamps, so Ctrl+C is safe.
  - Uses the logging module, not print; progress shows an ETA.
  - Parameterised the KNOWN_FAKES SQL filter.
  - Dropped unused regexes and imports.

USAGE:
    python download_hkipd_pdfs.py --setup       # one-time session warm-up
    python download_hkipd_pdfs.py --limit 5     # quick test
    python download_hkipd_pdfs.py --random      # shuffle order
    python download_hkipd_pdfs.py               # process everything not yet downloaded
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException


# ======================================================================
# CONFIG
# ======================================================================
BASE_DIR      = Path(__file__).parent.resolve()
DB_PATH       = BASE_DIR / "patents_clean.db"
PDF_DIR       = BASE_DIR / "pdfs"
PROFILE_DIR   = Path.home() / "AppData" / "Local" / "patent-search-profile"
FAILED_LOG    = BASE_DIR / "failed.csv"

HOST          = "https://esearch.ipd.gov.hk"
SEARCH_URL    = f"{HOST}/nis-pos-view/"
FILE_URL_TMPL = f"{HOST}/nis-pos-view/pt/fileActions/file?docId={{doc_id}}"

THROTTLE_SEC  = 1.0
PAGE_TIMEOUT  = 60
HTTP_TIMEOUT  = 120
SPEC_WAIT     = 5      # seconds after clicking a Specification link
MODAL_TIMEOUT = 8      # bumped from 3 — was racing slow page loads
MAX_RETRIES   = 3

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
)

KNOWN_FAKES = (
    'HK123456', 'HK234567', 'HK345678', 'HK456789', 'HK567890',
    'HK678901', 'HK789012', 'HK890123', 'HK901234', 'HK012345',
    'HK112233', 'HK223344', 'HK334455', 'HK445566', 'HK556677',
    'HK667788', 'HK778899', 'HK889900', 'HK990011', 'HK101010',
)

DOCID_RE = re.compile(r"DOC_0_\d+")


# ======================================================================
# LOGGING
# ======================================================================
def setup_logging() -> logging.Logger:
    lg = logging.getLogger("hkipd")
    lg.setLevel(logging.INFO)
    if not lg.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(logging.Formatter("%(asctime)s  %(message)s", datefmt="%H:%M:%S"))
        lg.addHandler(h)
    return lg

log = setup_logging()


# ======================================================================
# DB
# ======================================================================
def load_patent_numbers(limit: int | None, randomize: bool) -> list[str]:
    if not DB_PATH.exists():
        sys.exit(f"DB not found: {DB_PATH}")
    con = sqlite3.connect(DB_PATH)
    placeholders = ",".join("?" * len(KNOWN_FAKES))
    sql = f"""
        SELECT DISTINCT patent_number FROM patents
        WHERE patent_number IS NOT NULL
          AND patent_number != ''
          AND LENGTH(patent_number) >= 9
          AND patent_number NOT IN ({placeholders})
    """
    if randomize:
        sql += " ORDER BY RANDOM()"
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = [r[0] for r in con.execute(sql, KNOWN_FAKES).fetchall()]
    con.close()
    return rows


# ======================================================================
# BROWSER
# ======================================================================
def make_driver(headless: bool = False, profile_dir: Path | None = None) -> uc.Chrome:
    p = profile_dir or PROFILE_DIR
    p.mkdir(exist_ok=True)
    (p / "Default" / "LOCK").unlink(missing_ok=True)
    opts = uc.ChromeOptions()
    opts.add_argument(f"--user-data-dir={p}")
    opts.add_argument("--window-size=1400,900")
    if headless:
        opts.add_argument("--headless=new")
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    driver = uc.Chrome(options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT)
    return driver


def setup_session() -> None:
    """Open a visible browser so the user can accept T&Cs once. Persists to profile."""
    log.info("[setup] Warming session. Accept any T&Cs in the browser, then close Chrome.")
    driver = make_driver(headless=False)
    navigate(driver, SEARCH_URL)
    try:
        while True:
            _ = driver.title
            time.sleep(2)
    except WebDriverException:
        log.info("[setup] Session saved to %s", PROFILE_DIR.name)


# ----------------------------------------------------------------------
# Disclaimer / navigation
# ----------------------------------------------------------------------
def click_accept_button(driver, timeout: float = MODAL_TIMEOUT) -> bool:
    """If the HKIPD disclaimer modal is visible, scroll to the bottom and Accept.

    Returns True if the modal was clicked away, False if it never appeared.
    """
    try:
        WebDriverWait(driver, timeout).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, "app-disclaimer-modal"))
        )
    except TimeoutException:
        return False

    try:
        modal_body = driver.find_element(By.CSS_SELECTOR, "app-disclaimer-modal .modal-body")
        driver.execute_script(
            "arguments[0].scrollTop = arguments[0].scrollHeight;", modal_body
        )
        WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, "app-disclaimer-modal .disclaimer-btn button.btn-primary")
            )
        )
        btn = driver.find_element(
            By.CSS_SELECTOR, "app-disclaimer-modal .disclaimer-btn button.btn-primary"
        )
        driver.execute_script("arguments[0].click();", btn)
        WebDriverWait(driver, timeout).until(
            EC.invisibility_of_element_located((By.CSS_SELECTOR, "app-disclaimer-modal"))
        )
        return True
    except TimeoutException:
        return False


def navigate(driver, url: str) -> None:
    """Go to URL; dismiss the disclaimer modal if it pops up."""
    driver.get(url)
    click_accept_button(driver)


def click_patent_search_entry(driver) -> None:
    """If the landing page shows a 'Search for Patent' button, click through."""
    ENTRY_XPATH = (
        "//*["
        "contains(normalize-space(text()),'Search for Patent') or "
        "contains(normalize-space(text()),'Patent Search') or "
        "contains(normalize-space(text()),'搜尋專利') or "
        "contains(normalize-space(text()),'专利搜索') or "
        "contains(normalize-space(text()),'Search Patent')"
        "]"
    )
    try:
        btn = WebDriverWait(driver, 6).until(
            EC.element_to_be_clickable((By.XPATH, ENTRY_XPATH))
        )
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        driver.execute_script("arguments[0].click();", btn)
        time.sleep(1.0)
    except TimeoutException:
        pass  # already on search page


# ----------------------------------------------------------------------
# Network / JS interceptor
# ----------------------------------------------------------------------
JS_INTERCEPT = """
window.__capturedUrls = window.__capturedUrls || [];
(function() {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) {
        if (url) window.__capturedUrls.push(url);
        return origOpen.apply(this, arguments);
    };
    var origFetch = window.fetch;
    window.fetch = function(url) {
        if (url) window.__capturedUrls.push(typeof url === 'string' ? url : (url.url || ''));
        return origFetch.apply(this, arguments);
    };
})();
"""

def inject_interceptor(driver) -> None:
    try:
        driver.execute_script(JS_INTERCEPT)
    except Exception:
        pass

def collect_intercepted(driver) -> list[str]:
    try:
        return driver.execute_script("return window.__capturedUrls || [];") or []
    except Exception:
        return []

def clear_intercepted(driver) -> None:
    try:
        driver.execute_script("window.__capturedUrls = [];")
    except Exception:
        pass

def drain_perf_logs(driver) -> None:
    try:
        driver.get_log("performance")
    except Exception:
        pass


# ======================================================================
# SEARCH & EXTRACT
# ======================================================================
def strip_hk(pn: str) -> str:
    return pn[2:] if pn.upper().startswith("HK") else pn


def search_patent(driver, patent_number: str) -> bool:
    """Search for a patent. Returns True if at least one result card appeared."""
    drain_perf_logs(driver)
    try:
        navigate(driver, SEARCH_URL)          # step 1: load page + dismiss modal
    except Exception:
        return False

    click_patent_search_entry(driver)         # step 2: click "Search for Patent"
    click_accept_button(driver)               # step 3: dismiss modal again if it reappears

    try:
        wait = WebDriverWait(driver, PAGE_TIMEOUT)
        inp = wait.until(EC.presence_of_element_located((By.ID, "publicNumber")))

        # Modal sometimes slides in late on slow loads — catch it before we type
        click_accept_button(driver, timeout=2)

        inp.clear()
        inp.send_keys(strip_hk(patent_number))
        time.sleep(0.3)

        # One more check in case Angular re-renders between typing and clicking
        click_accept_button(driver, timeout=1)

        btn = wait.until(EC.element_to_be_clickable((By.ID, "submitBtn")))
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        driver.execute_script("arguments[0].click();", btn)
    except TimeoutException:
        return False

    try:
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, "url-result-cell a[href]")
            )
        )
        return True
    except TimeoutException:
        return False


def open_detail_page(driver) -> None:
    """Click the title link inside <url-result-cell> to load the detail view."""
    click_accept_button(driver, timeout=2)
    wait = WebDriverWait(driver, PAGE_TIMEOUT)
    link = wait.until(EC.element_to_be_clickable(
        (By.CSS_SELECTOR, "url-result-cell a[href]")
    ))
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", link)
    driver.execute_script("arguments[0].click();", link)


def get_doc_ids_from_detail(driver) -> list[str]:
    """On the detail page, click each 'Specification' link and harvest DOC_0_xxx
    IDs from every available source: page source, XHR/fetch interceptor, Chrome
    performance logs, the URL bar, and any newly opened windows.

    Returns a list of unique IDs preserving first-seen order.
    """
    SPEC_XPATH = ("//a[normalize-space(text())='Specification' or "
                  "normalize-space(text())='说明书' or "
                  "normalize-space(text())='規格' or "
                  "contains(normalize-space(text()),'Spec')]")
    PUB_DOCS_XPATH = ("//*[contains(normalize-space(text()),'Published Documents') or "
                      "contains(normalize-space(text()),'發表')]")
    wait = WebDriverWait(driver, PAGE_TIMEOUT)

    # Open the "Published Documents" tab if it's there
    try:
        tab = wait.until(EC.element_to_be_clickable((By.XPATH, PUB_DOCS_XPATH)))
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", tab)
        tab.click()
        time.sleep(1.5)
    except TimeoutException:
        pass

    wait.until(EC.presence_of_element_located((By.XPATH, SPEC_XPATH)))

    # First pass: detail page source may already contain a DOC_0_xxx
    doc_ids: list[str] = []
    for did in DOCID_RE.findall(driver.page_source):
        if did not in doc_ids:
            doc_ids.append(did)

    inject_interceptor(driver)
    spec_links = driver.find_elements(By.XPATH, SPEC_XPATH)
    main_window = driver.current_window_handle

    for link in spec_links:
        clear_intercepted(driver)
        drain_perf_logs(driver)
        handles_before = set(driver.window_handles)
        try:
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", link)
            link.click()
        except Exception:
            continue

        time.sleep(SPEC_WAIT)

        # Collect everything that might contain DOC_0_xxx
        urls_to_scan: list[str] = [driver.current_url] + collect_intercepted(driver)
        for h in set(driver.window_handles) - handles_before:
            try:
                driver.switch_to.window(h)
                urls_to_scan.append(driver.current_url)
                driver.close()
            except Exception:
                pass
        driver.switch_to.window(main_window)

        all_text = " ".join(urls_to_scan) + " " + driver.page_source
        try:
            for entry in driver.get_log("performance"):
                all_text += " " + json.dumps(entry)
        except Exception:
            pass

        for did in DOCID_RE.findall(all_text):
            if did not in doc_ids:
                doc_ids.append(did)

        # If we navigated into the docviewer, back out so the next link works
        if "docviewer" in driver.current_url:
            driver.back()
            click_accept_button(driver, timeout=2)
            time.sleep(1.0)
            inject_interceptor(driver)

    return doc_ids


def find_doc_ids(driver, patent_number: str) -> list[str]:
    """Full search-to-IDs flow with retries."""
    for attempt in range(MAX_RETRIES):
        if attempt > 0:
            time.sleep(3 * attempt)
        if not search_patent(driver, patent_number):
            continue
        try:
            open_detail_page(driver)
        except TimeoutException:
            continue
        try:
            ids = get_doc_ids_from_detail(driver)
            if ids:
                return ids
        except TimeoutException:
            continue
    return []


# ======================================================================
# HTTP DOWNLOAD
# ======================================================================
def sync_cookies(driver, session: requests.Session) -> None:
    session.cookies.clear()
    for c in driver.get_cookies():
        session.cookies.set(c["name"], c["value"], domain=c.get("domain"))


def download_pdf(session: requests.Session, doc_id: str, dest: Path) -> bool:
    url = FILE_URL_TMPL.format(doc_id=doc_id)
    try:
        r = session.get(url, timeout=HTTP_TIMEOUT, stream=True)
        ct = r.headers.get("Content-Type", "")
        if r.status_code != 200 or "pdf" not in ct.lower():
            return False
        with open(dest, "wb") as f:
            for chunk in r.iter_content(64 * 1024):
                if chunk:
                    f.write(chunk)
        return dest.exists() and dest.stat().st_size > 1000
    except requests.RequestException:
        return False


# ======================================================================
# FAILED-LOG (incremental, append-only)
# ======================================================================
class FailedLog:
    """Ctrl+C-safe failure log: every failure flushed to disk immediately."""

    def __init__(self, path: Path):
        self.path = path
        fresh = not path.exists()
        self._fh = open(path, "a", newline="", encoding="utf-8")
        self._w = csv.writer(self._fh)
        if fresh:
            self._w.writerow(["timestamp", "patent_number", "reason"])
            self._fh.flush()
        self.count = 0

    def record(self, pn: str, reason: str) -> None:
        self._w.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), pn, reason])
        self._fh.flush()
        self.count += 1

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:
            pass


# ======================================================================
# MAIN
# ======================================================================
def format_eta(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


def run_worker(worker_id: int, pn_list: list[str], total: int) -> tuple[int, int]:
    """Run a single browser worker downloading patents from pn_list."""
    import multiprocessing
    profile_dir = Path.home() / "AppData" / "Local" / f"patent-search-profile-{worker_id}"
    wlog = logging.getLogger(f"hkipd.w{worker_id}")

    time.sleep(worker_id * 1)  # slight stagger to avoid system overload on spawn
    driver = make_driver(headless=False, profile_dir=profile_dir)
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/pdf,*/*",
        "Referer": SEARCH_URL,
    })
    sync_cookies(driver, session)

    failed = FailedLog(BASE_DIR / f"failed_w{worker_id}.csv")
    ok = 0
    t0 = time.time()

    try:
        for i, pn in enumerate(pn_list, 1):
            elapsed = time.time() - t0
            avg = elapsed / i
            eta = format_eta(avg * (len(pn_list) - i))
            wlog.info("[W%d %d/%d eta %s] %s", worker_id, i, len(pn_list), eta, pn)

            try:
                doc_ids = find_doc_ids(driver, pn)
                if not doc_ids:
                    wlog.info("    NO DOCID")
                    failed.record(pn, "no docId found")
                    time.sleep(THROTTLE_SEC)
                    continue

                sync_cookies(driver, session)
                saved: list[str] = []
                for idx, did in enumerate(doc_ids):
                    suffix = "" if len(doc_ids) == 1 else f"_{idx + 1}"
                    dest = PDF_DIR / f"{pn}{suffix}.pdf"
                    if download_pdf(session, did, dest):
                        saved.append(dest.name)

                if saved:
                    ok += 1
                    wlog.info("    OK  %s", ", ".join(saved))
                else:
                    wlog.info("    DL FAILED  docIds=%s", doc_ids)
                    failed.record(pn, f"download failed: {doc_ids}")

            except Exception as e:
                wlog.info("    ERROR  %s: %s", type(e).__name__, e)
                failed.record(pn, f"{type(e).__name__}: {e}")

            time.sleep(THROTTLE_SEC)

    except KeyboardInterrupt:
        pass
    finally:
        failed.close()
        try:
            driver.quit()
        except Exception:
            pass

    return ok, failed.count


def main(limit: int | None, randomize: bool, n_workers: int = 1) -> None:
    import multiprocessing

    PDF_DIR.mkdir(exist_ok=True)
    all_pns = load_patent_numbers(limit, randomize)
    have = {p.stem.split("_")[0] for p in PDF_DIR.glob("*.pdf")}
    todo = [p for p in all_pns if p not in have]

    log.info(
        "[main] From DB: %d  |  Already have: %d  |  To do: %d  |  Workers: %d",
        len(all_pns), len(have), len(todo), n_workers,
    )
    if not todo:
        return

    if n_workers == 1:
        # Single-worker path (original behaviour)
        chunks = [todo]
    else:
        # Split evenly across workers
        chunks = [todo[i::n_workers] for i in range(n_workers)]

    # Pre-patch chromedriver once so workers don't race on the executable
    log.info("[main] Pre-patching chromedriver...")
    _d = make_driver(headless=True)
    _d.quit()
    log.info("[main] Chromedriver ready. Spawning workers...")

    t0 = time.time()

    if n_workers == 1:
        ok, nfail = run_worker(0, chunks[0], len(todo))
    else:
        with multiprocessing.Pool(processes=n_workers) as pool:
            results = pool.starmap(
                run_worker,
                [(wid, chunk, len(todo)) for wid, chunk in enumerate(chunks)]
            )
        ok = sum(r[0] for r in results)
        nfail = sum(r[1] for r in results)

    dt = time.time() - t0
    log.info("[main] %d OK / %d failed in %s", ok, nfail, format_eta(dt))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--setup",   action="store_true", help="open browser for one-time T&C accept")
    p.add_argument("--limit",   type=int, default=None, help="cap number of patents this run")
    p.add_argument("--random",  action="store_true", help="shuffle patent order")
    p.add_argument("--workers", type=int, default=1, help="number of parallel browser workers (default 1)")
    args = p.parse_args()

    if args.setup:
        setup_session()
    else:
        main(args.limit, args.random, args.workers)
