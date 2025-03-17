export function parseFilterString(filterStr: string): Record<string, string> {
    if (!filterStr.includes(':')) {
      return { documentType: filterStr };
    }
    
    const filters: Record<string, string> = {};
    const parts = filterStr.split(',');
    
    for (const part of parts) {
      if (part.includes(':')) {
        const [key, value] = part.split(':');
        if (key && value) {
          filters[key.trim()] = value.trim();
        }
      }
    }
    
    return filters;
}

export function matchesAllFilters(result: any, filters: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      
      // Special handling for resultType (constructor name)
      if (key === "resultType") {
        const itemConstructorName = result.item?.constructor?.name;
        if (!itemConstructorName || itemConstructorName.toLowerCase() !== value.toLowerCase()) {
          return false;
        }
        continue;
      }
      
      // Special handling for package (compendium) paths
      if (key === "package" && result.item) {
        const packageValue = result.item.package;
        if (!packageValue) return false;
        
        // Check if the package matches or if it's a part of the full path
        if (packageValue.toLowerCase() !== value.toLowerCase() && 
            !(`Compendium.${packageValue}`.toLowerCase() === value.toLowerCase())) {
          return false;
        }
        continue;
      }
      
      // Special handling for folder references
      if (key === "folder" && result.item) {
        const folderValue = result.item.folder;
        
        // No folder when one is required
        if (!folderValue && value) return false;
        
        // Folder exists, check various formats:
        if (folderValue) {
          const folderIdMatch = typeof folderValue === 'object' ? folderValue.id : folderValue;
          
          // Accept any of these formats:
          // - Just the ID: "zmAZJmay9AxvRNqh"
          // - Full Folder UUID: "Folder.zmAZJmay9AxvRNqh"
          // - Object format with ID
          if (value === folderIdMatch || 
              value === `Folder.${folderIdMatch}` ||
              `Folder.${value}` === folderIdMatch) {
            continue; // Match found, continue to next filter
          }
          
          // If we get here, folder doesn't match
          return false;
        }
        
        continue;
      }
      
      // Standard property handling
      let propertyValue;
      if (!key.includes('.') && result.item && result.item[key] !== undefined) {
        propertyValue = result.item[key];
      } else {
        const parts = key.split('.');
        let current = result;
        
        for (const part of parts) {
          if (current === undefined || current === null) {
            propertyValue = undefined;
            break;
          }
          current = current[part];
        }
        
        propertyValue = current;
      }
      
      // If the property is missing or doesn't match, filter it out
      if (propertyValue === undefined || 
          (typeof propertyValue === 'string' &&
           propertyValue.toLowerCase() !== value.toLowerCase())) {
        return false;
      }
    }
    
    return true;
}