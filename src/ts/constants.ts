import { id } from "../module.json";

export const moduleId = id;

// Store the rolls made during this session
export const recentRolls: any[] = [];
export const MAX_ROLLS_STORED = 20; // Store up to 20 recent rolls