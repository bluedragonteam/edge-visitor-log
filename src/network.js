/**
 * Is a visitor's IP a VPN, a proxy, a data centre or a privacy relay rather than a home or office connection?
 * Decided from the network Cloudflare reports for the IP (its ASN and owner name) - no third-party lookup, so
 * visitors' IPs aren't sent anywhere. Tor exits are checked separately against the Tor Project's list.
 *
 * It's a strong hint, not proof: a VPN that rents home IPs ("residential proxies") looks like a normal visitor,
 * and a developer may browse from a cloud machine without hiding anything.
 */

export const NETWORK_KINDS = {
  tor: { label: 'Tor', hint: 'A Tor exit node - the visitor hides their real IP on purpose.' },
  vpn: { label: 'VPN', hint: 'A commercial VPN provider\'s network - the real location and network are hidden.' },
  relay: { label: 'Privacy relay', hint: 'iCloud Private Relay, Cloudflare WARP or a similar relay - the real IP is hidden, but this is usually an ordinary person on an iPhone, Mac or with WARP on.' },
  hosting: { label: 'Data centre', hint: 'A cloud or hosting network (servers, not homes or offices): a VPN or proxy, a bot, or someone working on a cloud machine.' }
};

// Networks of VPN companies (or the server companies they mostly run on)
const VPN_ASNS = new Map([
  [9009, 'M247'], [136787, 'NordVPN (Tefincom)'], [212238, 'Datacamp (CDN77)'], [60068, 'Datacamp (CDN77)'],
  [39351, 'Mullvad (31173 Services)'], [209103, 'Proton VPN'], [62371, 'Proton'], [147049, 'PacketHub'],
  [207137, 'PacketHub'], [206092, 'IPXO'], [49453, 'Global Layer'], [62240, 'Clouvider'], [9312, 'xTom']
]);

const VPN_NAMES = /\b(nordvpn|tefincom|mullvad|31173 services|proton ?(vpn|ag)|expressvpn|express technologies|surfshark|private internet access|kape technologies|ipvanish|windscribe|cyberghost|hide\.me|purevpn|torguard|vyprvpn|golden frog|hotspot shield|pango|tunnelbear|airvpn|ivpn|astrill|privado|zenmate|perfect privacy|m247|datacamp|packethub|clouvider|ipxo|global layer|tzulo|hostroyale|creanova)\b/i;

// Relays that hide the IP of ordinary users (Apple's iCloud Private Relay runs on these; so does Cloudflare WARP)
const RELAY_ASNS = new Map([
  [13335, 'Cloudflare (WARP / iCloud Private Relay)'], [209242, 'Cloudflare (WARP)'],
  [36183, 'Akamai (iCloud Private Relay)'], [20940, 'Akamai'], [16625, 'Akamai'], [54113, 'Fastly (iCloud Private Relay)']
]);

const RELAY_NAMES = /\b(cloudflare|akamai|fastly)\b/i;

// Cloud and hosting networks: servers, not homes or offices
const HOSTING_ASNS = new Map([
  [16509, 'Amazon AWS'], [14618, 'Amazon AWS'], [8987, 'Amazon AWS'], [15169, 'Google'], [396982, 'Google Cloud'],
  [8075, 'Microsoft Azure'], [14061, 'DigitalOcean'], [63949, 'Linode / Akamai Cloud'], [16276, 'OVH'], [24940, 'Hetzner'],
  [213230, 'Hetzner'], [20473, 'Vultr'], [51167, 'Contabo'], [60781, 'Leaseweb'], [28753, 'Leaseweb'], [31898, 'Oracle Cloud'],
  [45102, 'Alibaba Cloud'], [132203, 'Tencent Cloud'], [12876, 'Scaleway'], [36352, 'ColoCrossing'], [8100, 'QuadraNet'],
  [46606, 'Unified Layer'], [26496, 'GoDaddy'], [22612, 'Namecheap'], [197540, 'netcup'], [47583, 'Hostinger'],
  [21859, 'Zenlayer'], [40021, 'Contabo US'], [399629, 'BL Networks'], [35916, 'Multacom'],
  [53667, 'FranTech / BuyVM'], [202425, 'IP Volume'], [44477, 'Stark Industries'], [210644, 'Aeza'],
  // Dedicated-server and VPS companies that VPNs (Astrill, ExpressVPN, Surfshark...) rent their servers from.
  // A VPN on rented servers shows up under the server company's name, never its own. Owners checked in RDAP.
  [46475, 'Limestone Networks'], [32097, 'WholeSale Internet'], [19318, 'Interserver'], [29802, 'Hivelocity'],
  [40676, 'Psychz Networks'], [46844, 'Sharktech'], [11878, 'tzulo'], [30633, 'Leaseweb USA'], [59253, 'Leaseweb Asia'],
  [32244, 'Liquid Web'], [27357, 'Rackspace'], [19994, 'Rackspace'], [36351, 'IBM Cloud (SoftLayer)'], [23033, 'Wowrack'],
  [25820, 'IT7 Networks'], [54290, 'Hostwinds'], [55286, 'ServerMania'], [9370, 'Sakura Internet'], [4694, 'IDC Frontier'],
  [37963, 'Alibaba Cloud'], [136907, 'Huawei Cloud'], [135377, 'UCloud'], [50673, 'Serverius'], [49981, 'WorldStream'],
  [43350, 'NForce'], [25369, 'Hydra Communications'], [199524, 'G-Core Labs'], [202422, 'G-Core Labs'], [3223, 'Voxility'],
  [3842, 'RamNode'], [62567, 'DigitalOcean'], [8560, 'IONOS'], [26347, 'DreamHost'], [33182, 'HostDime'],
  [36114, 'Versaweb'], [46261, 'QuickPacket'], [23470, 'ReliableSite'], [14956, 'RouterHosting (Cloudzy)'],
  [53755, 'IOFlood'], [30058, 'FDCservers'], [20860, 'iomart'], [197695, 'REG.RU'], [9123, 'Timeweb'], [49505, 'Selectel'],
  [200019, 'AlexHost'], [57523, 'Chang Way'], [51852, 'Private Layer'], [35913, 'DediPath'], [7979, 'Servers.com'],
  [3214, 'xTom'], [36007, 'Kamatera'], [202053, 'UpCloud'], [18779, 'EGIHosting'], [7489, 'HostUS'], [62904, 'Eonix'],
  [64267, 'Sprious']
]);

