"""
Bear Put Spread Strategy
Defined-risk options strategy using two put options at different strikes.

Pricing: Cox-Ross-Rubinstein (CRR) binomial tree — American-style exercise.
Structure: Buy higher-strike put, sell lower-strike put (same expiry)
Max Profit: (high_strike - low_strike - net_debit) * 100
Max Loss:   net_debit * 100

Author: Agentic Trading
Version: 1.0.0
"""

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple


def crr_price(S: float, K: float, T: float, r: float, sigma: float,
              option_type: str = 'put', steps: int = 100,
              style: str = 'american') -> float:
    if T <= 0 or sigma <= 0:
        return max(S - K, 0.0) if option_type == 'call' else max(K - S, 0.0)
    dt   = T / steps
    u    = math.exp(sigma * math.sqrt(dt))
    d    = 1.0 / u
    disc = math.exp(-r * dt)
    p    = (math.exp(r * dt) - d) / (u - d)
    values = [
        max(S * (u ** j) * (d ** (steps - j)) - K, 0.0) if option_type == 'call'
        else max(K - S * (u ** j) * (d ** (steps - j)), 0.0)
        for j in range(steps + 1)
    ]
    for i in range(steps - 1, -1, -1):
        for j in range(i + 1):
            cont = disc * (p * values[j + 1] + (1 - p) * values[j])
            if style == 'american':
                spot_ij   = S * (u ** j) * (d ** (i - j))
                intrinsic = max(spot_ij - K, 0.0) if option_type == 'call' else max(K - spot_ij, 0.0)
                values[j] = max(intrinsic, cont)
            else:
                values[j] = cont
    return round(values[0], 6)


def crr_greeks(S, K, T, r, sigma, option_type='put', steps=100) -> Dict:
    dS = S * 0.01; dsig = 0.01; dr = 0.005; dt = 1 / 365
    base = crr_price(S, K, T, r, sigma, option_type, steps)
    pu   = crr_price(S + dS, K, T, r, sigma, option_type, steps)
    pd   = crr_price(S - dS, K, T, r, sigma, option_type, steps)
    pvu  = crr_price(S, K, T, r, sigma + dsig, option_type, steps)
    pvd  = crr_price(S, K, T, r, max(sigma - dsig, 0.01), option_type, steps)
    pru  = crr_price(S, K, T, r + dr, sigma, option_type, steps)
    prd  = crr_price(S, K, T, max(r - dr, 0.001), sigma, option_type, steps)
    pt   = crr_price(S, K, max(T - dt, 1e-6), r, sigma, option_type, steps) if T > dt else base
    return {
        'delta': (pu - pd) / (2 * dS),
        'gamma': (pu - 2 * base + pd) / (dS ** 2),
        'theta': (pt - base) / dt / 365,
        'vega':  (pvu - pvd) / (2 * dsig) / 100,
        'rho':   (pru - prd) / (2 * dr) / 100,
    }


@dataclass
class SpreadResult:
    long_put_price:   float
    short_put_price:  float
    net_debit:        float
    max_profit:       float
    max_loss:         float
    breakeven:        float
    risk_reward_ratio: float
    profit_at_expiry: float


