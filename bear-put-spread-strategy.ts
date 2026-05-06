/**
 * Bear Put Spread Strategy
 * Defined-risk options strategy: buy higher-strike put (ATM), sell lower-strike put (OTM).
 *
 * Pricing: Cox-Ross-Rubinstein (CRR) binomial tree — American-style exercise.
 *
 * Max Profit : (highStrike − lowStrike − netDebit) × contracts × 100
 * Max Loss   : netDebit × contracts × 100
 * Breakeven  : highStrike − (netDebit / contracts / 100)
 *
 * Entry: pay a net debit. Profitable when the underlying falls below the breakeven.
 */

// ─── CRR Binomial Tree ────────────────────────────────────────────────────────

export type OptionType  = 'call' | 'put';
export type OptionStyle = 'american' | 'european';

export interface CRRInputs {
  spotPrice:     number;
  strikePrice:   number;
  timeToExpiry:  number;   // years
  riskFreeRate:  number;   // annual, e.g. 0.05
  volatility:    number;   // annual, e.g. 0.25
  optionType:    OptionType;
  optionStyle?:  OptionStyle;  // default 'american'
  steps?:        number;       // default 100
}

export function crrPrice(inputs: CRRInputs): number {
  const {
    spotPrice:    S,
    strikePrice:  K,
    timeToExpiry: T,
    riskFreeRate: r,
    volatility:   sigma,
    optionType,
    optionStyle = 'american',
    steps: n    = 100,
  } = inputs;

  if (T <= 0 || sigma <= 0) {
    return optionType === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }

  const dt   = T / n;
  const u    = Math.exp(sigma * Math.sqrt(dt));
  const d    = 1 / u;
  const disc = Math.exp(-r * dt);
  const p    = (Math.exp(r * dt) - d) / (u - d);

  const values: number[] = Array.from({ length: n + 1 }, (_, j) => {
    const spotT = S * Math.pow(u, j) * Math.pow(d, n - j);
    return optionType === 'call' ? Math.max(spotT - K, 0) : Math.max(K - spotT, 0);
  });

  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= i; j++) {
      const continuation = disc * (p * values[j + 1] + (1 - p) * values[j]);
      if (optionStyle === 'american') {
        const spotIJ    = S * Math.pow(u, j) * Math.pow(d, i - j);
        const intrinsic = optionType === 'call'
          ? Math.max(spotIJ - K, 0)
          : Math.max(K - spotIJ, 0);
        values[j] = Math.max(intrinsic, continuation);
      } else {
        values[j] = continuation;
      }
    }
  }

  return Math.round(values[0] * 1e6) / 1e6;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega:  number;
  rho:   number;
}

export function crrGreeks(inputs: CRRInputs): Greeks {
  const { spotPrice: S, volatility: sigma, riskFreeRate: r, timeToExpiry: T } = inputs;
  const dS = S * 0.01, dsig = 0.01, dr = 0.005, dT = 1 / 365;

  const base = crrPrice(inputs);
  const pu   = crrPrice({ ...inputs, spotPrice: S + dS });
  const pd   = crrPrice({ ...inputs, spotPrice: S - dS });
  const pvu  = crrPrice({ ...inputs, volatility: sigma + dsig });
  const pvd  = crrPrice({ ...inputs, volatility: Math.max(sigma - dsig, 0.01) });
  const pru  = crrPrice({ ...inputs, riskFreeRate: r + dr });
  const prd  = crrPrice({ ...inputs, riskFreeRate: Math.max(r - dr, 0.001) });
  const pt   = T > dT ? crrPrice({ ...inputs, timeToExpiry: T - dT }) : base;

  return {
    delta: Math.round(((pu - pd) / (2 * dS))          * 1e4) / 1e4,
    gamma: Math.round(((pu - 2 * base + pd) / dS ** 2) * 1e4) / 1e4,
    theta: Math.round(((pt - base) / dT / 365)         * 1e4) / 1e4,
    vega:  Math.round(((pvu - pvd) / (2 * dsig) / 100) * 1e4) / 1e4,
    rho:   Math.round(((pru - prd) / (2 * dr)  / 100)  * 1e4) / 1e4,
  };
}

// ─── Spread config & theoretical analysis ────────────────────────────────────

/**
 * highStrikeOffset: long put offset (0.0 = ATM, positive = ITM)
 * lowStrikeOffset:  short put offset (negative = OTM below spot, e.g. -0.05)
 */
