import { CtamdValidationError } from '../api/errors.js';

export const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish', 'powershell'] as const;
export type CompletionShell = (typeof SUPPORTED_SHELLS)[number];

const SUBCOMMANDS = [
  'consortiums',
  'use',
  'stop',
  'lines',
  'line',
  'towns',
  'fares',
  'nearby',
  'points',
  'alerts',
  'cache',
  'fav',
  'interactive',
  'completion',
];

const CONSORTIUM_SLUGS = [
  'sevilla',
  'cadiz',
  'granada',
  'malaga',
  'gibraltar',
  'almeria',
  'jaen',
  'cordoba',
  'huelva',
  'ctas.es',
  'cmtbc.es',
  'ctagr.es',
  'ctmam.es',
  'ctmcg.es',
  'ctal.es',
  'ctja.es',
  'ctco.es',
  'cthu.es',
];

const ROOT_FLAGS = [
  '-V',
  '--version',
  '-c',
  '--consorcio',
  '-f',
  '--from',
  '-t',
  '--to',
  '--by',
  '-d',
  '--day',
  '-m',
  '--month',
  '-y',
  '--year',
  '-s',
  '--sort',
  '--after',
  '--limit',
  '--all',
  '--holiday',
  '--freq',
  '--max-transfers',
  '--walk',
  '--origin-walk',
  '--dest-walk',
  '--live',
  '--refresh',
  '--estimate',
  '--lang',
  '-i',
  '--interactive',
  '--json',
  '-h',
  '--help',
];

function buildBashCompletion(): string {
  return `# bash completion for ctamd
_ctamd_completions() {
  local cur prev subcmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  subcmd=""

  if [[ "\${prev}" == "-c" || "\${prev}" == "--consorcio" ]]; then
    COMPREPLY=( $(compgen -W "${CONSORTIUM_SLUGS.join(' ')}" -- "\${cur}") )
    return 0
  fi

  if [[ \${COMP_CWORD} -ge 2 ]]; then
    subcmd="\${COMP_WORDS[1]}"
  fi

  case "\${subcmd}" in
    use)
      COMPREPLY=( $(compgen -W "${CONSORTIUM_SLUGS.join(' ')} --clear --json -h --help" -- "\${cur}") )
      return 0
      ;;
    consortiums|areas)
      COMPREPLY=( $(compgen -W "--json -h --help" -- "\${cur}") )
      return 0
      ;;
    stop)
      COMPREPLY=( $(compgen -W "-c --consorcio -l --line -w --watch --hours --schedule -d --day -m --month -y --year --no-cache --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    lines)
      COMPREPLY=( $(compgen -W "-c --consorcio --mode --town --search --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    line)
      COMPREPLY=( $(compgen -W "-c --consorcio --direction --schedule -d --day -m --month -y --year --holiday --freq --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    towns|nucleos|municipios)
      COMPREPLY=( $(compgen -W "-c --consorcio --limit --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    fares|tarifas)
      COMPREPLY=( $(compgen -W "-c --consorcio --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    nearby)
      COMPREPLY=( $(compgen -W "-c --consorcio --all-areas -r --radius -n --limit --arrivals --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    points|recharge|puntos-venta)
      COMPREPLY=( $(compgen -W "-c --consorcio --town --near -r --radius -n --limit --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    alerts|news|noticias)
      COMPREPLY=( $(compgen -W "-c --consorcio --all-areas -l --line --category --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    cache)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "status sync clear" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "-c --consorcio --catalog-only --details --lang --json -h --help" -- "\${cur}") )
      fi
      return 0
      ;;
    fav)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "add rm remove list ls" -- "\${cur}") )
      else
        COMPREPLY=( $(compgen -W "-c --consorcio --nucleo --json -h --help" -- "\${cur}") )
      fi
      return 0
      ;;
    interactive)
      COMPREPLY=( $(compgen -W "-c --consorcio --max-transfers --walk --origin-walk --dest-walk --estimate --live --lang --json -h --help" -- "\${cur}") )
      return 0
      ;;
    completion|completions)
      if [[ \${COMP_CWORD} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\${cur}") )
      fi
      return 0
      ;;
  esac

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "${ROOT_FLAGS.join(' ')}" -- "\${cur}") )
    return 0
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${SUBCOMMANDS.join(' ')} ${ROOT_FLAGS.join(' ')}" -- "\${cur}") )
  fi
}

complete -F _ctamd_completions ctamd
`;
}

