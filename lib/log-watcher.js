// Collects the output lines of a process (ReGaHss, simulator) and allows to
// wait for lines matching a regular expression. Lines not consumed by a
// waiter yet are buffered, so that a waiter also matches lines which were
// output before it was registered.

const noop = () => undefined;

class LogWatcher {
    /**
     * @param {object} [options]
     * @param {string} [options.name=process] - name used in error messages
     * @param {number} [options.tailSize=40] - number of lines kept for tail()
     */
    constructor({name = 'process', tailSize = 40} = {}) {
        this.name = name;
        this.tailSize = tailSize;
        this.reset();
    }

    reset() {
        this.buffer = [];
        this.waiters = new Set();
        this.listeners = new Set();
        this.lastLines = [];
        this.failure = null;
    }

    /**
     * Adds an output line and passes it to all matching waiters (or buffers
     * it if there are none).
     *
     * @param {string} line
     */
    push(line) {
        for (const listener of this.listeners) {
            listener(line);
        }

        this.lastLines.push(line);
        if (this.lastLines.length > this.tailSize) {
            this.lastLines.shift();
        }

        if (!this._dispatch(line)) {
            this.buffer.push(line);
        }
    }

    _dispatch(line) {
        const matching = [...this.waiters].filter(waiter => waiter.rx.test(line));
        for (const waiter of matching) {
            this.waiters.delete(waiter);
        }

        // (callbacks are called afterwards as they may register new waiters)
        for (const waiter of matching) {
            waiter.resolve(line);
        }

        return matching.length > 0;
    }

    /**
     * Calls listener for every following output line.
     *
     * @param {function(string)} listener
     * @returns {function()} function to remove the listener
     */
    tap(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Registers a callback for the next (buffered or future) line matching rx.
     *
     * @param {RegExp} rx
     * @param {object} handlers
     * @param {function(string)} handlers.resolve
     * @param {function(Error)} [handlers.reject]
     * @param {boolean} [buffered=true] - also match lines output before
     * @returns {function()} function to cancel the waiter
     */
    on(rx, handlers, buffered = true) {
        const {resolve, reject = noop} = handlers;
        if (buffered) {
            const index = this.buffer.findIndex(line => rx.test(line));
            if (index !== -1) {
                const [line] = this.buffer.splice(index, 1);
                resolve(line);
                return noop;
            }
        }

        if (this.failure) {
            reject(this.failure);
            return noop;
        }

        const waiter = {rx, resolve, reject};
        this.waiters.add(waiter);
        return () => this.waiters.delete(waiter);
    }

    /**
     * Waits for the next (buffered or future) line matching rx.
     *
     * @param {RegExp} rx
     * @param {object} [options]
     * @param {number} [options.timeout=0] - timeout in ms (0: none, i.e. the mocha test timeout applies)
     * @param {boolean} [options.buffered=true] - also match lines output before
     * @returns {Promise<string>} the matching line
     */
    waitFor(rx, {timeout = 0, buffered = true} = {}) {
        return new Promise((resolve, reject) => {
            let timer = null;
            const cancel = this.on(rx, {
                resolve(line) {
                    clearTimeout(timer);
                    resolve(line);
                },
                reject(error) {
                    clearTimeout(timer);
                    reject(error);
                }
            }, buffered);
            if (timeout > 0) {
                timer = setTimeout(() => {
                    cancel();
                    reject(new Error('no ' + this.name + ' output matching ' + rx + ' within ' + timeout + 'ms, last lines:\n' + this.tail(10)));
                }, timeout);
            }
        });
    }

    /**
     * Rejects all pending and future waiters (e.g. as the process exited).
     *
     * @param {Error} error
     */
    fail(error) {
        this.failure = error;
        const waiters = [...this.waiters];
        this.waiters.clear();
        for (const waiter of waiters) {
            waiter.reject(error);
        }
    }

    /**
     * @param {number} [count] - number of lines (default: all kept lines)
     * @returns {string} the last output lines
     */
    tail(count = this.tailSize) {
        return this.lastLines.slice(-count).join('\n');
    }
}

module.exports = {LogWatcher};