export interface SpreadConfig {
  highStrikeOffset:   number;
  lowStrikeOffset:    number;
  daysToExpiry:       number;
  riskFreeRate:       number;
  impliedVolatility?: number;
  contracts:          number;
  crrSteps?:          number;
}

export const defaultConfig: SpreadConfig = {
  highStrikeOffset: 0.0,
  lowStrikeOffset:  -0.05,
  daysToExpiry:     30,
  riskFreeRate:     0.05,
  contracts:        1,
  crrSteps:         100,
};

export interface SpreadAnalysis {
  highStrike:     number;
  lowStrike:      number;
  longPutPrice:   number;   // cost of the long put leg
  shortPutPrice:  number;   // credit from the short put leg
  netDebit:       number;
  maxProfit:      number;
  maxLoss:        number;
  breakeven:      number;
  riskReward:     number;
  longGreeks:     Greeks;
  shortGreeks:    Greeks;
  netGreeks:      Greeks;
}

export function analyzeSpread(
  spotPrice: number,
  vol: number,
  config: SpreadConfig = defaultConfig,
): SpreadAnalysis {
  const sigma    = config.impliedVolatility ?? vol;
  const T        = config.daysToExpiry / 365;
  const { riskFreeRate: r, contracts, crrSteps: steps = 100 } = config;

  const highStrike = Math.round(spotPrice * (1 + config.highStrikeOffset) * 100) / 100;
  const lowStrike  = Math.round(spotPrice * (1 + config.lowStrikeOffset)  * 100) / 100;

  const base = (strikePrice: number): CRRInputs => ({
    spotPrice, strikePrice, timeToExpiry: T, riskFreeRate: r, volatility: sigma,
    optionType: 'put', optionStyle: 'american', steps,
  });

  const longPutPrice  = crrPrice(base(highStrike));
  const shortPutPrice = crrPrice(base(lowStrike));
  const longGreeks    = crrGreeks(base(highStrike));
  const shortGreeks   = crrGreeks(base(lowStrike));

  const netDebit    = (longPutPrice - shortPutPrice) * contracts * 100;
  const spreadWidth = (highStrike - lowStrike) * contracts * 100;
  const maxProfit   = spreadWidth - netDebit;
  const maxLoss     = netDebit;
  const breakeven   = highStrike - netDebit / (contracts * 100);
  const riskReward  = maxLoss > 0 ? maxProfit / maxLoss : 0;

  const netGreeks: Greeks = {
    delta: longGreeks.delta - shortGreeks.delta,
    gamma: longGreeks.gamma - shortGreeks.gamma,
    theta: longGreeks.theta - shortGreeks.theta,
    vega:  longGreeks.vega  - shortGreeks.vega,
    rho:   longGreeks.rho   - shortGreeks.rho,
  };

  return {
    highStrike, lowStrike, longPutPrice, shortPutPrice,
    netDebit, maxProfit, maxLoss, breakeven, riskReward,
    longGreeks, shortGreeks, netGreeks,
  };
}

export function pnlAtExpiry(
  spotPrice: number,
  vol: number,
  priceRange: [number, number] | undefined,
  steps = 50,
  config: SpreadConfig = defaultConfig,
): Array<{ price: number; pnl: number }> {
  const { highStrike, lowStrike, longPutPrice, shortPutPrice } = analyzeSpread(spotPrice, vol, config);
  const netDebit = longPutPrice - shortPutPrice;
  const range    = priceRange ?? defaultPnlRange(lowStrike, highStrike);
  const step     = (range[1] - range[0]) / steps;

  return Array.from({ length: steps + 1 }, (_, i) => {
    const price = range[0] + i * step;
    // Long put payoff - short put payoff - net debit
    const pnl = (Math.max(highStrike - price, 0) - Math.max(lowStrike - price, 0) - netDebit)
                * config.contracts * 100;
    return { price, pnl };
  });
}

// ─── Options chain selection ──────────────────────────────────────────────────

export interface ChainOption {
  strike:       number;
  expiry:       string;
  bid:          number;
  ask:          number;
  mid:          number;
  iv:           number;
  delta:        number;
  volume:       number;
  openInterest: number;
}

export function selectStrike(targetPrice: number, availableStrikes: number[]): number {
  if (availableStrikes.length === 0) throw new Error('availableStrikes cannot be empty');
  return availableStrikes.reduce((nearest, s) =>
    Math.abs(s - targetPrice) < Math.abs(nearest - targetPrice) ? s : nearest,
  );
}

