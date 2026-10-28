import { createVocabularyView } from "@ys/vocabulary/presentation";
import { mountPanel } from "@ys/gateway";
import { createReadingView } from "@ys/reading/presentation";
import { createTranslationView } from "@ys/translation/presentation";
import { createExplanationView } from "@ys/explanation/presentation";
import { createSummaryView } from "@ys/summary/presentation";
import { createCollectionView } from "@ys/collection/presentation";
import { createExportView } from "@ys/export/presentation";
import { assembleView } from "./platform.js";

export function startPanel(api = assembleView()) {
  mountPanel(api, (host: any) => ({
    ...createReadingView(host),
    ...createVocabularyView(host),
    ...createTranslationView(host),
    ...createExplanationView(host),
    ...createSummaryView(host),
    ...createCollectionView(host),
    ...createExportView(host),
  }));
}
if (location.protocol === "chrome-extension:") startPanel();
