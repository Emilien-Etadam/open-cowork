import { shellEscapePosixPath } from './sandbox-workspace-path';

export function buildSandboxLanNetworkBashSetup(options: {
  proxyUrl: string;
  token: string;
}): string {
  const proxyUrl = shellEscapePosixPath(options.proxyUrl);
  const token = shellEscapePosixPath(options.token);

  return [
    `__lyg_sandbox_lan_proxy='${proxyUrl}'`,
    `__lyg_sandbox_proxy_token='${token}'`,
    '__lyg_extract_http_url() {',
    '  local arg',
    '  for arg in "$@"; do',
    '    case "$arg" in',
    '      http://*|https://*) printf "%s" "$arg"; return 0 ;;',
    '    esac',
    '  done',
    '  return 1',
    '}',
    '__lyg_host_from_url() {',
    '  local url="$1" host',
    '  host="${url#*://}"',
    '  host="${host%%/*}"',
    '  host="${host%%:*}"',
    '  host="${host#[}"',
    '  host="${host%]}"',
    '  printf "%s" "$host"',
    '}',
    '__lyg_host_is_lan() {',
    '  local host="$1"',
    '  case "$host" in',
    '    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|169.254.*) return 0 ;;',
    '    fe80:*|fc*|fd*) return 0 ;;',
    '    *) return 1 ;;',
    '  esac',
    '}',
    '__lyg_proxy_auth_header() {',
    '  printf "Proxy-Authorization: Bearer %s" "$__lyg_sandbox_proxy_token"',
    '}',
    'curl() {',
    '  local url host',
    '  url="$(__lyg_extract_http_url "$@")" || { command curl "$@"; return $?; }',
    '  host="$(__lyg_host_from_url "$url")"',
    '  if __lyg_host_is_lan "$host"; then',
    '    command curl --proxy "$__lyg_sandbox_lan_proxy" --proxy-header "$(__lyg_proxy_auth_header)" "$@"',
    '  else',
    '    command curl "$@"',
    '  fi',
    '}',
    'wget() {',
    '  local url host',
    '  url="$(__lyg_extract_http_url "$@")" || { command wget "$@"; return $?; }',
    '  host="$(__lyg_host_from_url "$url")"',
    '  if __lyg_host_is_lan "$host"; then',
    '    command wget --execute use_proxy=on --execute http_proxy="$__lyg_sandbox_lan_proxy" --header "$(__lyg_proxy_auth_header)" "$@"',
    '  else',
    '    command wget "$@"',
    '  fi',
    '}',
  ].join('\n');
}