export function selectExpiry(
  targetDTE:         number,
  availableExpiries: string[],
  today:             Date = new Date(),
): string {
  if (availableExpiries.length === 0) throw new Error('availableExpiries cannot be empty');
  const msPerDay = 86_400_000;
  return availableExpiries.reduce((best, exp) => {
    const daysExp  = (new Date(exp).getTime() - today.getTime()) / msPerDay;
    const daysBest = (new Date(best).getTime() - today.getTime()) / msPerDay;
    return Math.abs(daysExp - targetDTE) < Math.abs(daysBest - targetDTE) ? exp : best;
  });
}

export function filterByLiquidity(
  chain:            ChainOption[],
  minVolume       = 10,
  minOpenInterest = 100,
): ChainOption[] {
  return chain.filter(o => o.volume >= minVolume && o.openInterest >= minOpenInterest);
}

export function bidAskSpreadPct(option: ChainOption): number {
  if (option.mid === 0) return 0;
  return ((option.ask - option.bid) / option.mid) * 100;
}

export function defaultPnlRange(
  lowStrike:      number,
  highStrike:     number,
  bufferMultiple = 1.5,
): [number, number] {
  const width = highStrike - lowStrike;
  return [
    Math.max(0, lowStrike  - width * bufferMultiple),
    highStrike + width * bufferMultiple,
  ];
}

// ─── Chain-aware spread analysis ─────────────────────────────────────────────

export interface ChainSpreadAnalysis extends SpreadAnalysis {
  longLeg:        ChainOption;   // long put (at highStrike)
  shortLeg:       ChainOption;   // short put (at lowStrike)
  bidAskSlippage: number;
  selectedExpiry: string;
  contracts:      number;
}

/**
 * Analyze a bear put spread using real options chain data.
 *
 * - Strikes snapped to nearest real increment
 * - Long leg filled at ask, short leg filled at bid (worst-case cost)
 * - Greeks computed with each leg's per-strike IV (captures vol skew)
 */
export function analyzeSpreadFromChain(
  spotPrice: number,
  chain: ChainOption[],
  config: SpreadConfig = defaultConfig,
): ChainSpreadAnalysis {
  if (chain.length === 0) throw new Error('chain cannot be empty');

  const T = config.daysToExpiry / 365;
  const { riskFreeRate: r, contracts, crrSteps: steps = 100 } = config;

  const strikes   = [...new Set(chain.map(o => o.strike))].sort((a, b) => a - b);
  const highStrike = selectStrike(spotPrice * (1 + config.highStrikeOffset), strikes);
  const lowStrike  = selectStrike(spotPrice * (1 + config.lowStrikeOffset),  strikes);

  const longLeg  = chain.find(o => o.strike === highStrike);
  const shortLeg = chain.find(o => o.strike === lowStrike);
  if (!longLeg || !shortLeg) throw new Error('Could not find chain rows for selected strikes');

  const longPutPrice  = longLeg.ask;    // buy long put at ask
  const shortPutPrice = shortLeg.bid;   // sell short put at bid

  const makeInputs = (strikePrice: number, iv: number): CRRInputs => ({
    spotPrice, strikePrice, timeToExpiry: T, riskFreeRate: r, volatility: iv,
    optionType: 'put', optionStyle: 'american', steps,
  });

  const longGreeks  = crrGreeks(makeInputs(highStrike, longLeg.iv));
  const shortGreeks = crrGreeks(makeInputs(lowStrike,  shortLeg.iv));

  const netDebit    = (longPutPrice - shortPutPrice) * contracts * 100;
  const spreadWidth = (highStrike - lowStrike) * contracts * 100;
  const maxProfit   = spreadWidth - netDebit;
  const maxLoss     = netDebit;
  const breakeven   = highStrike - netDebit / (contracts * 100);
  const riskReward  = maxLoss > 0 ? maxProfit / maxLoss : 0;

  const netGreeks: Greeks = {
    delta: longGreeks.delta - shortGreeks.delta,
    gamma: longGreeks.gamma - shortGreeks.gamma,
    theta: longGreeks.theta - shortGreeks.theta,
    vega:  longGreeks.vega  - shortGreeks.vega,
    rho:   longGreeks.rho   - shortGreeks.rho,
  };

  const bidAskSlippage =
    ((longLeg.ask  - longLeg.mid) +
     (shortLeg.mid - shortLeg.bid)) * contracts * 100;

  return {
    highStrike, lowStrike,
    longPutPrice, shortPutPrice,
    netDebit, maxProfit, maxLoss, breakeven, riskReward,
    longGreeks, shortGreeks, netGreeks,
    longLeg, shortLeg, bidAskSlippage,
    selectedExpiry: longLeg.expiry,
    contracts,
  };
}

