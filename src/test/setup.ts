import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Point openflow's global config dir (#82) at an empty temp dir so the suite
// never reads the developer's real ~/.config/opencode/openflow.json. Tests that
// exercise global+project layering override OPENFLOW_GLOBAL_DIR themselves.
process.env["OPENFLOW_GLOBAL_DIR"] = mkdtempSync(resolve(tmpdir(), "openflow-global-empty-"));