function buildZshCompletion(): string {
  return `#compdef ctamd

_ctamd() {
  local -a commands
  commands=(
    'consortiums:List all 9 Andalusian metropolitan transport consortia'
    'use:Set default consortium for commands'
    'stop:Show upcoming departures or day schedule for a stop'
    'lines:List lines in a consortium'
    'line:Show ordered stops and timetables for a line'
    'towns:List or search towns/núcleos and tariff zones'
    'fares:Show fares and calculate zone jumps between two towns'
    'nearby:Find stops near GPS coordinates (auto-detects consortium)'
    'points:Find card sales and recharge points'
    'alerts:Show active service notices and incidents'
    'cache:Inspect, sync, or clear the local cache'
    'fav:Manage saved favorite stops or towns'
    'interactive:Launch interactive step-by-step route search'
    'completion:Generate shell completion script'
  )

  _arguments -C \\
    '(-V --version)'{-V,--version}'[Print version information]' \\
    '(-c --consorcio)'{-c,--consorcio}'[Target consortium (id, code, domain, or city)]:area:(${CONSORTIUM_SLUGS.join(' ')})' \\
    '(-f --from)'{-f,--from}'[Set origin town/stop/favorite]:origin:' \\
    '(-t --to)'{-t,--to}'[Set destination town/stop/favorite]:destination:' \\
    '--by[Routing mode]:mode:(auto nucleo stop)' \\
    '(-d --day)'{-d,--day}'[Set the day]:day:' \\
    '(-m --month)'{-m,--month}'[Set the month]:month:' \\
    '(-y --year)'{-y,--year}'[Set the year]:year:' \\
    '(-s --sort)'{-s,--sort}'[Sort timetable by duration]' \\
    '--after[Show departures at or after HH:MM]:time:' \\
    '--limit[Maximum journeys to display]:limit:' \\
    '--all[Show all journeys for the full day]' \\
    '--holiday[Evaluate public holiday schedules]' \\
    '--freq[Filter frequency acronym or all]:freq:' \\
    '--max-transfers[Maximum transfers (0-3)]:transfers:' \\
    '--walk[Maximum transfer walking distance in meters]:meters:' \\
    '--origin-walk[Maximum origin walking distance in meters]:meters:' \\
    '--dest-walk[Maximum destination walking distance in meters]:meters:' \\
    '--live[Display live/upcoming departures at origin stop]' \\
    '--refresh[Force refresh of cached data]' \\
    '--estimate[Offline topology-based route estimates]' \\
    '--lang[API response language]:lang:(es en)' \\
    '(-i --interactive)'{-i,--interactive}'[Launch interactive route search]' \\
    '--json[Output machine-readable JSON]' \\
    '(-h --help)'{-h,--help}'[Display help]' \\
    '1: :->cmds' \\
    '*::arg:->args'

  case "$state" in
    cmds)
      _describe 'command' commands
      ;;
    args)
      case "$line[1]" in
        use)
          _values 'consortium' ${CONSORTIUM_SLUGS.join(' ')}
          ;;
        cache)
          _values 'cache action' status sync clear
          ;;
        fav)
          _values 'fav action' add rm remove list ls
          ;;
        completion|completions)
          _values 'shell' bash zsh fish powershell
          ;;
      esac
      ;;
  esac
}

compdef _ctamd ctamd
`;
}

