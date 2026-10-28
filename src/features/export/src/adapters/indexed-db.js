export function createIndexedDbStore(indexedDB = globalThis.indexedDB) {
  function access(mode, operation) {
    return new Promise((resolve, reject) => {
      if (!indexedDB)
        return reject(new Error("Local export storage is unavailable."));
      const request = indexedDB.open("ytd_file_exports", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("settings");
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Close other extension settings pages and retry."));
      request.onsuccess = () => {
        const db = request.result;
        let result;
        try {
          const tx = db.transaction("settings", mode);
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error || new Error("Export settings were not saved."));
          };
          const action = operation(tx.objectStore("settings"));
          action.onsuccess = () => {
            result = action.result;
          };
        } catch (error) {
          db.close();
          reject(error);
        }
      };
    });
  }
  return {
    get: (key) => access("readonly", (store) => store.get(key)),
    set: (key, value) => access("readwrite", (store) => store.put(value, key)),
    clear: () => access("readwrite", (store) => store.clear()),
  };
}