class BearPutSpreadStrategy:
    """
    Bear Put Spread Strategy (CRR pricing)

    Buy an ATM put, sell a lower-strike OTM put to reduce cost.
    Uses the Cox-Ross-Rubinstein binomial tree for American-exercise pricing.

    Parameters
    ----------
    high_strike_offset : % offset for long put  (0.0  = ATM)
    low_strike_offset  : % offset for short put (-0.05 = 5% OTM below)
    days_to_expiry     : days until expiry (default 30)
    risk_free_rate     : annual risk-free rate (default 0.05)
    implied_volatility : IV override
    contracts          : number of contracts (default 1)
    crr_steps          : binomial tree steps (default 100)
    """

    def __init__(
        self,
        high_strike_offset: float = 0.0,
        low_strike_offset:  float = -0.05,
        days_to_expiry:     int   = 30,
        risk_free_rate:     float = 0.05,
        implied_volatility: Optional[float] = None,
        contracts:          int   = 1,
        crr_steps:          int   = 100,
    ):
        self.high_strike_offset = high_strike_offset
        self.low_strike_offset  = low_strike_offset
        self.days_to_expiry     = days_to_expiry
        self.risk_free_rate     = risk_free_rate
        self.implied_volatility = implied_volatility
        self.contracts          = contracts
        self.crr_steps          = crr_steps

    def evaluate(self, spot_price: float, historical_vol: float = 0.25,
                 target_price: Optional[float] = None) -> SpreadResult:
        sigma       = self.implied_volatility or historical_vol
        T           = self.days_to_expiry / 365.0
        high_strike = round(spot_price * (1 + self.high_strike_offset), 2)
        low_strike  = round(spot_price * (1 + self.low_strike_offset),  2)

        long_put  = crr_price(spot_price, high_strike, T, self.risk_free_rate, sigma, 'put', self.crr_steps)
        short_put = crr_price(spot_price, low_strike,  T, self.risk_free_rate, sigma, 'put', self.crr_steps)

        net_debit    = (long_put - short_put) * self.contracts * 100
        spread_width = (high_strike - low_strike) * self.contracts * 100
        max_profit   = spread_width - net_debit
        max_loss     = net_debit
        breakeven    = high_strike - (net_debit / (self.contracts * 100))
        risk_reward  = max_profit / max_loss if max_loss > 0 else 0

        tp = target_price or low_strike
        long_pnl  = max(high_strike - tp, 0) - long_put
        short_pnl = short_put - max(low_strike - tp, 0)
        profit_at_target = (long_pnl + short_pnl) * self.contracts * 100

        return SpreadResult(
            long_put_price=long_put, short_put_price=short_put,
            net_debit=net_debit, max_profit=max_profit, max_loss=max_loss,
            breakeven=breakeven, risk_reward_ratio=risk_reward,
            profit_at_expiry=profit_at_target,
        )

    def greeks(self, spot_price: float, historical_vol: float = 0.25) -> Dict:
        sigma       = self.implied_volatility or historical_vol
        T           = self.days_to_expiry / 365.0
        high_strike = spot_price * (1 + self.high_strike_offset)
        low_strike  = spot_price * (1 + self.low_strike_offset)
        lg = crr_greeks(spot_price, high_strike, T, self.risk_free_rate, sigma, 'put', self.crr_steps)
        sg = crr_greeks(spot_price, low_strike,  T, self.risk_free_rate, sigma, 'put', self.crr_steps)
        return {k: lg[k] - sg[k] for k in lg}

    def pnl_at_expiry(self, spot_price: float, price_range: Tuple[float, float], steps: int = 50) -> Dict:
        high_strike = spot_price * (1 + self.high_strike_offset)
        low_strike  = spot_price * (1 + self.low_strike_offset)
        T           = self.days_to_expiry / 365.0
        sigma       = self.implied_volatility or 0.25
        long_cost   = crr_price(spot_price, high_strike, T, self.risk_free_rate, sigma, 'put', self.crr_steps)
        short_cred  = crr_price(spot_price, low_strike,  T, self.risk_free_rate, sigma, 'put', self.crr_steps)
        net_debit   = long_cost - short_cred
        lo, hi      = price_range
        prices      = [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]
        pnls        = [(max(high_strike - p, 0) - max(low_strike - p, 0) - net_debit)
                       * self.contracts * 100 for p in prices]
        return {'prices': prices, 'pnl': pnls}


if __name__ == "__main__":
    strategy = BearPutSpreadStrategy(high_strike_offset=0.0, low_strike_offset=-0.05, days_to_expiry=30)
    result = strategy.evaluate(spot_price=150.0, historical_vol=0.25)
    print("Bear Put Spread Analysis (CRR Pricing)")
    print("=" * 45)
    print(f"Long Put (CRR):    ${result.long_put_price:.4f}")
    print(f"Short Put (CRR):   ${result.short_put_price:.4f}")
    print(f"Net Debit:         ${result.net_debit:.2f}")
    print(f"Max Profit:        ${result.max_profit:.2f}")
    print(f"Max Loss:          ${result.max_loss:.2f}")
    print(f"Breakeven:         ${result.breakeven:.2f}")
    print(f"Risk/Reward:       {result.risk_reward_ratio:.2f}x")
