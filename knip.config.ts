import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  // ImplementInterface picks the `internal` namespace out of the implementation
  // module at construct time, so the runtime reaches it by convention rather
  // than through an import Knip can follow. Same reason as the preset's own
  // src/interfaces/**/*.ts entry, which does not match this layout.
  entry: ["src/implementations/**/*.ts"],
  // `ajs` comes from @antelopejs/core, which CI installs globally rather than
  // pulling the whole CLI into every module's dependency tree.
  ignoreBinaries: ["ajs"],
  ignoreDependencies: [
    // Mocha's globals, supplied to the suites `ajs module test` runs.
    "@types/mocha",
  ],
});
