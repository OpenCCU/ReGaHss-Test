# ReGaHss Testing Environment
[![CI](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

This repository performs automated daily system tests of `ReGaHss` - the HomeMatic CCU "Logic Layer" engine. It uses a [mocha](https://github.com/mochajs/mocha)-based node.js testing framework to test the `ReGaHss` binaries published in [OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base), the component base layer of [OpenCCU](https://github.com/OpenCCU/OpenCCU). Beside testing common corner cases of the embedded scripting language of ReGaHss, this testing framework also tests program/timer execution (including DST and leap year boundaries via [libfaketime](https://github.com/wolfcw/libfaketime)), the XML-RPC interface and checks for known security vulnerabilities.

## How it works

* The required parts of an OpenCCU-Base revision (`bin/<arch>/ReGaHss`, `lib/<arch>/libXmlRpc.so`, `lib/<arch>/libxmlparser.so`, `www/` and the CMake build system plus library sources) are fetched via a shallow sparse checkout (`scripts/fetch-openccu-base.sh`).
* ReGaHss is either run with the prebuilt `libXmlRpc`/`libxmlparser` of OpenCCU-Base or with these libraries rebuilt from the OpenCCU-Base sources (`scripts/build-libs.sh`), optionally instrumented with AddressSanitizer/UndefinedBehaviorSanitizer and gcov coverage.
* ReGaHss and its runtime environment (`rega.conf`, `InterfacesList.xml`, the prebuilt test `homematic.regadom`, dummy hook scripts) are installed into a disposable docker image (`scripts/install-regahss.sh`).
* Each test file (`test/*.js`) starts its own ReGaHss process (optionally together with the [hm-simulator](https://github.com/hobbyquaker/hm-simulator) rfd simulation or under `faketime`) and interacts with it via the ReGa script interface (port 8183), its XML-RPC/BIN-RPC server (port 31999) and its log output.

## Running the tests

### Using docker (recommended)

```bash
# build the test image for the current OpenCCU-Base main branch
docker build -t regahss-test --build-arg REGA_ARCH=x86_64-linux-gnu --build-arg BASE_REF=main .

# run the complete test suite (takes ~30 minutes due to the real-time timer tests),
# a summary (results/summary.md) and all reports are written to results/
docker run --rm --init -v "$PWD/results:/results" regahss-test

# test ReGaHss with sanitizer instrumented libXmlRpc/libxmlparser built from source
# (results/sanitizer: ASan/UBSan reports, results/coverage: gcov line coverage)
docker build -t regahss-test:asan --build-arg REGA_LIBS=asan .
docker run --rm --init -v "$PWD/results:/results" regahss-test:asan

# run only specific test files
docker run --rm --init regahss-test npx mocha test/02-script-doku-teil1.js test/13-fixed-bugs.js

# show the ReGaHss output while running the tests
docker run --rm --init -e REGA_OUTPUT=1 regahss-test npx mocha test/01-rega-startup.js
```

Build arguments:

| Argument | Default | Description |
|---|---|---|
| `REGA_ARCH` | `x86_64-linux-gnu` | ReGaHss architecture to test (`x86_64-linux-gnu` or `i686-linux-gnu`) |
| `BASE_REF` | `main` | OpenCCU-Base branch, tag or commit SHA to take ReGaHss from |
| `BASE_REPO` | `https://github.com/OpenCCU/OpenCCU-Base.git` | OpenCCU-Base repository (e.g. a fork) |
| `REGA_LIBS` | `prebuilt` | `libXmlRpc`/`libxmlparser` to run ReGaHss with: `prebuilt` (shipped with OpenCCU-Base), `source` (release build from the OpenCCU-Base sources, incl. informational `abidiff` report vs. the prebuilt libraries) or `asan` (debug build with ASan/UBSan and gcov coverage, `x86_64-linux-gnu` only) |

For all variants the build verifies that ReGaHss resolves all its symbols with the selected libraries (`ldd -r`). With `asan` the sanitizer runtimes are only preloaded into the ReGaHss process (`REGA_PRELOAD`), any ASan/UBSan report makes the test run fail and ReGaHss is stopped gracefully (`SIGTERM`) to let it write its coverage data.

Images built by the CI for the `master` branch (prebuilt libraries) are published as `ghcr.io/openccu/regahss-test:<arch>-<main|release|commit>`.

### Natively (disposable environments only)

`scripts/install-regahss.sh` installs ReGaHss to `/bin`, `/etc`, `/www` and `/usr/local/lib/regahss` and therefore must only be used in disposable environments (VM, container). Requires node.js >= 20.19, `expect` (for `unbuffer`), [libfaketime](https://github.com/wolfcw/libfaketime) >= 0.9.13 built for the ReGaHss architecture (the 32-bit ReGaHss uses the glibc time64 ABI) and the timezone `Europe/Berlin`:

```bash
scripts/fetch-openccu-base.sh https://github.com/OpenCCU/OpenCCU-Base.git main x86_64-linux-gnu /tmp/openccu-base
sudo scripts/install-regahss.sh /tmp/openccu-base x86_64-linux-gnu
# or with libraries built from source (requires cmake and g++)
scripts/build-libs.sh /tmp/openccu-base x86_64-linux-gnu source /tmp/regahss-libs
sudo scripts/install-regahss.sh /tmp/openccu-base x86_64-linux-gnu /tmp/regahss-libs/lib
npm ci
sudo env "PATH=$PATH" TZ=Europe/Berlin npm test
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REGA_BIN` | `/bin/ReGaHss` | ReGaHss binary to test |
| `REGA_LABEL` | `<arch>@<commit>/<libs>` | label shown in the test titles |
| `REGA_PRELOAD` | – | libraries to preload into the ReGaHss process only (set automatically for `asan`) |
| `REGA_RESULTS_DIR` | `/results` | directory for the summary, sanitizer reports and coverage (docker image) |
| `REGA_OUTPUT` | – | set to `1` to show the ReGaHss output |
| `SIM_OUTPUT` | – | set to `1` to show the hm-simulator output |

## Continuous integration

The [CI workflow](.github/workflows/ci.yml) runs on every push/pull request and nightly. It tests the ReGaHss binaries for `x86_64-linux-gnu` and `i686-linux-gnu` of

* `main` - the current HEAD of OpenCCU-Base and
* `release` - the OpenCCU-Base revision OpenCCU currently builds its firmware with (`OPENCCU_BASE_VERSION` in [openccu-base.mk](https://github.com/OpenCCU/OpenCCU/blob/master/buildroot-external/package/openccu-base/openccu-base.mk)),

whereas identical revisions are only tested once. Each revision is tested with the prebuilt and the source built libraries on both architectures plus the `asan` variant on `x86_64-linux-gnu`. Every test job adds a summary (versions, ABI changes, sanitizer reports, library coverage) to the GitHub job summary and uploads all results as artifact. A manual run (`workflow_dispatch`) allows to test an additional OpenCCU-Base ref (`base_ref`) and to additionally run the legacy tests against the binaries of the old [OCCU](https://github.com/OpenCCU/occu) repository (`legacy_occu`, see `legacy/`).

### Testing OpenCCU-Base pull requests

The test job is a [reusable workflow](.github/workflows/regahss-test.yml) which can be called from OpenCCU-Base to test a pull request (including the `libXmlRpc`/`libxmlparser` sources it changes) before it is merged:

```yaml
# .github/workflows/regahss-test.yml in OpenCCU-Base
name: ReGaHss-Test
on:
  pull_request:
permissions:
  contents: read
jobs:
  regahss-test:
    strategy:
      fail-fast: false
      matrix:
        include:
          - {arch: x86_64-linux-gnu, libs: source}
          - {arch: x86_64-linux-gnu, libs: asan}
          - {arch: i686-linux-gnu, libs: source}
    uses: OpenCCU/ReGaHss-Test/.github/workflows/regahss-test.yml@master
    with:
      base_repo: ${{ github.event.pull_request.head.repo.clone_url }}
      base_ref: ${{ github.event.pull_request.head.sha }}
      base_name: pr-${{ github.event.pull_request.number }}
      arch: ${{ matrix.arch }}
      libs: ${{ matrix.libs }}
      test_repo: OpenCCU/ReGaHss-Test
      test_ref: master
```

## homematic.regadom

ReGaHss is started with a prebuilt `homematic.regadom` which contains the following variables, programs and objects:

#### Variables

* VarBool1 - id: 1237
* VarEnum1
* VarNum1
* VarString1

#### Programs

* Bool1OnFalse - BidCoS-RF:13 PRESS_LONG
* Bool1OnTrue - BidCoS-RF:12 PRESS_LONG
* Bool1OnFalseUpdate - BidCoS-RF:14 PRESS_LONG
* Bool1OnTrueUpdate - BidCoS-RF:15 PRESS_LONG
* TimeEveryMinute - id: 1302 - BidCoS-RF:50 PRESS_LONG
* Time0100 - id: 1314 - BidCoS-RF:11 PRESS_LONG
* Time0130 - id: 1430 - BidCoS-RF:20 PRESS_LONG
* Time0155 - id: 1458 - BidCoS-RF:21 PRESS_LONG
* Time0200 - id: 1470 - BidCoS-RF:22 PRESS_LONG
* Time0205 - id: 1498 - BidCoS-RF:23 PRESS_LONG
* Time0230 - id: 1510 - BidCoS-RF:24 PRESS_LONG
* Time0255 - id: 1522 - BidCoS-RF:25 PRESS_LONG
* Time0300 - id: 1534 - BidCoS-RF:26 PRESS_LONG
* Time0305 - id: 1546 - BidCoS-RF:27 PRESS_LONG
* Time0330 - id: 1558 - BidCoS-RF:28 PRESS_LONG
* Key16Key17 - on BidCoS-RF:16 PRESS_LONG => BidCoS-RF:17 PRESS_LONG
* Key1 - on BidCos-RF:1 PRESS_SHORT => BidCoS-RF:2 PRESS_LONG

## Roadmap

* **Phase 0/1** (done): pinned dependencies, node.js 22, docker based test environment, switch from OCCU to OpenCCU-Base
* **Phase 2** (done): build `libXmlRpc`/`libxmlparser` from OpenCCU-Base sources and test ReGaHss against them (incl. ASan/UBSan builds, ABI checks via `abidiff`, gcov coverage), reusable workflow to test OpenCCU-Base pull requests
* **Phase 3**: test harness rework (crash detection, per-instance environments, parallel execution, accelerated faketime timer tests, JUnit reports, log artifacts)
* **Phase 4**: broader test coverage (data driven script test corpus, differential tests against previous releases, object model/persistence tests, extended rfd/HmIP/VirtualDevices simulator)
* **Phase 5**: aarch64/armhf via QEMU, Y2038 tests on 32-bit platforms, XML-RPC/HTTP fuzzing, long-running stability tests

## Links

* [OpenCCU](https://github.com/OpenCCU/OpenCCU)
* [OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base)
* [OCCU](https://github.com/OpenCCU/occu) (legacy)
* [hm-simulator](https://github.com/hobbyquaker/hm-simulator) (simulates rfd/hmipserver)
* [homematic-rega](https://github.com/hobbyquaker/homematic-rega) (Node.js Homematic CCU ReGaHSS Remote Script Interface)
* [ccu x86 docker image](https://hub.docker.com/r/litti/ccu2/) (used for creation of the prebuilt homematic.regadom)

## Contributing

Help and Feedback highly appreciated, Pull Requests Welcome! :-)

## License

MIT (c) 2017-2026 [Jens Maus](https://github.com/jens-maus), [Sebastian Raff](https://github.com/hobbyquaker)
