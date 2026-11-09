"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { extractDocumentFiles } = require("./document-parser.cjs");
extractDocumentFiles(workerData).then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: error.message }));
