import { RouteCandidate, Token } from '../core/types.js';

export const generateTriangles = (
  startToken: Token,
  midTokens: Token[],
  maxTriangles: number
): RouteCandidate[] => {
  const routes: RouteCandidate[] = [];
  const sorted = [...midTokens].sort((a, b) => a.symbol.localeCompare(b.symbol));

  for (const b of sorted) {
    for (const c of sorted) {
      if (b.symbol === c.symbol) continue;
      routes.push({
        id: `${startToken.symbol}->${b.symbol}->${c.symbol}->${startToken.symbol}`,
        tokens: [startToken, b, c, startToken]
      });
      if (routes.length >= maxTriangles) return routes;
    }
  }

  return routes;
};
