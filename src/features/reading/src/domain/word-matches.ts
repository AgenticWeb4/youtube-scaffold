/** Match full English tokens in source text. No stemming and no model calls. */
export function wordMatches(text: string, terms: Map<string, string>) {
  return Array.from(text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)).flatMap(
    (match) => {
      const key = match[0].normalize("NFKC").replaceAll("’", "'").toLowerCase();
      const entryId = terms.get(key);
      return entryId
        ? [
            {
              start: match.index!,
              end: match.index! + match[0].length,
              entryId,
            },
          ]
        : [];
    },
  );
}