function buildFishCompletion(): string {
  return `# fish completion for ctamd
complete -c ctamd -f

# Subcommands
complete -c ctamd -n '__fish_use_subcommand' -a consortiums -d 'List all 9 Andalusian consortia'
complete -c ctamd -n '__fish_use_subcommand' -a use -d 'Set default consortium'
complete -c ctamd -n '__fish_use_subcommand' -a stop -d 'Show upcoming departures or schedule for a stop'
complete -c ctamd -n '__fish_use_subcommand' -a lines -d 'List consortium lines'
complete -c ctamd -n '__fish_use_subcommand' -a line -d 'Show ordered stops and schedule for a line'
complete -c ctamd -n '__fish_use_subcommand' -a towns -d 'List or search towns/núcleos and zones'
complete -c ctamd -n '__fish_use_subcommand' -a fares -d 'Show fares and calculate jumps'
complete -c ctamd -n '__fish_use_subcommand' -a nearby -d 'Find stops near GPS coordinates'
complete -c ctamd -n '__fish_use_subcommand' -a points -d 'Find sales and recharge points'
complete -c ctamd -n '__fish_use_subcommand' -a alerts -d 'Show active service notices'
complete -c ctamd -n '__fish_use_subcommand' -a cache -d 'Manage local cache'
complete -c ctamd -n '__fish_use_subcommand' -a fav -d 'Manage favorite stops or towns'
complete -c ctamd -n '__fish_use_subcommand' -a interactive -d 'Launch interactive route search'
complete -c ctamd -n '__fish_use_subcommand' -a completion -d 'Generate shell completions'

# Root options
complete -c ctamd -n '__fish_use_subcommand' -s V -l version -d 'Print version information'
complete -c ctamd -n '__fish_use_subcommand' -s c -l consorcio -r -a '${CONSORTIUM_SLUGS.join(' ')}' -d 'Consortium'
complete -c ctamd -n '__fish_use_subcommand' -s f -l from -r -d 'Set origin'
complete -c ctamd -n '__fish_use_subcommand' -s t -l to -r -d 'Set destination'
complete -c ctamd -n '__fish_use_subcommand' -l by -r -a 'auto nucleo stop' -d 'Routing mode'
complete -c ctamd -n '__fish_use_subcommand' -s d -l day -r -d 'Set the day'
complete -c ctamd -n '__fish_use_subcommand' -s m -l month -r -d 'Set the month'
complete -c ctamd -n '__fish_use_subcommand' -s y -l year -r -d 'Set the year'
complete -c ctamd -n '__fish_use_subcommand' -s s -l sort -d 'Sort timetable by duration'
complete -c ctamd -n '__fish_use_subcommand' -l after -r -d 'Depart after HH:MM'
complete -c ctamd -n '__fish_use_subcommand' -l limit -r -d 'Max journeys'
complete -c ctamd -n '__fish_use_subcommand' -l all -d 'Show all journeys'
complete -c ctamd -n '__fish_use_subcommand' -l holiday -d 'Holiday schedule'
complete -c ctamd -n '__fish_use_subcommand' -l freq -r -d 'Filter frequency'
complete -c ctamd -n '__fish_use_subcommand' -l estimate -d 'Offline topology estimates'
complete -c ctamd -n '__fish_use_subcommand' -l lang -r -a 'es en' -d 'API language'
complete -c ctamd -n '__fish_use_subcommand' -s i -l interactive -d 'Interactive search'
complete -c ctamd -n '__fish_use_subcommand' -l json -d 'Output JSON'

# Subcommand arguments
complete -c ctamd -n '__fish_seen_subcommand_from use' -a '${CONSORTIUM_SLUGS.join(' ')}'
complete -c ctamd -n '__fish_seen_subcommand_from cache' -a 'status sync clear'
complete -c ctamd -n '__fish_seen_subcommand_from fav' -a 'add rm remove list ls'
complete -c ctamd -n '__fish_seen_subcommand_from completion completions' -a 'bash zsh fish powershell'
complete -c ctamd -n '__fish_seen_subcommand_from line' -l direction -r -a '1 2 both'
`;
}

