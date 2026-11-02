const EVENT = "shafan:orders-changed";
const STORAGE_KEY = "shafan:orders-changed-at";

export function publishOrderChange() {
  window.dispatchEvent(new Event(EVENT));
  try { window.localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* storage may be disabled */ }
}

export function subscribeOrderChanges(callback) {
  const onStorage = (event) => { if (event.key === STORAGE_KEY) callback(); };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", callback);
  };
}
