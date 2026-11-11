/* IndexedDB-Speicher. Enthält nur verschlüsselte Datensätze und den verpackten Schlüssel.
 *   meta   key/value  ("vault" = verpackte Schlüssel, "prefs" = Einstellungen ohne Inhalte)
 *   docs   {id, iv, ct}  verschlüsselte Metadaten eines Dokuments
 *   files  {id, iv, ct}  verschlüsselte Dateiinhalte
 */
const NAME = "nf-ablage", VERSION = 1;
let dbp;

function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("meta");
      db.createObjectStore("docs", { keyPath: "id" });
      db.createObjectStore("files", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const done = tx => new Promise((res, rej) => {
  tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
});
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getMeta(k) {
  const db = await open();
  return req(db.transaction("meta").objectStore("meta").get(k));
}
export async function setMeta(k, v) {
  const db = await open(); const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(v, k); return done(tx);
}
export async function all(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}
export async function get(store, id) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(id));
}
export async function has(store, id) {
  const db = await open();
  return (await req(db.transaction(store).objectStore(store).count(id))) > 0;
}

/* Schreibt Dokument und Dateien atomar in einer Transaktion. */
export async function write({ docs = [], files = [], deleteFiles = [], deleteDocs = [] }) {
  const db = await open(); const tx = db.transaction(["docs", "files"], "readwrite");
  const d = tx.objectStore("docs"), f = tx.objectStore("files");
  docs.forEach(x => d.put(x)); files.forEach(x => f.put(x));
  deleteFiles.forEach(id => f.delete(id)); deleteDocs.forEach(id => d.delete(id));
  return done(tx);
}

export async function destroy() {
  if (dbp) { (await dbp).close(); dbp = null; }
  return new Promise((res, rej) => {
    const r = indexedDB.deleteDatabase(NAME);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res();
  });
}
