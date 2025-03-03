import { moduleId } from "../constants";
import { FoundryGetActorsExternal } from "../types";

interface FormData {
    folderUuid: string;
    exportPath: string;
    backupLimit: number;
}

export class ActorExportForm extends FormApplication<FormApplicationOptions, FormData> {
    // Add this constructor
    constructor(object?: object, options?: FormApplicationOptions) {
        super(object || {}, options);
    }
    
    static override get defaultOptions(): FormApplicationOptions {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "actor-export-form",
            title: "Export Actors",
            template: `modules/${moduleId}/templates/actor-export-form.hbs`,
            width: 400,
            height: 'auto',
            closeOnSubmit: true
        }) as FormApplicationOptions;
    }

    override getData(_options?: Partial<FormApplicationOptions>): FormData {
        return {
            folderUuid: (game as Game).settings.get(moduleId, "actorFolderUuid") as string,
            exportPath: (game as Game).settings.get(moduleId, "exportPath") as string,
            backupLimit: (game as Game).settings.get(moduleId, "backupLimit") as number
        };
    }

    override async _updateObject(_event: Event, formData: FormData): Promise<void> {
        // Update settings if changed
        if (formData.folderUuid) {
            await (game as Game).settings.set(moduleId, "actorFolderUuid", formData.folderUuid);
        }
        
        if (formData.exportPath) {
            await (game as Game).settings.set(moduleId, "exportPath", formData.exportPath);
        }
        
        if (formData.backupLimit !== undefined) {
            await (game as Game).settings.set(moduleId, "backupLimit", Number(formData.backupLimit));
        }
        
        // Perform export
        try {
            ui.notifications?.info("Exporting actors... Please wait.");
            const moduleData = (game as Game).modules.get(moduleId) as FoundryGetActorsExternal;
            
            if (moduleData?.api?.exportActors) {
                const exportPath = await moduleData.api.exportActors();
                if (exportPath) {
                    ui.notifications?.info(`Actors exported successfully to ${exportPath}`);
                } else {
                    ui.notifications?.warn("Export completed but no path was returned.");
                }
            } else {
                throw new Error("Export API is not available.");
            }
        } catch (error) {
            console.error(`${moduleId} | Error exporting actors:`, error);
            ui.notifications?.error("Failed to export actors. See console for details.");
        }
    }
}