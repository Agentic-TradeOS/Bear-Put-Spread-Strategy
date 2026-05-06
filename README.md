# Bear Put Spread Strategy Engine
### A high-fidelity TypeScript/Node.js implementation of the Bear Put Spread (Debit Put Spread) strategy. This engine uses Cox-Ross-Rubinstein (CRR) Binomial Trees to provide accurate pricing and Greeks for American-style options, moving beyond the limitations of Black-Scholes.

📉 Strategy Mechanics

A Bear Put Spread is a bearish, defined-risk strategy used when you expect a moderate decline in the underlying asset's price.
  • Setup: Buy an In-the-Money (ITM) or At-the-Money (ATM) Put; Sell an Out-of-the-Money (OTM) Put.
  • Cost: Entered for a Net Debit.
  • Risk: Capped at the net premium paid.
  • Reward: Capped at (Spread Width - Net Debit).

🚀 Key Features

  • CRR Binomial Pricing: Supports American-style exercise logic via a recursive binomial tree.
  • Real-World Chain Awareness: Functions to snap "theoretical" strikes to real-world options chain data.
  • Greeks Engine: Finite difference approximations for Delta, Gamma, Theta, Vega, and Rho.
  • Liquidity & Executability Scoring: An assessment module that scores trades based on Volume, Open Interest, and Bid-Ask slippage.
  • P&L Projection: Generates coordinate arrays for Matplotlib/Chart.js to visualize P&L at expiration.

🛠 Technical Implementation

The Pricing Model
The core uses the crrPrice function, which builds an n-step price tree to evaluate the optimal exercise timing at every node.

<img width="300" height="61" alt="image" src="https://github.com/user-attachments/assets/6e0874e0-85b0-46d3-97ec-d85040e5ca33" />

### Example Usage: Theoretical Analysis

```typescript
import { analyzeSpread, defaultConfig } from './bearPutSpread';

const spot = 150;
const vol = 0.25;
const analysis = analyzeSpread(spot, vol, {
  ...defaultConfig,
  highStrikeOffset: 0.02, // 2% ITM
  lowStrikeOffset: -0.05, // 5% OTM
});

console.log(`Max Profit: $${analysis.maxProfit}`);
console.log(`Net Delta: ${analysis.netGreeks.delta}`);

```

### Example Usage: Chain-Aware Analysis
```typescript
import { analyzeSpreadFromChain, assessExecutability } from './bearPutSpread';

// Assuming 'chain' is an array of real-time market data
const result = analyzeSpreadFromChain(currentSpot, chain);
const assessment = assessExecutability(result);

if (assessment.executeNow) {
  console.log("Trade meets liquidity requirements.");
} else {
  console.warn("High slippage risk:", assessment.warnings);
}
```
