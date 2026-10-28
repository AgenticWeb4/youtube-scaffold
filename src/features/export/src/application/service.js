import {
  normalizeSections,
  requireSections,
  buildMarkdown,
  videoUrl,
} from "../domain/markdown.js";
export function createExportService({ store, picker, suffix } = {}) {
  const pickDirectory = picker;
  const uniqueSuffix =
    suffix ||
    (() =>
      `${new Date().toISOString().replace(/[:.]/g, "-")}-${globalThis.crypto.randomUUID().slice(0, 8)}`);

  async function readConfig() {
    const [directory, sections] = await Promise.all([
      store.get("directory"),
      store.get("sections"),
    ]);
    return {
      directoryName: directory?.name || "",
      sections: normalizeSections(sections),
    };
  }

  async function chooseDirectory() {
    // The picker runs before any awaited storage access to preserve user activation.
    const directory = await pickDirectory({
      id: "youtube-scaffold-export",
      mode: "readwrite",
    });
    await store.set("directory", directory);
    return directory.name;
  }

  async function setSections(input) {
    const sections = normalizeSections(input);
    requireSections(sections);
    await store.set("sections", sections);
    return {success:true};
  }

  async function saveStudy(study, loadNotes = async () => study.notes || []) {
    const url = videoUrl(study.videoId);
    const [directory, selected] = await Promise.all([
      store.get("directory"),
      store.get("sections"),
    ]);
    if (!directory)
      throw Object.assign(
        new Error("Choose an export folder in Settings first."),
        { code: "NO_DIRECTORY" },
      );
    const sections = normalizeSections(selected);
    requireSections(sections);
    const permission = { mode: "readwrite" };
    if (
      (await directory.queryPermission(permission)) !== "granted" &&
      (await directory.requestPermission(permission)) !== "granted"
    ) {
      throw Object.assign(
        new Error(
          "Folder access was not granted. Choose the folder again in Settings.",
        ),
        { code: "PERMISSION_DENIED" },
      );
    }
    const notes = sections.notes ? await loadNotes(study.videoId) : [];
    const markdown = buildMarkdown({ ...study, notes }, sections);
    const token = String(uniqueSuffix()).replace(/[^A-Za-z0-9_-]/g, "");
    if (!token) throw new Error("Could not create an export filename.");
    const filename = `${study.videoId}-${token}.md`;
    const file = await directory.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(markdown);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch (_) {
        /* Keep the original write error. */
      }
      throw error;
    }
    return { filename, directoryName: directory.name, url };
  }

  return {
    readConfig,
    chooseDirectory,
    setSections,
    saveStudy,
    reset: async () => {await store.clear();return {success:true};},
  };
}
