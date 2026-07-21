import { SSHHost } from "./types";

export function splitHostSearchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function hostMatchesSearch(
  host: SSHHost,
  groupName: string | undefined,
  terms: readonly string[]
): boolean {
  if (terms.length === 0) {return true;}

  const haystack = [
    host.name,
    host.hostname,
    host.username,
    String(host.port),
    groupName ?? "",
    ...(host.tags ?? []),
  ].join("\n").toLocaleLowerCase();

  return terms.every((term) => haystack.includes(term));
}
