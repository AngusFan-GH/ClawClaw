/** Allow plaintext MCP for loopback and RFC 1918 IPv4 hosts from URL.hostname. */
export function allowsMcpHttp(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false
  const octets = hostname.split('.').map(Number)
  if (octets.some(octet => octet > 255)) return false
  const [first, second] = octets
  return first === 127 || first === 10
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}
