/**
 * Core histogram binning logic.
 *
 * Converts raw numeric data into bins, applying histfunc aggregation and
 * histnorm normalization.  All coordinate-space concerns (axis types, domain
 * normalization) live in SceneCompiler; this module is pure data processing.
 */

export type HistogramBinsSpec = {
  /** Left edge of the first bin. Defaults to min(data). */
  start?: number;
  /** Right edge of the last bin. Defaults to max(data). */
  end?: number;
  /** Fixed bin width. When provided, nbins is ignored. */
  size?: number;
};

export type ComputedHistogram = {
  /** nBins + 1 edges; edges[i]…edges[i+1] defines bin i. */
  binEdges: Float64Array;
  /** Bin midpoints, length = nBins. */
  binCenters: Float64Array;
  /** Aggregated, normalised bin heights, length = nBins. */
  binValues: Float64Array;
};

function sturgesCount(n: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(n, 1))) + 1);
}

/**
 * Bin `binData` values and aggregate optional `funcData` weights.
 *
 * @param binData  Values to bin (x for orientation "v", y for "h").
 * @param funcData Per-point weight/value for histfunc sum/avg.  Pass null for
 *                 pure count histograms.  Must be the same length as binData.
 * @param histfunc Aggregation function applied inside each bin.
 * @param histnorm Normalisation applied after aggregation.
 * @param nbins    Target number of bins (ignored when binsSpec.size is set).
 * @param binsSpec Manual bin specification (start / end / size).
 */
export function computeHistogram(
  binData: number[],
  funcData: number[] | null,
  histfunc: "count" | "sum" | "avg",
  histnorm: "" | "percent" | "probability" | "density" | "probability density",
  nbins: number | undefined,
  binsSpec: HistogramBinsSpec | undefined
): ComputedHistogram {
  // Collect finite values (and matching func values when needed).
  const useFunc = histfunc !== "count" && funcData !== null;
  const filteredBin: number[] = [];
  const filteredFunc: number[] = [];

  for (let i = 0; i < binData.length; i++) {
    const bv = binData[i];
    if (!Number.isFinite(bv)) continue;
    if (useFunc) {
      const fv = funcData![i];
      if (!Number.isFinite(fv)) continue;
      filteredFunc.push(fv);
    }
    filteredBin.push(bv);
  }

  if (filteredBin.length === 0) {
    return {
      binEdges: new Float64Array([0, 1]),
      binCenters: new Float64Array([0.5]),
      binValues: new Float64Array([0])
    };
  }

  let dataMin = filteredBin[0];
  let dataMax = filteredBin[0];
  for (const v of filteredBin) {
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }

  let start = binsSpec?.start != null && Number.isFinite(binsSpec.start) ? binsSpec.start : dataMin;
  let end   = binsSpec?.end   != null && Number.isFinite(binsSpec.end)   ? binsSpec.end   : dataMax;

  let nBins: number;
  let binSize: number;

  if (binsSpec?.size != null && binsSpec.size > 0) {
    // Manual bin size — derive nBins from extent / size.
    binSize = binsSpec.size;
    nBins = Math.max(1, Math.ceil((end - start) / binSize));
    // Align end exactly with the bin grid so binEdges[nBins] === end.
    end = start + nBins * binSize;
  } else {
    // Auto binning: widen degenerate ranges, then apply Sturges or nbins.
    if (start === end) {
      start -= 0.5;
      end   += 0.5;
    }
    nBins = nbins != null && nbins > 0
      ? Math.max(1, Math.min(1000, Math.round(nbins)))
      : Math.max(1, Math.min(1000, sturgesCount(filteredBin.length)));
    binSize = (end - start) / nBins;
    if (binSize <= 0) binSize = 1;
  }

  // Accumulate per-bin counts and weighted sums.
  const rawCounts = new Float64Array(nBins);
  const rawSums   = new Float64Array(nBins);

  for (let i = 0; i < filteredBin.length; i++) {
    const bv = filteredBin[i];
    // Honour manual start/end clipping.
    if (bv < start || bv > end) continue;
    let idx = Math.floor((bv - start) / binSize);
    // Values exactly at the right edge fall into the last bin.
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    rawCounts[idx]++;
    rawSums[idx] += useFunc ? filteredFunc[i] : 0;
  }

  // Apply histfunc.
  const rawValues = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) {
    switch (histfunc) {
      case "count": rawValues[i] = rawCounts[i]; break;
      case "sum":   rawValues[i] = rawSums[i];   break;
      case "avg":   rawValues[i] = rawCounts[i] > 0 ? rawSums[i] / rawCounts[i] : 0; break;
    }
  }

  // Apply histnorm.
  const total = filteredBin.length;
  const binValues = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) {
    switch (histnorm) {
      case "percent":
        binValues[i] = total > 0 ? (rawValues[i] / total) * 100 : 0;
        break;
      case "probability":
        binValues[i] = total > 0 ? rawValues[i] / total : 0;
        break;
      case "density":
      case "probability density":
        binValues[i] = total > 0 && binSize > 0 ? rawValues[i] / (total * binSize) : 0;
        break;
      default: // "" or undefined → raw count/sum/avg
        binValues[i] = rawValues[i];
        break;
    }
  }

  // Build edges and centres.
  const binEdges   = new Float64Array(nBins + 1);
  const binCenters = new Float64Array(nBins);
  for (let i = 0; i <= nBins; i++) binEdges[i]   = start + i * binSize;
  for (let i = 0;  i < nBins; i++) binCenters[i] = (binEdges[i] + binEdges[i + 1]) / 2;

  return { binEdges, binCenters, binValues };
}