function buildPowerShellCompletion(): string {
  return `# PowerShell completion for ctamd
Register-ArgumentCompleter -Native -CommandName 'ctamd' -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $tokens = $commandAst.CommandElements | ForEach-Object { $_.Extent.Text }
  $subcommands = @(${SUBCOMMANDS.map((s) => `'${s}'`).join(', ')})
  $consortiums = @(${CONSORTIUM_SLUGS.map((s) => `'${s}'`).join(', ')})
  $rootFlags = @(${ROOT_FLAGS.map((f) => `'${f}'`).join(', ')})

  $prev = if ($tokens.Count -ge 2) { $tokens[$tokens.Count - 2] } else { '' }
  if ($prev -eq '-c' -or $prev -eq '--consorcio') {
    $candidates = $consortiums
  } else {
    $subcmd = if ($tokens.Count -ge 2) { $tokens[1] } else { '' }
    $candidates = switch ($subcmd) {
      'use' { $consortiums + @('--clear', '--json', '-h', '--help') }
      'consortiums' { @('--json', '-h', '--help') }
      'cache' { @('status', 'sync', 'clear', '-c', '--consorcio', '--catalog-only', '--details', '--lang', '--json', '-h', '--help') }
      'fav' { @('add', 'rm', 'remove', 'list', 'ls', '-c', '--consorcio', '--nucleo', '--json', '-h', '--help') }
      'completion' { @('bash', 'zsh', 'fish', 'powershell', '-h', '--help') }
      'completions' { @('bash', 'zsh', 'fish', 'powershell', '-h', '--help') }
      'stop' { @('-c', '--consorcio', '-l', '--line', '-w', '--watch', '--hours', '--schedule', '-d', '--day', '-m', '--month', '-y', '--year', '--no-cache', '--lang', '--json', '-h', '--help') }
      'lines' { @('-c', '--consorcio', '--mode', '--town', '--search', '--lang', '--json', '-h', '--help') }
      'line' { @('-c', '--consorcio', '--direction', '--schedule', '-d', '--day', '-m', '--month', '-y', '--year', '--holiday', '--freq', '--lang', '--json', '-h', '--help') }
      'towns' { @('-c', '--consorcio', '--limit', '--lang', '--json', '-h', '--help') }
      'fares' { @('-c', '--consorcio', '--lang', '--json', '-h', '--help') }
      'nearby' { @('-c', '--consorcio', '--all-areas', '-r', '--radius', '-n', '--limit', '--arrivals', '--lang', '--json', '-h', '--help') }
      'points' { @('-c', '--consorcio', '--town', '--near', '-r', '--radius', '-n', '--limit', '--lang', '--json', '-h', '--help') }
      'alerts' { @('-c', '--consorcio', '--all-areas', '-l', '--line', '--category', '--lang', '--json', '-h', '--help') }
      'interactive' { @('-c', '--consorcio', '--max-transfers', '--walk', '--origin-walk', '--dest-walk', '--estimate', '--live', '--lang', '--json', '-h', '--help') }
      default { $subcommands + $rootFlags }
    }
  }

  $candidates |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
}

/**
 * Generates a self-contained shell completion script for bash, zsh, fish, or PowerShell.
 */
export function generateCompletionScript(shell: string): string {
  const normalized = shell.trim().toLowerCase();
  switch (normalized) {
    case 'bash':
      return buildBashCompletion();
    case 'zsh':
      return buildZshCompletion();
    case 'fish':
      return buildFishCompletion();
    case 'powershell':
      return buildPowerShellCompletion();
    default:
      throw new CtamdValidationError(
        `Unsupported shell '${shell}'. Expected one of: ${SUPPORTED_SHELLS.join(', ')}.`,
      );
  }
}
