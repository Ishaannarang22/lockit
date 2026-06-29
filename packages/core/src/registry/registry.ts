export interface RegistryEntry {
  provider: string;
  fields: string[];
  env: Record<string, string[]>;
  match: string[];
}

export const builtinRegistry: RegistryEntry[] = [
  {
    provider: "openai",
    fields: ["OPENAI_API_KEY"],
    env: { OPENAI_API_KEY: ["OPENAI_API_KEY"] },
    match: ["OPENAI_API_KEY"],
  },
  {
    provider: "supabase",
    fields: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    env: {
      SUPABASE_URL: ["SUPABASE_URL"],
      SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY"],
      SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY"],
    },
    match: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    provider: "pulse",
    fields: ["API_KEY"],
    env: { API_KEY: ["PULSE_API_KEY"] },
    match: ["PULSE_API_KEY", "PULSE_KEY"],
  },
];

export function mergeRegistries(...lists: RegistryEntry[][]): RegistryEntry[] {
  const map = new Map<string, RegistryEntry>();
  for (const list of lists) {
    for (const entry of list) {
      map.set(entry.provider, entry);
    }
  }
  return Array.from(map.values());
}

export function entryFor(
  registry: RegistryEntry[],
  provider: string
): RegistryEntry | undefined {
  return registry.find((e) => e.provider === provider);
}

export function providerForEnv(
  registry: RegistryEntry[],
  envName: string
): string | undefined {
  return registry.find((e) => e.match.includes(envName))?.provider;
}
