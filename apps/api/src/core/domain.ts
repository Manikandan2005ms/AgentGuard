/** "https://www.FreshCart.example/shop?x=1" -> "freshcart.example" */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "");
  d = d.split(/[/?#]/)[0] ?? d;
  d = d.replace(/:\d+$/, "");
  d = d.replace(/^www\./, "");
  return d;
}

/** True when `domain` equals `entry` or is a subdomain of it. */
export function domainMatches(domain: string, entry: string): boolean {
  const d = normalizeDomain(domain);
  const e = normalizeDomain(entry);
  return d === e || d.endsWith(`.${e}`);
}
