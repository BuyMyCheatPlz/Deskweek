"use strict";
const { checkGithubUpdate, downloadAndInstallUpdate } = require("./updater.cjs");
function createUpdates({ windows, dataDir }) {
  let state = { phase: "idle", info: null, error: "" }, checking, installing = false;
  const emit = () => windows.broadcast("deskweek:update-state", state);
  return {
    state: () => state,
    check() {
      if (checking) return checking;
      state = { phase: "checking", info: null, error: "" }; emit();
      checking = checkGithubUpdate().then(info => { state = { phase: "done", info, error: "" }; return info; }, error => {
        state = { phase: "error", info: null, error: error.message }; throw error;
      }).finally(() => { checking = null; emit(); });
      return checking;
    },
    async install(event) {
      if (installing) throw new Error("更新正在进行中");
      installing = true;
      try { return await downloadAndInstallUpdate(event, dataDir); }
      finally { installing = false; }
    },
  };
}
module.exports = { createUpdates };
