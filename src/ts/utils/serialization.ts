/**
 * Utility functions for data serialization
 */
import { ModuleLogger } from "./logger";

// Interface for collection-like objects in Foundry VTT
interface FoundryCollection<T> {
    size: number;
    contents: T[];
    entries(): IterableIterator<[string, T]>;

    // Other collection methods could be added here if needed
}

/**
 * Deep serialize an entity to ensure all properties are properly captured
 * @param entity The entity to serialize
 * @returns A fully serialized copy of the entity
 */
export function deepSerializeEntity(entity: any): any {
    if (!entity) return null;
    
    try {
        // Start with a standard serialization
        let serialized = entity.toObject ? entity.toObject(true) : JSON.parse(JSON.stringify(entity));

        // Some systems have getter properties that aren't properly serialized, especially in nested objects
        // Manually handle key system paths that are commonly used
        if (entity.system) {
            // Handle attributes - commonly used in systems like dnd5e
            if (entity.system.attributes) {
                for (const [attrKey, attrValue] of Object.entries(entity.system.attributes)) {
                    // Check if this attribute exists in serialized but is null when it shouldn't be
                    if (
                        serialized.system?.attributes?.[attrKey] === null && 
                        attrValue !== null
                    ) {
                        if (!serialized.system.attributes) serialized.system.attributes = {};
                        serialized.system.attributes[attrKey] = JSON.parse(JSON.stringify(attrValue));
                    }
                    
                    // Handle nested attributes (like hp, movement, etc)
                    if (typeof attrValue === 'object' && attrValue !== null) {
                        for (const [subKey, subValue] of Object.entries(attrValue)) {
                            if (
                                serialized.system?.attributes?.[attrKey]?.[subKey] === null && 
                                subValue !== null
                            ) {
                                if (!serialized.system.attributes[attrKey]) serialized.system.attributes[attrKey] = {};
                                serialized.system.attributes[attrKey][subKey] = JSON.parse(JSON.stringify(subValue));
                            }
                        }
                    }
                }
            }
            
            // Handle traits, senses, and other commonly used properties
            ['traits', 'abilities', 'skills', 'resources'].forEach(propKey => {
                if (entity.system[propKey]) {
                    for (const [key, value] of Object.entries(entity.system[propKey])) {
                        if (
                            serialized.system?.[propKey]?.[key] === null && 
                            value !== null
                        ) {
                            if (!serialized.system[propKey]) serialized.system[propKey] = {};
                            serialized.system[propKey][key] = JSON.parse(JSON.stringify(value));
                        }
                        
                        // Handle nested properties
                        if (typeof value === 'object' && value !== null) {
                            for (const [subKey, subValue] of Object.entries(value)) {
                                if (
                                    serialized.system?.[propKey]?.[key]?.[subKey] === null && 
                                    subValue !== null
                                ) {
                                    if (!serialized.system[propKey][key]) serialized.system[propKey][key] = {};
                                    serialized.system[propKey][key][subKey] = JSON.parse(JSON.stringify(subValue));
                                }
                            }
                        }
                    }
                }
            });
        }

        // Special handling for embedded collections 
        if (entity.items && entity.items.size > 0 && Array.isArray(serialized.items)) {
            // Ensure items are properly serialized
            try {
                // Type assertion to help TypeScript understand the collection structure
                const itemCollection = entity.items as FoundryCollection<any>;
                
                // Use contents array if available, as a safer alternative to entries()
                if (Array.isArray(itemCollection.contents)) {
                    for (let i = 0; i < itemCollection.contents.length; i++) {
                        if (i < serialized.items.length) {
                            // Deep serialize each item
                            serialized.items[i] = deepSerializeEntity(itemCollection.contents[i]);
                        }
                    }
                } 
                // Fallback to entries() if needed
                else if (typeof itemCollection.entries === 'function') {
                    const itemEntries = Array.from(itemCollection.entries());
                    for (let i = 0; i < itemEntries.length; i++) {
                        const [_, item] = itemEntries[i];
                        if (i < serialized.items.length) {
                            serialized.items[i] = deepSerializeEntity(item);
                        }
                    }
                }
            } catch (err) {
                ModuleLogger.warn('Failed to process entity.items collection:', err);
            }
        }
        
        // Handle effects collection
        if (entity.effects && entity.effects.size > 0 && Array.isArray(serialized.effects)) {
            try {
                // Type assertion to help TypeScript understand the collection structure
                const effectCollection = entity.effects as FoundryCollection<any>;
                
                // Use contents array if available, as a safer alternative to entries()
                if (Array.isArray(effectCollection.contents)) {
                    for (let i = 0; i < effectCollection.contents.length; i++) {
                        if (i < serialized.effects.length) {
                            // Deep serialize each effect
                            serialized.effects[i] = deepSerializeEntity(effectCollection.contents[i]);
                        }
                    }
                }
                // Fallback to entries() if needed
                else if (typeof effectCollection.entries === 'function') {
                    const effectEntries = Array.from(effectCollection.entries());
                    for (let i = 0; i < effectEntries.length; i++) {
                        const [_, effect] = effectEntries[i];
                        if (i < serialized.effects.length) {
                            serialized.effects[i] = deepSerializeEntity(effect);
                        }
                    }
                }
            } catch (err) {
                ModuleLogger.warn('Failed to process entity.effects collection:', err);
            }
        }
        
        return serialized;
    } catch (error) {
        ModuleLogger.error(`Error deep serializing entity:`, error);
        // Fallback to basic serialization in case of errors
        return entity.toObject ? entity.toObject() : entity;
    }
}