const HOSTING_NAMES = /\b(amazon|aws|google (cloud|llc)|microsoft|azure|digitalocean|linode|ovh|hetzner|vultr|choopa|the constant company|contabo|leaseweb|oracle|alibaba|tencent|scaleway|online s\.?a\.?s|colocrossing|quadranet|hosting|hostinger|host ?europe|server|datacenter|data center|data centre|cloud|vps|dedicated|colo(cation)?|ionos|1&1|godaddy|namecheap|netcup|zenlayer|frantech|buyvm|stark industries|aeza|ip volume|gthost|psychz|sharktech|tzulo|hivelocity|liquid ?web|rackspace|equinix|cdn77|bunny|kamatera|upcloud|time4vps|serverius|worldstream|nforce|hydra communications|limestone networks|wholesale internet|interserver|softlayer|wowrack|it7 networks|hostwinds|hostpapa|servermania|b2 net solutions|sakura internet|idc frontier|ucloud|g-?core|voxility|ramnode|inmotion|dreamhost|new dream network|hostdime|versaweb|vegasnap|quickpacket|reliablesite|routerhosting|cloudzy|input output flood|ioflood|fdcservers|iomart|timeweb|selectel|alexhost|chang way|private layer|dedipath|servers\.com|egihosting|hostus|eonix|sprious)\b/i;

const asNumber = (asn) => {
  const number = typeof asn === 'number' ? asn : parseInt(String(asn || '').replace(/^AS/i, ''), 10);
  return Number.isInteger(number) ? number : null;
};

/**
 * Is the IP in a data centre (VPN, proxy, Tor, privacy relay, cloud or hosting) or on a residential line
 * (a home, office or mobile network)? Every kind classifyNetwork detects is a data-centre IP. A privacy relay
 * usually hides an ordinary person, but the IP itself is still the relay's server.
 * "Residential" means "not a known data-centre network": a VPN that rents home IPs still looks residential.
 * @returns {{ type: 'datacenter'|'residential', label: string, network: object|null }}
 */
export const connectionType = (network = {}, options = {}) => {
  const classified = classifyNetwork(network, options);
  return classified
    ? { type: 'datacenter', label: 'Data centre', network: classified }
    : { type: 'residential', label: 'Residential', network: null };
};

/**
 * @param {{ org?: string, asn?: number|string, ip?: string }} network
 * @param {{ isTorExit?: (ip: string) => boolean }} [options]
 * @returns {{ kind: 'tor'|'vpn'|'relay'|'hosting', label: string, provider: string|null, hint: string } | null}
 *   null = looks like an ordinary home, office or mobile connection
 */
export const classifyNetwork = ({ org, asn, ip } = {}, { isTorExit } = {}) => {
  const result = (kind, provider) => ({ kind, label: NETWORK_KINDS[kind].label, provider: provider || org || null, hint: NETWORK_KINDS[kind].hint });
  if (ip && isTorExit?.(ip)) return result('tor', 'Tor');
  const number = asNumber(asn);
  const name = String(org || '');
  if (VPN_ASNS.has(number)) return result('vpn', VPN_ASNS.get(number));
  if (VPN_NAMES.test(name)) return result('vpn');
  if (RELAY_ASNS.has(number)) return result('relay', RELAY_ASNS.get(number));
  if (RELAY_NAMES.test(name)) return result('relay');
  if (HOSTING_ASNS.has(number)) return result('hosting', HOSTING_ASNS.get(number));
  if (HOSTING_NAMES.test(name)) return result('hosting');
  return null;
};
