import * as fsPromises from "fs/promises";
import copy from "rollup-plugin-copy";
import scss from "rollup-plugin-scss";
import { defineConfig, Plugin } from "vite";
import * as path from "path";
import * as os from "os";
import { id as moduleId } from "./src/module.json"; // Add this import at the top

const moduleVersion = process.env.MODULE_VERSION;
const githubProject = process.env.GH_PROJECT;
const githubTag = process.env.GH_TAG;

console.log("VSCODE_INJECTION", process.env.VSCODE_INJECTION);

const foundryVttDataPath = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "FoundryVTT",
  "Data",
  "modules"
);

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      input: "src/ts/module.ts",
      output: {
        dir: path.join(foundryVttDataPath, moduleId, "scripts"),
        entryFileNames: "module.js",
        format: "es",
      },
    },
  },
  plugins: [
    updateModuleManifestPlugin(),
    scss({
      output: path.join(foundryVttDataPath, moduleId, "style.css"),
      sourceMap: true,
      watch: ["src/styles/*.scss"],
    }),
    copy({
      targets: [
        { src: "src/languages", dest: path.join(foundryVttDataPath, moduleId) },
        { src: "src/templates", dest: path.join(foundryVttDataPath, moduleId) },
      ],
      hook: "writeBundle",
    }),
  ],
});

function updateModuleManifestPlugin(): Plugin {
  return {
    name: "update-module-manifest",
    async writeBundle(): Promise<void> {
      // Create dist directory in FoundryVTT modules path
      await fsPromises.mkdir(path.join(foundryVttDataPath, moduleId), { recursive: true });

      const packageContents = JSON.parse(
        await fsPromises.readFile("./package.json", "utf-8")
      ) as Record<string, unknown>;
      const version = moduleVersion || (packageContents.version as string);
      const manifestContents: string = await fsPromises.readFile(
        "src/module.json",
        "utf-8"
      );
      const manifestJson = JSON.parse(manifestContents) as Record<
        string,
        unknown
      >;
      manifestJson["version"] = version;
      if (githubProject) {
        const baseUrl = `https://github.com/${githubProject}/releases`;
        manifestJson["manifest"] = `${baseUrl}/latest/download/module.json`;
        if (githubTag) {
          manifestJson[
            "download"
          ] = `${baseUrl}/download/${githubTag}/module.zip`;
        }
      }

      // Write updated manifest to FoundryVTT modules path
      await fsPromises.writeFile(
        path.join(foundryVttDataPath, moduleId, "module.json"),
        JSON.stringify(manifestJson, null, 4)
      );
    },
  };
}
