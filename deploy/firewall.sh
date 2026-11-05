#!/usr/bin/env bash
# Only Cloudflare may reach the web ports, and Coolify's panel ports stay off the internet. Docker's
# published ports skip ufw, so the rules go in Docker's DOCKER-USER chain, matched on the original
# port. Without this, a visitor could reach the server directly, fake a country header and skip the
# US and sanctions block. Rules only match traffic arriving on the public interface, so SSH and the
# containers' own outgoing calls are unaffected. Runs at boot (goodbuild-firewall.service).
set -euo pipefail
PANEL_PORTS="8000 8080 6001 6002"
CACHE=/etc/goodbuild-cloudflare-ips
IFACE=$(ip route show default | awk '{print $5; exit}')

v4=$(curl -fsS -m 20 https://www.cloudflare.com/ips-v4 || true)
v6=$(curl -fsS -m 20 https://www.cloudflare.com/ips-v6 || true)
if [ -n "$v4" ] && [ -n "$v6" ]; then printf '%s\n--\n%s\n' "$v4" "$v6" > "$CACHE"; fi
[ -s "$CACHE" ] || { echo "No Cloudflare IP list, leaving rules alone." >&2; exit 1; }
v4=$(sed '/^--$/,$d' "$CACHE")
v6=$(sed '1,/^--$/d' "$CACHE")

apply() { # iptables command, Cloudflare ranges
  local ipt=$1 cidrs=$2 c p
  "$ipt" -N DOCKER-USER 2>/dev/null || true
  "$ipt" -F DOCKER-USER
  "$ipt" -A DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  for c in $cidrs; do
    for p in 80 443; do
      "$ipt" -A DOCKER-USER -i "$IFACE" -s "$c" -p tcp -m conntrack --ctorigdstport "$p" -j RETURN
    done
  done
  for p in 80 443 $PANEL_PORTS; do
    "$ipt" -A DOCKER-USER -i "$IFACE" -p tcp -m conntrack --ctorigdstport "$p" -j DROP
  done
  "$ipt" -A DOCKER-USER -j RETURN
}
apply iptables "$v4"
if ip6tables -L DOCKER-USER >/dev/null 2>&1; then apply ip6tables "$v6"; fi
