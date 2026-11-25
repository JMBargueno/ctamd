# ctamd — Andalusia Metropolitan Transport Consortia CLI

Fast CLI and TypeScript library for all **9 Andalusian Metropolitan Transport Consortia** (**Red de Consorcios de Transporte de Andalucía — CTAN**), modeled after [`JMBargueno/tussam-cli`](https://github.com/JMBargueno/tussam-cli).

Query interurban bus, metro, tram, suburban rail, and maritime catamaran timetables, zone jumps and fares, upcoming stop departures, nearby stops by GPS, service alerts, and card recharge points directly from your terminal.

## Covered Consortia

| ID  | Code    | Web        | Area               |
| :-: | :------ | :--------- | :----------------- |
| `1` | `CTAS`  | `ctas.es`  | Área de Sevilla    |
| `2` | `CMTBC` | `cmtbc.es` | Bahía de Cádiz     |
| `3` | `CTMGR` | `ctagr.es` | Área de Granada    |
| `4` | `CTMAM` | `ctmam.es` | Área de Málaga     |
| `5` | `CTMCG` | `ctmcg.es` | Campo de Gibraltar |
| `6` | `CTAL`  | `ctal.es`  | Área de Almería    |
| `7` | `CTJA`  | `ctja.es`  | Área de Jaén       |
| `8` | `CTCO`  | `ctco.es`  | Área de Córdoba    |
| `9` | `CTHU`  | `cthu.es`  | Costa de Huelva    |

## Features

- **All 9 Consortia in One CLI**: Target any consortium with `-c <id|code|domain|city>` (e.g. `-c sevilla`, `-c ctagr.es`, `-c ctmam.es`, `-c cadiz`), save a default with `ctamd use <area>`, or set `CTAMD_CONSORCIO`.
- **Dual Timetable Routing (`-f` / `-t`)**:
  - **Town / Núcleo ↔ Town / Núcleo** (single-call official CTAN origin-destination timetable + automatic zone jump & fare calculation).
  - **Stop ↔ Stop** (`--by stop` multi-transfer routing up to 3 transfers, opposite-sidewalk access walks `--origin-walk` / `--dest-walk`, and instant offline topology estimates via `--estimate`).
- **Cross-Consortium Calendar Matching**: Handles Sevilla (`LV`, `SA`, `DF`), Granada 8-char bitmasks (`LMXJV---`, `-----S--`), Málaga custom frequency codes (`slab`, `df`, `diari`), and all remaining provincial conventions, plus `--holiday` and `--freq <code|all>`.
- **Upcoming Stop Departures (`stop`)**: Official CTAN departure windows with countdown (`Now`, `6 min`), `--hours <n>` multi-window aggregation, `--watch` auto-refresh, and `--schedule` for full-day passing times, backed by an extensible `ArrivalProviderRegistry` for future SAE/GPS adapters.
- **GPS Auto-Detection (`nearby`)**: Automatically detects the nearest Andalusian consortium(s) from coordinates (`ctamd nearby 37.177 -3.598`), or searches all 9 with `--all-areas`.
- **Fares, Towns, Recharge Points & Alerts**: `fares` (with jump calculator), `towns`, `points` (recharge/sales locations), and `alerts` (`--all-areas` supported).
- **Saved Favorites (`fav`)**, **Interactive Guided Search (`-i`)**, **Shell Completions (`completion`)**, and **Importable ESM TypeScript Library (`dist/index.d.ts`)**.

---

## Installation

Requires **Node.js 22+**.

```bash
pnpm install -g ctamd
# or using npm:
npm install -g ctamd
```

Or run directly from source:

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

---

## Usage (CLI)

```bash
# List all 9 consortia and optionally set your default
ctamd consortiums
ctamd use sevilla              # or ctagr.es, ctmam.es, 1..9

# Town-to-town timetables with zone jumps & fares
ctamd -c sevilla -f sevilla -t "mairena del aljarafe"
ctamd -c granada -f granada -t armilla -d 28 -m 11 -y 2026 -s
ctamd -c malaga -f malaga -t torremolinos --after 09:00 --all

# Stop-to-stop routing & offline topology estimates
ctamd -c sevilla -f "plaza de armas" -t "ciudad expo" --by stop
ctamd -c sevilla -f 3023 -t 3287 --by stop --estimate

# Upcoming departures at a stop & watch mode
ctamd -c sevilla stop "plaza de armas"
ctamd -c sevilla stop 3023 --hours 2 -l M-175
ctamd -c sevilla stop 3023 --watch 30
ctamd -c sevilla stop 3023 --schedule

# Lines, route stops, towns, fares, nearby stops, points & alerts
ctamd -c cadiz lines --mode barco
ctamd -c sevilla line M-101A --schedule
ctamd -c granada towns armilla
ctamd -c sevilla fares sevilla "mairena del aljarafe"
ctamd -c malaga points torremolinos --limit 10
ctamd nearby 37.177 -3.598 -r 800 --arrivals
ctamd alerts --all-areas

# Multi-consortium favorites, interactive search & completions
ctamd fav add casa 3023 -c sevilla
ctamd fav add armilla armilla -c granada --nucleo
ctamd -i
ctamd completion powershell | Out-String | Invoke-Expression
```

### Caching & Configuration

Consortium catalogs (7 days), network topologies (7 days), OD/line schedules (24 hours), stop services (60 s fresh, 10 min stale fallback), and sales points (7 days) are stored partitioned by consortium in your OS cache directory.

- Override cache directory with `CTAMD_CACHE_DIR`.
- Override config directory with `CTAMD_CONFIG_DIR`.
- Override default consortium with `CTAMD_CONSORCIO`.
- Set `NO_COLOR=1` to disable ANSI colors.

```bash
ctamd cache status
ctamd cache sync -c sevilla
ctamd cache clear
```

---

## Usage (Library)

```ts
import { ArrivalProviderRegistry, Ctamd, CtanClient } from 'ctamd';

const ctamd = new Ctamd();

const schedule = await ctamd.findOdSchedules('ctas.es', '3225', '3196', {
  date: new Date(),
  sortByDuration: true,
});
console.log(schedule.fare, schedule.journeys.slice(0, 5));

const nearby = await ctamd.getNearbyStops(37.1773, -3.5986, { radius: 600 });
console.log(nearby);
```

Custom real-time SAE adapters can be plugged into `ArrivalProviderRegistry` without changing any CLI or consumer code:

```ts
const client = new CtanClient();
const registry = new ArrivalProviderRegistry(client, [myRealtimeSaeProvider]);
const ctamd = new Ctamd({ client, providerRegistry: registry });
```

---

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```
