import { mountOptions } from "@ys/gateway";
import { assembleView } from "./platform.js";
export const startOptions = () => mountOptions(assembleView());
if (location.protocol === "chrome-extension:") startOptions();
