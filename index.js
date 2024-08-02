const byteSize = require('byte-size')

const bigBufferCutoff = 4000
const msBeforeItIsALeak = 1000 * 60

function monkeyPatchBuffer () {
  let bufCounter = 0
  const bufMap = new Map()
  const slabToKeys = new Map()
  const keyToSlab = new Map()
  const leakCounters = new Map()

  const registry = new FinalizationRegistry((key) => {
    const slab = keyToSlab.get(key)
    keyToSlab.delete(key)

    const slabKeys = slabToKeys.get(slab)
    slabKeys.delete(key)
    if (slabKeys.size === 0) {
      slabToKeys.delete(slab)
    }

    clearTimeout(bufMap.get(key))
    bufMap.delete(key)
  })

  const originalAllocUnsafe = Buffer.allocUnsafe

  Buffer.allocUnsafe = function allocUnsafeMonkeyPatch (...args) {
    const res = originalAllocUnsafe(...args)

    const isBigBuffer = res.byteLength >= bigBufferCutoff
    const isPotentialSlabRetainer = res.buffer.byteLength >= 10 * res.byteLength // Note: pretty ad-hoc cut-off
    if (isBigBuffer || isPotentialSlabRetainer) {
      const trace = (new Error()).stack
      const key = bufCounter++
      const slab = res.buffer

      keyToSlab.set(key, slab)
      let slabKeys = slabToKeys.get(slab)
      if (!slabKeys) {
        slabKeys = new Set()
        slabToKeys.set(slab, slabKeys)
      }
      slabKeys.add(key)

      const bufferLength = res.byteLength
      const arrayBufferLength = res.buffer.byteLength

      const timeout = setTimeout(() => {
        const location = trace.split('\n').slice(2).join('\n')
        let current = leakCounters.get(location)
        if (current === undefined) {
          current = {
            keys: [],
            bufferLengths: [],
            arrayBufferLengths: []
          }
          leakCounters.set(location, current)
        }
        current.keys.push(key)
        current.bufferLengths.push(bufferLength)
        current.arrayBufferLengths.push(arrayBufferLength) // TODO: can be removed I think (we store the slab itself)
        bufMap.delete(key)
      }, msBeforeItIsALeak)
      bufMap.set(key, timeout)
      registry.register(res, key)
    }
    return res
  }

  return { leakCounters, keyToSlab, slabToKeys }
}

function getLeakOverview ({ leakCounters, keyToSlab, slabToKeys }) {
  const slabLeaks = []
  const bigBufferLeaks = []
  for (const [location, { keys, bufferLengths, arrayBufferLengths }] of leakCounters.entries()) {
    let amount = 0
    let normalisedTotalLeakedBytes = 0
    let total = 0

    let bigBuffersAmount = 0
    let bigBuffersTotalSize = 0

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]

      const slab = keyToSlab.get(key)
      if (!slab) continue // Already cleaned up (TODO: cleanly)

      const totalSlab = arrayBufferLengths[i]
      const ownSize = bufferLengths[i]
      const slabLeak = totalSlab - ownSize

      if (ownSize >= bigBufferCutoff) {
        bigBuffersAmount++
        bigBuffersTotalSize += ownSize
      }
      if (slabLeak > 0) {
        amount++
        const totalRetainers = slabToKeys.get(slab).size
        total += slabLeak
        normalisedTotalLeakedBytes += slabLeak / totalRetainers
      }
    }

    if (amount > 0) {
      slabLeaks.push({
        location, normalisedTotalLeakedBytes, amount, total
      })
    }

    if (bigBuffersAmount > 0) {
      bigBufferLeaks.push({ amount: bigBuffersAmount, totalSize: bigBuffersTotalSize, location })
    }
  }

  slabLeaks.sort((e1, e2) => e1.normalisedTotalLeakedBytes < e2.normalisedTotalLeakedBytes ? 1 : e1.normalisedTotalLeakedBytes > e2.normalisedTotalLeakedBytes ? -1 : 0)
  bigBufferLeaks.sort((e1, e2) => e1.totalSize < e2.totalSize ? 1 : e1.totalSize > e2.totalSize ? -1 : 0)

  return { bigBufferLeaks, slabLeaks }
}

module.exports = function setupStatsLogging (msStatsInterval = 90 * 1000) {
  const { leakCounters, keyToSlab, slabToKeys } = monkeyPatchBuffer()

  setInterval(() => {
    const { bigBufferLeaks, slabLeaks } = getLeakOverview({ leakCounters, keyToSlab, slabToKeys })

    let totalBigBufferLeaks = 0
    let totalSlabLeaks = 0

    console.log('Slab retainer leaks')
    for (const { amount, total, normalisedTotalLeakedBytes, location } of slabLeaks) {
      totalSlabLeaks += normalisedTotalLeakedBytes
      console.log(`${amount} leaks of avg (${byteSize(total / amount)}) (total: ${byteSize(normalisedTotalLeakedBytes)} normalised against retainers--summed total with full slabs: ${byteSize(total)}) at ${location}`)
    }

    console.log('Big buffer leaks')
    for (const { amount, totalSize, location } of bigBufferLeaks) {
      totalBigBufferLeaks += totalSize
      console.log(`${amount} leaks of big buffers of avg size ${byteSize(totalSize / amount)} (total: ${byteSize(totalSize)}) at ${location}`)
    }

    console.log(`Total slab leaked bytes (normalised against retainers): ${byteSize(totalSlabLeaks)}`)
    console.log(`Total big buffer leaked bytes: ${byteSize(totalBigBufferLeaks)}`)
  }, msStatsInterval)
}
