import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  entry: ["src/implementations/**/*.ts"],
  ignoreDependencies: ["@types/mocha"],
});
