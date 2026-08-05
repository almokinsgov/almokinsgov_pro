const roadsAssetUrl = () =>
  new URL("./gis/far-north-roads.json", document.baseURI).href;

export class RouteService {
  constructor({ onProgress } = {}) {
    this.onProgress = onProgress;
    this.sequence = 0;
    this.pending = new Map();
    this.readyPromise = null;
    this.worker = new Worker(new URL("./route-worker.js", import.meta.url), {
      type: "module"
    });
    this.worker.addEventListener("message", (event) =>
      this.handleMessage(event.data)
    );
    this.worker.addEventListener("error", (event) => {
      this.rejectAll(event.message || "The route worker stopped unexpectedly.");
    });
  }

  handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (message.progress) {
      this.onProgress?.(message.message);
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  request(type, payload, timeoutMs = 60000) {
    const id = `route-${Date.now()}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Route ${type} timed out after ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, type, payload });
    });
  }

  initialise() {
    if (!this.readyPromise) {
      this.readyPromise = this.request(
        "init",
        { roadsUrl: roadsAssetUrl() },
        90000
      ).catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    return this.readyPromise;
  }

  async findRoutes(options) {
    await this.initialise();
    return this.request("route", options, 60000);
  }

  rejectAll(message) {
    this.pending.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    });
    this.pending.clear();
  }

  destroy() {
    this.rejectAll("Route service was closed.");
    this.worker.terminate();
  }
}
