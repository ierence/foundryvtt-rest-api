// @ts-nocheck
import { saveAs } from "file-saver";
import JSZip from "jszip";

export async function exportScene(sceneId: string): Promise<void> {
  const scene = game.scenes?.get(sceneId);
  if (!scene) {
    console.error(`Scene with ID ${sceneId} not found`);
    return;
  }

  const zip = new JSZip();

  // Add scene JSON data
  zip.file(`${scene.name}.json`, JSON.stringify(scene.toObject()));

  // Add scene background image
  if (scene.background?.src) {
    const background = await fetch(scene.background.src).then((res) =>
      res.blob()
    );
    zip.file(`assets/backgrounds/${scene.name}.jpg`, background);
  }

  // Add actors for each token
  for (const token of scene.tokens.contents) {
    if (token.actor) {
      const actorData = token.actor.toObject();
      zip.file(
        `assets/actors/${token.actor.name}.json`,
        JSON.stringify(actorData)
      );

      // Fetch and include actor image
      if (actorData.img) {
        const actorImg = await fetch(actorData.img).then((res) => res.blob());
        zip.file(`assets/actors/images/${token.actor.name}.png`, actorImg);
      }
    }
  }

  // Add tiles and their images
  for (const tile of scene.tiles.contents) {
    if (tile.texture.src) {
      const tileImg = await fetch(tile.texture.src).then((res) => res.blob());
      zip.file(`assets/tiles/${tile._id}.png`, tileImg);
      // Update the tile texture reference in scene data
      tile.texture.src = `assets/tiles/${tile._id}.png`;
    }
  }

  // Generate and download the zip file
  const content = await zip.generateAsync({ type: "blob" });
  saveAs(content, `${scene.name}-export.zip`);
}
