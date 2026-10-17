// ReGaHss version helpers (without dependencies, also used by lib/corpus.js)

/**
 * Compares two ReGaHss versions ("R1.00.0388.0257").
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} < 0 if a is older than b, 0 if equal, > 0 if newer
 */
function compareRegaVersions(a, b) {
    const parse = version => version.replace(/^R/, '').split('.').map(Number);
    const [pa, pb] = [parse(a), parse(b)];
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) {
            return diff;
        }
    }

    return 0;
}

module.exports = {
    compareRegaVersions
};
