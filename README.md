# ReGaHss Testing Environment
[![CI](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

This repository performs automated daily system tests of `ReGaHss` - the HomeMatic CCU "Logic Layer" engine. It uses a [mocha](https://github.com/mochajs/mocha)-based node.js testing framework to test the `ReGaHss` binaries published in [OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base), the component base layer of [OpenCCU](https://github.com/OpenCCU/OpenCCU). Beside testing common corner cases of the embedded scripting language of ReGaHss, this testing framework also tests program/timer execution (including DST and leap year boundaries via [libfaketime](https://github.com/wolfcw/libfaketime)), the XML-RPC interface and checks for known security vulnerabilities.

## How it works

* The required parts of an OpenCCU-Base revision (`bin/<arch>/ReGaHss`, `lib/<arch>/libXmlRpc.so`, `lib/<arch>/libxmlparser.so` and `www/`) are fetched via a shallow sparse checkout (`scripts/fetch-openccu-base.sh`).
* ReGaHss and its runtime environment (`rega.conf`, `InterfacesList.xml`, the prebuilt test `homematic.regadom`, dummy hook scripts) are installed into a disposable docker image (`scripts/install-regahss.sh`).
* Each test file (`test/*.js`) starts its own ReGaHss process (optionally together with the [hm-simulator](https://github.com/hobbyquaker/hm-simulator) rfd simulation or under `faketime`) and interacts with it via the ReGa script interface (port 8183), its XML-RPC/BIN-RPC server (port 31999) and its log output.

## Running the tests

### Using docker (recommended)

```bash
# build the test image for the current OpenCCU-Base main branch
docker build -t regahss-test --build-arg REGA_ARCH=x86_64-linux-gnu --build-arg BASE_REF=main .

# run the complete test suite (takes ~30 minutes due to the real-time timer tests)
docker run --rm --init regahss-test

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

Images built by the CI for the `master` branch are published as `ghcr.io/openccu/regahss-test:<arch>-<main|release|commit>`.

### Natively (disposable environments only)

`scripts/install-regahss.sh` installs ReGaHss to `/bin`, `/etc`, `/www` and `/usr/local/lib/regahss` and therefore must only be used in disposable environments (VM, container). Requires node.js >= 20.19, `expect` (for `unbuffer`), `faketime`/`libfaketime` and the timezone `Europe/Berlin`:

```bash
scripts/fetch-openccu-base.sh https://github.com/OpenCCU/OpenCCU-Base.git main x86_64-linux-gnu /tmp/openccu-base
sudo scripts/install-regahss.sh /tmp/openccu-base x86_64-linux-gnu
npm ci
sudo env "PATH=$PATH" TZ=Europe/Berlin npm test
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REGA_BIN` | `/bin/ReGaHss` | ReGaHss binary to test |
| `REGA_LABEL` | `<arch>@<commit>` | label shown in the test titles |
| `REGA_OUTPUT` | – | set to `1` to show the ReGaHss output |
| `SIM_OUTPUT` | – | set to `1` to show the hm-simulator output |

## Continuous integration

The [CI workflow](.github/workflows/ci.yml) runs on every push/pull request and nightly. It tests the ReGaHss binaries for `x86_64-linux-gnu` and `i686-linux-gnu` of

* `main` - the current HEAD of OpenCCU-Base and
* `release` - the OpenCCU-Base revision OpenCCU currently builds its firmware with (`OPENCCU_BASE_VERSION` in [openccu-base.mk](https://github.com/OpenCCU/OpenCCU/blob/master/buildroot-external/package/openccu-base/openccu-base.mk)),

whereas identical revisions are only tested once. A manual run (`workflow_dispatch`) allows to test an additional OpenCCU-Base ref (`base_ref`) and to additionally run the legacy tests against the binaries of the old [OCCU](https://github.com/OpenCCU/occu) repository (`legacy_occu`, see `legacy/`).

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
* **Phase 2**: build `libXmlRpc`/`libxmlparser` from OpenCCU-Base sources and test ReGaHss against them (incl. ASan/UBSan builds, ABI checks via `abidiff`, gcov coverage), trigger tests from OpenCCU-Base pull requests
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