export function pnlAtExpiryFromChain(
  spotPrice: number,
  chain: ChainOption[],
  priceRange?: [number, number],
  steps = 50,
  config: SpreadConfig = defaultConfig,
): Array<{ price: number; pnl: number }> {
  const { highStrike, lowStrike, longPutPrice, shortPutPrice } =
    analyzeSpreadFromChain(spotPrice, chain, config);

  const netDebit = longPutPrice - shortPutPrice;
  const range    = priceRange ?? defaultPnlRange(lowStrike, highStrike);
  const step     = (range[1] - range[0]) / steps;

  return Array.from({ length: steps + 1 }, (_, i) => {
    const price = range[0] + i * step;
    const pnl   = (Math.max(highStrike - price, 0) - Math.max(lowStrike - price, 0) - netDebit)
                  * config.contracts * 100;
    return { price, pnl };
  });
}

// ─── Executability assessment ─────────────────────────────────────────────────

export interface ExecutabilityAssessment {
  score:           number;
  executeNow:      boolean;
  warnings:        string[];
  spreadSpreadPct: number;
  longSpreadPct:   number;
  shortSpreadPct:  number;
}

export function assessExecutability(
  analysis: ChainSpreadAnalysis,
): ExecutabilityAssessment {
  const { longLeg, shortLeg, bidAskSlippage, maxLoss } = analysis;

  const warnings: string[] = [];
  let score = 100;

  const longSpreadPct   = bidAskSpreadPct(longLeg);
  const shortSpreadPct  = bidAskSpreadPct(shortLeg);
  const spreadSpreadPct = maxLoss > 0 ? (bidAskSlippage / maxLoss) * 100 : 0;

  if (longLeg.volume < 50)  { warnings.push('Long leg: low volume');       score -= 10; }
  if (longLeg.volume < 10)  { warnings.push('Long leg: very low volume');  score -= 20; }
  if (shortLeg.volume < 50) { warnings.push('Short leg: low volume');      score -= 10; }
  if (shortLeg.volume < 10) { warnings.push('Short leg: very low volume'); score -= 20; }

  if (longLeg.openInterest < 100)  { warnings.push('Long leg: thin OI');  score -= 5; }
  if (shortLeg.openInterest < 100) { warnings.push('Short leg: thin OI'); score -= 5; }

  if (spreadSpreadPct > 10) { warnings.push(`Bid-ask is ${spreadSpreadPct.toFixed(1)}% of max loss`); score -= 15; }
  if (spreadSpreadPct > 20) { warnings.push('Slippage risk is high'); score -= 25; }

  if (longSpreadPct > 5)  { warnings.push(`Long leg spread: ${longSpreadPct.toFixed(1)}%`);   score -= 5; }
  if (shortSpreadPct > 5) { warnings.push(`Short leg spread: ${shortSpreadPct.toFixed(1)}%`); score -= 5; }

  score = Math.max(0, Math.min(100, score));

  return { score, executeNow: score >= 70, warnings, spreadSpreadPct, longSpreadPct, shortSpreadPct };
}

// ─── Cost comparison ──────────────────────────────────────────────────────────

export interface SpreadCostComparison {
  theoreticalDebit: number;
  realisticDebit:   number;
  slippageDollars:  number;
  slippagePct:      number;
  contracts:        number;
}

export function compareCosts(analysis: ChainSpreadAnalysis): SpreadCostComparison {
  const { longLeg, shortLeg, contracts } = analysis;

  const theoreticalDebit = (longLeg.mid - shortLeg.mid) * contracts * 100;
  const realisticDebit   = (longLeg.ask - shortLeg.bid) * contracts * 100;

  return {
    theoreticalDebit,
    realisticDebit,
    slippageDollars: realisticDebit - theoreticalDebit,
    slippagePct: theoreticalDebit > 0
      ? ((realisticDebit - theoreticalDebit) / theoreticalDebit) * 100
      : 0,
    contracts,
  };
}
