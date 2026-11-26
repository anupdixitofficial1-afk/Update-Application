import { supabaseAdapter } from './supabaseAdapter';
import { BackendProvider } from './types';

export const backend: BackendProvider = supabaseAdapter;

export * from './types';