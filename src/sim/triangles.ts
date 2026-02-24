import { RouteCandidate, Token } from '../core/types.js';

export const generateTriangles = (
  startToken: Token,
  midTokens: Token[],
  fees: number[],
  maxTriangles: number
): RouteCandidate[] => {
  const routes: RouteCandidate[] = [];
  const sortedMidTokens = [...midTokens].sort((a, b) => a.symbol.localeCompare(b.symbol));

  for (const token of sortedMidTokens) {
    for (const feeIn of fees) {
      for (const feeOut of fees) {
        routes.push({
          id: `${startToken.symbol}->${token.symbol}->${startToken.symbol}:${feeIn}/${feeOut}`,
          hops: [
            { dex: 'uniswap-v3', tokenIn: startToken, tokenOut: token, fee: feeIn },
            { dex: 'uniswap-v3', tokenIn: token, tokenOut: startToken, fee: feeOut }
          ]
        });

        if (routes.length >= maxTriangles) return routes;
      }
    }
  }

  return routes;
};
