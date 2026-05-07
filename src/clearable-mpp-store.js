import { Json } from "ox";
import { Store } from "mppx";

/**
 * Same behavior as {@link Store.memory} from mppx, plus {@link clear} to wipe the backing Map
 * (for demo resets without restarting Node).
 */
export function createClearableMemoryStore() {
  const backend = new Map();

  const store = Store.from({
    async get(key) {
      const raw = backend.get(key);
      if (raw === undefined) return null;
      return Json.parse(raw);
    },
    async put(key, value) {
      backend.set(key, Json.stringify(value));
    },
    async delete(key) {
      backend.delete(key);
    },
  });

  function clear() {
    backend.clear();
  }

  return { store, clear };
}
