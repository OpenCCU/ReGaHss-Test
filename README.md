# ReGaHss Testing Environment
[![CI](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenCCU/ReGaHss-Test/actions/workflows/ci.yml)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

This repository performs automated daily system tests of `ReGaHss` - the HomeMatic CCU "Logic Layer" engine. It uses a [mocha](https://github.com/mochajs/mocha)-based node.js testing framework to test the `ReGaHss` binaries published in [OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base), the component base layer of [OpenCCU](https://github.com/OpenCCU/OpenCCU). Beside testing common corner cases of the embedded scripting language of ReGaHss, this testing framework also tests program/timer execution (including DST and leap year boundaries via [libfaketime](https://github.com/wolfcw/libfaketime)), the XML-RPC interface and checks for known security vulnerabilities.

## How it works

* The required parts of an OpenCCU-Base revision (`bin/<arch>/ReGaHss`, `lib/<arch>/libXmlRpc.so`, `lib/<arch>/libxmlparser.so`, `www/` and the CMake build system plus library sources) are fetched via a shallow sparse checkout (`scripts/fetch-openccu-base.sh`).
* ReGaHss is either run with the prebuilt `libXmlRpc`/`libxmlparser` of OpenCCU-Base or with these libraries rebuilt from the OpenCCU-Base sources (`scripts/build-libs.sh`), optionally instrumented with AddressSanitizer/UndefinedBehaviorSanitizer and gcov coverage.
* ReGaHss and its runtime environment (`rega.conf`, `InterfacesList.xml`, the prebuilt test `homematic.regadom`, dummy hook scripts) are installed into a disposable docker image (`scripts/install-regahss.sh`).
* Each test file (`test/*.js`) starts its own ReGaHss process (optionally together with the simulated CCU interface processes or under [libfaketime](https://github.com/wolfcw/libfaketime)) and interacts with it via the ReGa script interface, its XML-RPC/BIN-RPC server and its log output.
* `lib/ccu-simulator.js` simulates the interface processes of a CCU: `BidCos-RF` (rfd, BIN-RPC), `HmIP-RF` (HmIPServer, XML-RPC) and `VirtualDevices` (XML-RPC, `/groups`). They accept the `init` of ReGaHss, announce their devices (`test/fixtures/devices.json`) via `listDevices`/`newDevices`, answer `getParamsetDescription`/`getLinks`/`setValue` etc. and allow tests to send events, add/delete devices or restart an interface.
* Every ReGaHss instance runs with its own working directory (`rega.conf`, `homematic.regadom`, `InterfacesList.xml`) and its own ports (`lib/rega-instance.js`), so that the test files can be run in parallel worker processes (`REGA_JOBS`).
* ReGaHss is started directly (without wrapper processes), so the test harness notices crashes immediately: pending tests fail at once with the exit signal and the last log lines of ReGaHss instead of running into timeouts.

## Running the tests

### Using docker (recommended)

```bash
# build the test image for the current OpenCCU-Base main branch
docker build -t regahss-test --build-arg REGA_ARCH=x86_64-linux-gnu --build-arg BASE_REF=main .

# run the complete test suite, a summary (results/summary.md), a JUnit report
# (results/junit.xml) and all other reports are written to results/
docker run --rm --init -v "$PWD/results:/results" regahss-test

# run the test files in 4 parallel worker processes and the timer tests in
# real time (default: 10 times accelerated clock)
docker run --rm --init -e REGA_JOBS=4 -e REGA_FAKETIME_RATE=1 -v "$PWD/results:/results" regahss-test

# test ReGaHss with sanitizer instrumented libXmlRpc/libxmlparser built from source
# (results/sanitizer: ASan/UBSan reports, results/coverage: gcov line coverage)
docker build -t regahss-test:asan --build-arg REGA_LIBS=asan .
docker run --rm --init -v "$PWD/results:/results" regahss-test:asan

# run only specific test files
docker run --rm --init regahss-test npx mocha test/02-script-doku-teil1.js test/13-fixed-bugs.js

# additionally compare the results of the script corpus with the ReGaHss of
# another OpenCCU-Base revision (results/differential.md, informational)
docker build -t regahss-test --build-arg REF_BASE_REF=<sha> .

# show the ReGaHss output while running the tests
docker run --rm --init -e REGA_OUTPUT=1 regahss-test npx mocha test/01-rega-startup.js
```

Build arguments:

| Argument | Default | Description |
|---|---|---|
| `REGA_ARCH` | `x86_64-linux-gnu` | ReGaHss architecture to test: `x86_64-linux-gnu`, `i686-linux-gnu`, `aarch64-linux-gnu` or `arm-linux-gnueabihf` (the ARM binaries run with the qemu user mode emulator, prebuilt libraries only) |
| `BASE_REF` | `main` | OpenCCU-Base branch, tag or commit SHA to take ReGaHss from |
| `BASE_REPO` | `https://github.com/OpenCCU/OpenCCU-Base.git` | OpenCCU-Base repository (e.g. a fork) |
| `REF_BASE_REF` | – | OpenCCU-Base revision with a reference ReGaHss for differential tests of the script corpus (the CI uses the revision before the last change of the ReGaHss binary) |
| `REGA_LIBS` | `prebuilt` | `libXmlRpc`/`libxmlparser` to run ReGaHss with: `prebuilt` (shipped with OpenCCU-Base), `source` (release build from the OpenCCU-Base sources, incl. informational `abidiff` report vs. the prebuilt libraries) or `asan` (debug build with ASan/UBSan and gcov coverage, `x86_64-linux-gnu` only) |

For all variants the build verifies that ReGaHss resolves all its symbols with the selected libraries (`ldd -r`). With `asan` the sanitizer runtimes are only preloaded into the ReGaHss process (`REGA_PRELOAD`), any ASan/UBSan report makes the test run fail and ReGaHss is stopped gracefully (`SIGTERM`) to let it write its coverage data. As libfaketime and the preloaded ASan runtime deadlock at ReGaHss startup (the ASan allocator calls `clock_gettime()` with its lock held, which triggers the lazy initialization of libfaketime, which in turn allocates memory), the faketime based timer tests are reported as pending for `asan` (they are run by all other variants).

ReGaHss sporadically aborts when it is stopped with `SIGTERM` (`terminate called without an active exception`: the forced unwind of a thread cancelled by `Halt()` ends in `std::terminate()`). This known shutdown race only causes a warning in the summary when ReGaHss is stopped at the end of a test file (its core dump is kept as `shutdown-abort.core*`, but does not fail the test run), whereas `test/15-rega-lifecycle.js` checks the shutdown on `SIGTERM` strictly.

The output of every ReGaHss instance started by the tests is kept in `results/logs.tar.gz`. If ReGaHss crashes with a core dump (requires `docker run --ulimit core=-1` and a relative `kernel.core_pattern` of the host such as `core.%e.%p`), the core dumps are moved to `results/cores` together with a backtrace (`gdb`) and the ReGaHss binary, and the test run fails.

The timer tests (`test/07*-timer-faketime-*.js`) run with a 10 times accelerated faked clock by default (`REGA_FAKETIME_RATE`), which reduces the runtime of the whole test suite from ~28 to ~3 minutes. For the 32-bit ReGaHss (`i686-linux-gnu`, `arm-linux-gnueabihf`) they run in real time, as libfaketime does not accelerate the waits of its timer thread (glibc time64 ABI) and the timers would fire too late. The nightly CI run executes them in real time on all architectures (`REGA_FAKETIME_RATE=1`). Real time runs benefit from parallel execution (`REGA_JOBS=4`), as the timer tests are split into four files.

### Other architectures (aarch64/armhf)

The ReGaHss binaries of OpenCCU-Base for `aarch64-linux-gnu` and `arm-linux-gnueabihf` are tested with the [qemu](https://www.qemu.org/) user mode emulator (`qemu-user-static`). `ReGaInstance` detects the architecture from the ELF header and runs a binary of a foreign architecture through the matching emulator (`REGA_EMULATOR` overrides it, `none` disables it); the preload libraries (line buffering, libfaketime) are built for the architecture of ReGaHss and passed to the emulated process. The docker image installs `qemu-user-static` and the runtime libraries of the architecture; only the prebuilt libraries are supported for the ARM architectures. Emulated runs are several times slower, so the timeouts of the tests are scaled accordingly.

Images built by the CI for the `master` branch (prebuilt libraries) are published as `ghcr.io/openccu/regahss-test:<arch>-<main|release|commit>`.

### Natively (disposable environments only)

`scripts/install-regahss.sh` installs ReGaHss to `/bin`, `/etc`, `/www` and `/usr/local/lib/regahss` and therefore must only be used in disposable environments (VM, container). Requires node.js >= 20.19, [libfaketime](https://github.com/wolfcw/libfaketime) >= 0.9.13 built for the ReGaHss architecture (the 32-bit ReGaHss uses the glibc time64 ABI), the timezone `Europe/Berlin` and a library making the output of ReGaHss line buffered: for `x86_64-linux-gnu` the `libstdbuf.so` of coreutils is used automatically, for the other architectures build `src/linebuf.c` (`gcc -m32 -shared -fPIC -o /usr/local/lib/regahss-test/liblinebuf.so src/linebuf.c`, or with the cross compiler of the target architecture). The ARM binaries additionally need `qemu-user-static` and the runtime libraries of their architecture. The Y2038 tests use `src/timeshift.c` (`REGA_TIMESHIFT_LIB`):

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
| `REGA_JOBS` | `1` | number of test files to run in parallel (mocha `--parallel`) |
| `REGA_FAKETIME_RATE` | `10` (`1` for 32-bit) | speed of the faked clock for the timer tests (`1`: real time) |
| `REGA_EMULATOR` | auto | emulator to run ReGaHss with (qemu user mode for foreign architectures, `none` to force native execution) |
| `REGA_TIMESHIFT_LIB` | auto | preload library shifting the realtime clock (`src/timeshift.c`, used by the Y2038 tests beyond 2038 on 32-bit platforms) |
| `REGA_FUZZ_ITERATIONS` | `200` | number of fuzzing inputs per interface (`test/21-fuzzing.js`) |
| `REGA_FUZZ_SEED` | `1` | seed of the fuzzing inputs (reproducible) |
| `REGA_FUZZ_DIR` | – | directory to save the last fuzzing inputs to if ReGaHss crashes (for reproduction) |
| `REGA_SOAK_SECONDS` | `30` | duration of the stability/soak test (`test/22-stability.js`) |
| `REGA_PRELOAD` | – | libraries to preload into the ReGaHss process only (set automatically for `asan`) |
| `REGA_STOP_SIGNAL` | `KILL` | signal to stop ReGaHss with after each test file (`TERM` for `asan`) |
| `REGA_LOG_DIR` | – | directory to write the output of each ReGaHss instance to (`results/logs` in the docker image) |
| `REGA_JUNIT_FILE` | – | file to write a JUnit XML report to (`results/junit.xml` in the docker image) |
| `REGA_WARNINGS_FILE` | – | file to append warnings of the test run to, e.g. known aborts of ReGaHss while stopping it (`results/warnings.md` in the docker image, shown in the summary) |
| `REGA_WORK_DIR` | `$TMPDIR/regahss-test` | base directory of the working directories of the ReGaHss instances |
| `REGA_PORT_BASE` | `20000` | first port used by the ReGaHss instances (10 ports per parallel worker) |
| `REGA_LINEBUF_LIB` | auto | preload library making the ReGaHss output line buffered (`src/linebuf.c` or coreutils' `libstdbuf.so`) |
| `REGA_FAKETIME_LIB` | auto | `libfaketime.so.1` to fake the time of ReGaHss with |
| `REGA_RESULTS_DIR` | `/results` | directory for the summary, JUnit report, ReGaHss logs, core dumps, sanitizer reports and coverage (docker image) |
| `REGA_OUTPUT` | – | set to `1` to show the ReGaHss output |
| `SIM_OUTPUT` | – | set to `1` to show the output of the interface simulator (RPC calls in both directions) |
| `REGA_CORPUS` | – | only run the script corpus files matching this regular expression |
| `REGA_CORPUS_RECORD` | – | set to `1` to write the results of the ReGaHss under test into the script corpus files |
| `REGA_REF_BIN` | – | reference ReGaHss to execute the script corpus with as well (set automatically in the docker image if built with `REF_BASE_REF`) |
| `REGA_REF_LIB_DIR` | – | directory with the `libXmlRpc`/`libxmlparser` of the reference ReGaHss |
| `REGA_DIFF_REPORT` | – | markdown file to write the differences between ReGaHss and the reference ReGaHss to |

### Writing tests

Each test file starts and stops its ReGaHss instance via `initTest()` and `cleanupTest()` of `lib/helper.js`. Tests use async functions and fail immediately if ReGaHss crashes:

```js
const {rega, regaLabel, initTest, cleanupTest, waitForRega, waitForSim} = require('../lib/helper.js');

describe('Running my-test.js [' + regaLabel + ']', function () {
    // start ReGaHss (options: sim, faketime, rate, rpc, nocopy)
    initTest({sim: true});

    describe('running tests', function () {
        it('should execute a script', async function () {
            const {output, objects} = await rega.exec('string s = "hello"; WriteLine(s);');
            output.should.equal('hello\r\n');
            objects.s.should.equal('hello');
        });

        it('should trigger a program', async function () {
            // wait for log output caused by the script (not for earlier lines)
            await Promise.all([
                waitForSim(/setValue rfd BidCoS-RF:12 PRESS_LONG true/, {buffered: false}),
                rega.exec('dom.GetObject(1237).State(true);')
            ]);
        });
    });

    cleanupTest();
});
```

### Script corpus

`test/corpus/*.rega` contains ReGa scripts together with their expected output, the resulting variables and the script errors. Each file is executed by a ReGaHss instance of its own (`test/16-script-corpus.js`):

```
!! fixed-time: 2024-06-15 12:34:56 CEST

#### string concatenation
string s = "a" # "b";
WriteLine(s);
---- output
ab
---- vars
s=ab
----
```

* `!! fixed-time: <date>` freezes the clock of ReGaHss (libfaketime) for all cases of the file
* each case starts with `#### <name>` followed by the script, the expected `output` (every line ends with CR/LF; `\r`, `\n`, `\t` and `\\` are escaped and a trailing `\c` means that the output does not end with a line break), the expected `vars` (values of the script variables) and, only if there are any, the expected `errors` (script errors logged by ReGaHss, normalized)
* new cases can be added without expectations and recorded with `REGA_CORPUS_RECORD=1 npx mocha test/16-script-corpus.js`; the recorded results must be reviewed before committing them

With `REGA_REF_BIN` every case is executed by a reference ReGaHss as well and the differences are written to a markdown report (informational, they do not make the tests fail). The CI uses the ReGaHss of the OpenCCU-Base revision before the last change of the binary as reference and adds the report to the job summary.

### Programs and time modules

`lib/program-builder.js` generates ReGa scripts creating programs (conditions on system variables, datapoints and time modules, destinations with delays, else-if/else rules) and time modules (incl. astro time modules with offsets to sunrise/sunset) the same way the WebUI does, e.g.:

```js
const {programScript} = require('../lib/program-builder.js');

await rega.exec(programScript({
    name: 'Key pressed',
    rules: [{
        // conditions: OR of AND groups
        conditions: [[{datapoint: 'BidCos-RF.BidCoS-RF:40.PRESS_SHORT', value: true, trigger: 'update'}]],
        destinations: [{sysvar: 'VarString1', value: 'key pressed', delay: 3}]
    }]
}));
```

### Fuzzing

`lib/fuzzer.js` generates deterministic (seeded) inputs for the interfaces of ReGaHss — BIN-RPC and XML-RPC requests to its RPC server (`libXmlRpc`/`libxmlparser`), HTTP requests to its web server and ReGa scripts — from valid via slightly broken to heavily byte-mutated. `test/21-fuzzing.js` sends them to a running ReGaHss and checks after every batch that it is still alive and answers on both servers; a crash is detected immediately and the last inputs are saved for reproduction (`REGA_FUZZ_DIR`). With the sanitizer instrumented libraries (`asan`) memory errors in the libraries are reported as well. The same seed always produces the same inputs (`REGA_FUZZ_SEED`), so a finding is reproducible.

The fuzzer immediately found an unbounded recursion in `libXmlRpc`: a `system.multicall` which contains another `system.multicall` makes `XmlRpcServerConnection::executeMulticall()` recurse until the stack is exhausted and ReGaHss crashes (`SIGSEGV`), reachable unauthenticated via the RPC port ([OpenCCU/OpenCCU#4384](https://github.com/OpenCCU/OpenCCU/issues/4384)). `test/21-fuzzing.js` therefore fails until ReGaHss is fixed.

### Year 2038

`test/20-y2038.js` starts ReGaHss shortly before 2038-01-19 03:14:07 UTC (2³¹ seconds since the epoch, the overflow of a signed 32-bit `time_t`) and checks that time modules, programs, timestamps of system variables, the communication with the interfaces and the persistence keep working past the overflow — relevant for the 32-bit platforms (`i686`, `armhf`), whose ReGaHss is built for the 64-bit `time_t` of the glibc time64 ABI. As libfaketime keeps the faked time in a 32-bit `time_t` for 32-bit programs and cannot fake a time beyond 2038, the realtime clock is shifted with `src/timeshift.c` instead (the monotonic clock is left untouched and absolute realtime timeouts are shifted back, so waits still take as long as intended).

### Stability

`test/22-stability.js` is a soak test: it executes scripts, sends device events and lets a program run for `REGA_SOAK_SECONDS` while sampling the resident memory, the number of threads and open file descriptors of ReGaHss (`ReGaInstance.resourceUsage()`), and checks that ReGaHss stays responsive and does not leak. The nightly CI run uses a longer duration.

## Continuous integration

The [CI workflow](.github/workflows/ci.yml) runs on every push/pull request and nightly. It tests the ReGaHss binaries for `x86_64-linux-gnu`, `i686-linux-gnu`, `aarch64-linux-gnu` and `arm-linux-gnueabihf` (the ARM architectures with qemu) of

* `main` - the current HEAD of OpenCCU-Base and
* `release` - the OpenCCU-Base revision OpenCCU currently builds its firmware with (`OPENCCU_BASE_VERSION` in [openccu-base.mk](https://github.com/OpenCCU/OpenCCU/blob/master/buildroot-external/package/openccu-base/openccu-base.mk)),

whereas identical revisions are only tested once. Each revision is tested with the prebuilt libraries on all four architectures, the source built libraries on `x86_64-linux-gnu`/`i686-linux-gnu` and the `asan` variant on `x86_64-linux-gnu`. Every test job adds a summary (versions, results per test file and failed tests, core dumps, ABI changes, sanitizer reports, library coverage) to the GitHub job summary and uploads all results (incl. JUnit report, ReGaHss logs and core dumps) as artifact. The test files run in four parallel worker processes and the timer tests with a 10 times accelerated clock (64-bit), the nightly run executes them in real time and fuzzes/soaks more thoroughly. A manual run (`workflow_dispatch`) allows to test an additional OpenCCU-Base ref (`base_ref`) and to additionally run the legacy tests against the binaries of the old [OCCU](https://github.com/OpenCCU/occu) repository (`legacy_occu`, see `legacy/`).

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
* **Phase 3** (done): test harness rework (`ReGaInstance` with per-instance working directories/ports, parallel execution, crash detection, graceful shutdown tests, own script/HTTP client instead of `request`/`homematic-rega`, accelerated faketime timer tests, JUnit reports, core dumps, log artifacts)
* **Phase 4** (done): broader test coverage (data driven script test corpus with record mode, differential tests against the previous ReGaHss release, object model/persistence round trip tests, own BidCos-RF/HmIP-RF/VirtualDevices interface simulator with device lifecycle and RPC tests, program/time module scenarios incl. astro time modules at other locations)
* **Phase 5** (done): aarch64/armhf via QEMU (`qemu-user-static`), Y2038 tests on the 32-bit platforms (`src/timeshift.c`), seeded XML-RPC/BIN-RPC/HTTP/script fuzzing (`lib/fuzzer.js`, found [OpenCCU/OpenCCU#4384](https://github.com/OpenCCU/OpenCCU/issues/4384)), long-running stability/memory soak tests

## Links

* [OpenCCU](https://github.com/OpenCCU/OpenCCU)
* [OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base)
* [OCCU](https://github.com/OpenCCU/occu) (legacy)
* [hm-simulator](https://github.com/hobbyquaker/hm-simulator) (formerly used rfd/HmIPServer simulator, source of the HmIP device descriptions in `test/fixtures/devices.json`)
* [ccu x86 docker image](https://hub.docker.com/r/litti/ccu2/) (used for creation of the prebuilt homematic.regadom)

## Contributing

Help and Feedback highly appreciated, Pull Requests Welcome! :-)

## License

MIT (c) 2017-2026 [Jens Maus](https://github.com/jens-maus), [Sebastian Raff](https://github.com/hobbyquaker)
