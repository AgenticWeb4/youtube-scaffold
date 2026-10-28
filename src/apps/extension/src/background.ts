import { mountWorker } from "@ys/gateway";
import { assembleWorker } from "./platform.js";
mountWorker(assembleWorker());
