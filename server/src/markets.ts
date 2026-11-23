export type MarketKind = "coin" | "trend" | "influencer";

export interface Market {
  id: number;
  symbol: string;
  kind: MarketKind;
  name: string;
  /** Query terms per source. */
  queries: {
    reddit: string;
    x: string;
    farcaster: string;
  };
  /** CoinGecko coin ids that count as "trending" for this market. */
  coingeckoIds?: string[];
  /** CoinGecko category name substrings (lowercase) that count as trending. */
  coingeckoCategories?: string[];
}

/** Markets from SPEC: ids 1..6. Keep ids in sync with AttentionOracle.addMarket. */
export const MARKETS: Market[] = [
  {
    id: 1,
    symbol: "$BNB",
    kind: "coin",
    name: "BNB",
    queries: {
      reddit: '"BNB" OR "Binance Coin"',
      x: "($BNB OR #BNB OR \"BNB Chain\") -is:retweet",
      farcaster: "BNB",
    },
    coingeckoIds: ["binancecoin"],
  },
  {
    id: 2,
    symbol: "$PEPE",
    kind: "coin",
    name: "Pepe",
    queries: {
      reddit: '"PEPE" (coin OR token OR crypto)',
      x: "($PEPE OR \"pepe coin\") -is:retweet",
      farcaster: "PEPE",
    },
    coingeckoIds: ["pepe"],
  },
  {
    id: 3,
    symbol: "#AIAgents",
    kind: "trend",
    name: "AI Agents",
    queries: {
      reddit: '"AI agents" (crypto OR token OR onchain)',
      x: "(\"AI agents\" OR #AIAgents) (crypto OR token OR onchain) -is:retweet",
      farcaster: "AI agents",
    },
    coingeckoCategories: ["ai agent", "artificial intelligence"],
  },
  {
    id: 4,
    symbol: "#Memecoins",
    kind: "trend",
    name: "Memecoins",
    queries: {
      reddit: "memecoin OR memecoins",
      x: "(memecoin OR memecoins OR #memecoins) -is:retweet",
      farcaster: "memecoin",
    },
    coingeckoCategories: ["meme"],
  },
  {
    id: 5,
    symbol: "@cz_binance",
    kind: "influencer",
    name: "CZ",
    queries: {
      reddit: '"CZ" Binance OR "Changpeng Zhao" OR cz_binance',
      x: "(@cz_binance OR \"Changpeng Zhao\" OR \"CZ Binance\") -is:retweet",
      farcaster: "cz_binance",
    },
  },
  {
    id: 6,
    symbol: "#RWA",
    kind: "trend",
    name: "Real World Assets",
    queries: {
      reddit: '"real world assets" OR "RWA" (crypto OR tokenization OR token)',
      x: "(#RWA OR \"real world assets\" OR \"RWA tokenization\") -is:retweet",
      farcaster: "RWA",
    },
    coingeckoCategories: ["real world assets", "rwa"],
  },
];

export const marketById = new Map(MARKETS.map((m) => [m.id, m]));
