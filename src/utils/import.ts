// @ts-nocheck
import JSZip from "jszip";

export async function importScene(file: File): Promise<void> {
  const zip = await JSZip.loadAsync(file);

  // Import actors first
  for (const filename of Object.keys(zip.files)) {
    if (filename.startsWith("assets/actors")) {
      let actorData = JSON.parse(await zip.file(filename).async("text"));
      const existingActor = game.actors?.find((a) => a.name === actorData.name);
      if (!existingActor) {
        if (actorData.img) {
          const imgBlob = await zip
            .file(`assets/actors/images/${actorData.name}.png`)
            ?.async("blob");
          if (imgBlob) {
            const imgFile = new File(
              [imgBlob],
              `actors/images/${actorData.name}.png`
            );
            await FilePicker.upload(
              "data",
              `worlds/${game.world.id}/assets/actors/images/`,
              imgFile
            );
            actorData.img = `worlds/${game.world.id}/assets/actors/images/${actorData.name}.png`;
          }
        }
        console.log(`Importing actor: ${actorData}`);
        await Actor.create(actorData);
      }
    }
  }

  // Import scene data
  const sceneData = JSON.parse(await zip.file(/\.json$/)[0].async("text"));
  const newScene = await Scene.create(sceneData);

  // Import assets (backgrounds, tokens, tiles, etc.)
  for (const filename of Object.keys(zip.files)) {
    if (filename.endsWith(".jpg") || filename.endsWith(".png")) {
      const assetBlob = await zip.file(filename)?.async("blob");
      const assetFile = new File([assetBlob!], filename);
      await FilePicker.upload(
        "data",
        `worlds/${game.world.id}/assets/`,
        assetFile
      );
    }
  }

  console.log(`Imported scene: ${newScene.name}`);
}
