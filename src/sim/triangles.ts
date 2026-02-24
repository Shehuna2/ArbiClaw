import { RouteCandidate, Token } from '../core/types.js';

export const generateTriangles = (
  startToken: Token,
  midTokens: Token[],
  dexes: string[],
  maxTriangles: number
): RouteCandidate[] => {
  const routes: RouteCandidate[] = [];
  const sortedMidTokens = [...midTokens].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const sortedDexes = [...dexes].sort((a, b) => a.localeCompare(b));

  for (const token of sortedMidTokens) {
    for (const dexIn of sortedDexes) {
      for (const dexOut of sortedDexes) {
        routes.push({
          id: `${startToken.symbol}->${token.symbol}->${startToken.symbol}:${dexIn}/${dexOut}`,
          hops: [
            { dex: dexIn, tokenIn: startToken, tokenOut: token },
            { dex: dexOut, tokenIn: token, tokenOut: startToken }
          ]
        });

        if (routes.length >= maxTriangles) return routes;
      }
    }
  }

  return routes;
};
